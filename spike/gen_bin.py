"""Fase 0 - genera el binario del spike.

NO es el ETL definitivo: solo produce lo justo para poder MIRAR si deck.gl
pinta 1,83 M de puntos y a que velocidad. El formato imita la regla de oro del
plan: primero todos los campos de 4 bytes, luego los de 1 byte, para que los
offsets de las vistas tipadas queden siempre alineados.

  offset 0      lon  Float32Array[N]
  offset 4N     lat  Float32Array[N]
  offset 8N     uso  Uint8Array[N]     (0..8, indice contra USOS)

Uso:  python spike/gen_bin.py
"""

import json
import os
import sys
import time

import duckdb
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(RAIZ, "data", "catastro_gef_singeometria.duckdb")
SALIDA = os.path.join(RAIZ, "spike", "datos")

# ID_USO es el codigo oficial de un digito con relleno: '01'..'09'.
# Lo usamos crudo a proposito: el spike no debe depender del diccionario de
# alias, que todavia no existe.
USOS = ["01", "02", "03", "04", "05", "06", "07", "08", "09"]


def main():
    os.makedirs(SALIDA, exist_ok=True)
    t0 = time.time()

    con = duckdb.connect(BASE, read_only=True)
    con.execute("SET preserve_insertion_order=true")

    # Solo las filas con centroide. En CBN hay exactamente 1 sin el.
    sql = """
        SELECT centroide_lon AS lon,
               centroide_lat AS lat,
               ID_USO        AS uso
        FROM cbn_nacional_atributos
        WHERE centroide_lon IS NOT NULL AND centroide_lat IS NOT NULL
    """
    tabla = con.execute(sql).to_arrow_table()
    n = tabla.num_rows
    print(f"filas con centroide: {n:,}  ({time.time() - t0:.1f}s)")

    lon = tabla.column("lon").to_numpy(zero_copy_only=False).astype(np.float32)
    lat = tabla.column("lat").to_numpy(zero_copy_only=False).astype(np.float32)

    # ID_USO -> indice 0..8. Lo que no este en la lista oficial cae en 255,
    # que el spike pinta en gris: si aparece gris en el mapa, hay un valor
    # fuera del vocabulario y hay que verlo, no esconderlo.
    crudo = tabla.column("uso").to_pylist()
    idx = {v: i for i, v in enumerate(USOS)}
    uso = np.full(n, 255, dtype=np.uint8)
    desconocidos = {}
    for i, v in enumerate(crudo):
        j = idx.get(v)
        if j is None:
            desconocidos[v] = desconocidos.get(v, 0) + 1
        else:
            uso[i] = j
    if desconocidos:
        print(f"  AVISO valores de ID_USO fuera del vocabulario: {desconocidos}")

    ruta = os.path.join(SALIDA, "cbn_spike.bin")
    with open(ruta, "wb") as fh:
        fh.write(lon.tobytes())
        fh.write(lat.tobytes())
        fh.write(uso.tobytes())

    bytes_esperados = n * 4 + n * 4 + n * 1
    reales = os.path.getsize(ruta)
    assert reales == bytes_esperados, f"{reales} != {bytes_esperados}"

    meta = {
        "filas": n,
        "campos": {
            "lon": {"tipo": "f32", "offset": 0},
            "lat": {"tipo": "f32", "offset": 4 * n},
            "uso": {"tipo": "u8", "offset": 8 * n},
        },
        "usos": USOS,
        "bbox": [float(lon.min()), float(lat.min()), float(lon.max()), float(lat.max())],
        "bytes": reales,
    }
    with open(os.path.join(SALIDA, "spike.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2, ensure_ascii=False)

    print(f"escrito {ruta}  {reales / 1e6:.1f} MB")
    print(f"bbox lon {meta['bbox'][0]:.4f}..{meta['bbox'][2]:.4f}  "
          f"lat {meta['bbox'][1]:.4f}..{meta['bbox'][3]:.4f}")
    print(f"histograma de usos: "
          f"{dict(zip(*[x.tolist() for x in np.unique(uso, return_counts=True)]))}")
    print(f"total {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
