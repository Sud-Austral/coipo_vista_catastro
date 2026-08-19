"""Emite la capa de render (nivel N2) que consume el visor.

Salida en frontend/public/datos/:
    cbn_puntos.bin   columnar puro, sin cabecera, little-endian
    manifest.json    el CONTRATO con el frontend: offsets, dominios, cifras

Formato del .bin -- regla de oro: primero los campos de 4 bytes, luego los de 1.
Con N filas los offsets 4*k*N y N son siempre multiplos de 4 y de 1, asi que las
vistas tipadas quedan alineadas. Romper ese orden lanza RangeError al construir
el Float32Array, no antes.

    offset 0      lon  Float32Array[N]   EPSG:4326
    offset 4N     lat  Float32Array[N]   EPSG:4326
    offset 8N     ha   Float32Array[N]   SUPERF_HA
    offset 12N    uso  Uint8Array[N]     indice contra manifest.usos

LAS ETIQUETAS SALEN DEL CODIGO, NO DEL TEXTO. Medido sobre las 1.827.934 filas
(ver DECISIONES.md §A y ETL/analisis_codigos.py): la etiqueta oficial derivada de
ID_USO concuerda con la columna USO en 1.816.671 de 1.816.671 casos -- identico,
cero divergencias. El texto, en cambio, trae duplicados por caja y saltos de
linea embebidos. Derivar del codigo elimina el problema en origen en vez de
repararlo despues.

Determinismo: sin ORDER BY (el orden natural de la vista union es estable con
preserve_insertion_order=true) y sin ninguna marca de tiempo en el manifest, de
modo que re-ejecutar sin cambios en los datos deje `git status` limpio.

Uso:  python ETL/build_bin.py [--check]
"""

import argparse
import hashlib
import json
import os
import sys

import duckdb
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(RAIZ, "data", "catastro_gef_singeometria.duckdb")
SALIDA = os.path.join(RAIZ, "frontend", "public", "datos")

# Codigos oficiales de USO, en ORDEN DE CODIGO y nunca por frecuencia: el indice
# viaja en el .bin y en la URL compartible, asi que reordenarlo por frecuencia
# haria que un enlace guardado apuntase a otro uso tras cualquier reproceso.
USOS = ["01", "02", "03", "04", "05", "06", "07", "08", "09"]


def sha256(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as fh:
        for bloque in iter(lambda: fh.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def construir():
    con = duckdb.connect(BASE, read_only=True)
    # Obligatorio para el determinismo: con false, el orden de las vistas union
    # multitabla cambia entre ejecuciones y los bytes dejan de ser reproducibles.
    con.execute("SET preserve_insertion_order=true")

    etiquetas = dict(con.execute("""
        SELECT id, des FROM tab.xls_guia_codigos_v3_descriptores
        WHERE tipo_id = 'ID_USO_' AND campo_des = 'USO_IPCC_'
    """).fetchall())

    # La etiqueta que ve el usuario es la del CATASTRO (USO), no la clase IPCC:
    # 'Bosques' y no 'Tierras Forestales'. La primera aparicion por codigo basta
    # porque ya esta comprobado que USO es funcion exacta de ID_USO.
    nombres = dict(con.execute("""
        SELECT DISTINCT ON (ID_USO) ID_USO, USO
        FROM cbn_nacional_atributos
        WHERE ID_USO IS NOT NULL AND USO IS NOT NULL
        ORDER BY ID_USO
    """).fetchall())

    t = con.execute("""
        SELECT centroide_lon AS lon,
               centroide_lat AS lat,
               COALESCE(SUPERF_HA, 0) AS ha,
               ID_USO AS uso
        FROM cbn_nacional_atributos
        WHERE centroide_lon IS NOT NULL AND centroide_lat IS NOT NULL
    """).to_arrow_table()
    n = t.num_rows

    lon = t.column("lon").to_numpy(zero_copy_only=False).astype(np.float32)
    lat = t.column("lat").to_numpy(zero_copy_only=False).astype(np.float32)
    ha = t.column("ha").to_numpy(zero_copy_only=False).astype(np.float32)

    idx = {v: i for i, v in enumerate(USOS)}
    crudo = t.column("uso").to_pylist()
    uso = np.full(n, 255, dtype=np.uint8)
    fuera = {}
    for i, v in enumerate(crudo):
        j = idx.get(v)
        if j is None:
            fuera[v] = fuera.get(v, 0) + 1
        else:
            uso[i] = j
    if fuera:
        # Ruidoso a proposito: un codigo fuera del vocabulario oficial es un dato
        # que la leyenda no sabria nombrar, y callarlo lo convertiria en un punto
        # gris sin explicacion.
        raise SystemExit(f"ID_USO fuera del vocabulario oficial: {fuera}")

    os.makedirs(SALIDA, exist_ok=True)
    ruta_bin = os.path.join(SALIDA, "cbn_puntos.bin")
    with open(ruta_bin, "wb") as fh:
        fh.write(lon.tobytes())
        fh.write(lat.tobytes())
        fh.write(ha.tobytes())
        fh.write(uso.tobytes())

    esperado = n * 4 * 3 + n
    real = os.path.getsize(ruta_bin)
    if real != esperado:
        raise SystemExit(f"tamano inesperado: {real} != {esperado}")

    conteo = np.bincount(uso, minlength=len(USOS))
    ha_por_uso = [float(ha[uso == i].sum()) for i in range(len(USOS))]

    manifest = {
        "esquema": 1,
        "fuente": "Catastro de Usos de la Tierra y Recursos Vegetacionales, CONAF",
        # Sin marca de tiempo: es lo que permite commitear datos y que
        # `git status` limpio signifique "nada cambio".
        "capas": {
            "cbn_puntos": {
                "archivo": "cbn_puntos.bin",
                "filas": n,
                "bytes": real,
                "sha256": sha256(ruta_bin),
                "campos": {
                    "lon": {"tipo": "f32", "offset": 0},
                    "lat": {"tipo": "f32", "offset": 4 * n},
                    "ha": {"tipo": "f32", "offset": 8 * n},
                    "uso": {"tipo": "u8", "offset": 12 * n},
                },
                "bbox": [float(lon.min()), float(lat.min()), float(lon.max()), float(lat.max())],
            }
        },
        "usos": [
            {
                "id": c,
                "etiqueta": nombres.get(c, etiquetas.get(c, c)),
                "ipcc": etiquetas.get(c),
                "n": int(conteo[i]),
                "ha": round(ha_por_uso[i], 2),
            }
            for i, c in enumerate(USOS)
        ],
        "total": {"filas": n, "ha": round(float(ha.sum()), 2)},
    }
    ruta_man = os.path.join(SALIDA, "manifest.json")
    with open(ruta_man, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    return manifest, ruta_bin, ruta_man


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="reconstruye y compara sha256 con el manifest ya escrito")
    args = ap.parse_args()

    previo = None
    ruta_man = os.path.join(SALIDA, "manifest.json")
    if args.check and os.path.exists(ruta_man):
        with open(ruta_man, encoding="utf-8") as fh:
            previo = json.load(fh)

    man, ruta_bin, _ = construir()
    cap = man["capas"]["cbn_puntos"]
    print(f"escrito {ruta_bin}  {cap['bytes'] / 1e6:.1f} MB  {cap['filas']:,} filas")
    print(f"sha256 {cap['sha256'][:16]}…")
    print(f"total nacional {man['total']['ha']:,.2f} ha")
    for u in man["usos"]:
        print(f"   {u['id']}  {u['etiqueta']:<34} {u['n']:>9,}  {u['ha']:>14,.2f} ha")

    if previo:
        antes = previo["capas"]["cbn_puntos"]["sha256"]
        ahora = cap["sha256"]
        estado = "IDENTICO" if antes == ahora else "CAMBIO"
        print(f"\n--check: {estado}  ({antes[:16]}… -> {ahora[:16]}…)")
        return 0 if antes == ahora else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
