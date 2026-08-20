"""Emite la capa de render (nivel N2) que consume el visor.

Salida en frontend/public/datos/:
    cbn_puntos.bin   columnar puro, sin cabecera, little-endian
    manifest.json    el CONTRATO con el frontend: offsets, dominios, cifras

FORMATO DEL .bin -- regla de oro: primero los campos de 4 bytes, luego los de 2,
luego los de 1. Con N filas los offsets quedan siempre alineados al tamano de su
tipo. Romper ese orden lanza RangeError al construir la vista tipada.

    offset  0N   lon     Float32Array[N]   EPSG:4326
    offset  4N   lat     Float32Array[N]   EPSG:4326
    offset  8N   ha      Float32Array[N]   SUPERF_HA
    offset 12N   comuna  Uint16Array[N]    indice en manifest.comunas, 65535 = sin dato
    offset 14N   uso     Uint8Array[N]     indice en manifest.usos
    offset 15N   subuso  Uint8Array[N]     indice en manifest.subusos, 255 = sin dato
    offset 16N   estruc  Uint8Array[N]     indice en manifest.estructuras, 255 = sin dato
    offset 17N   tifo    Uint8Array[N]     indice en manifest.tipos_forestales, 255 = no aplica
    offset 18N   snaspe  Uint8Array[N]     indice en manifest.snaspe, 255 = fuera del SNASPE
                                           total = 19 bytes por fila

LAS ETIQUETAS SALEN DEL CODIGO, NUNCA DEL TEXTO. Medido sobre las 1.827.933
filas: agregando por codigo, las cuatro estructuras del bosque nativo suman
15.536.329,01 ha, que es EXACTAMENTE su total -- diferencia +0,00. Agregando por
texto faltaban 95.626 ha, que resultaron ser Coquimbo entera (48.474,86, escrita
'Bosque Adulto') y Arica entera (47.151,34, 'Bosque Adulto/Renoval'). El texto no
esta un poco sucio: esta sucio por region.

Y EL VOCABULARIO SALE DE LA GUIA OFICIAL, NUNCA DE LOS DATOS. Construyendolo
desde los datos, un codigo que la guia no nombra no se detecta jamas y acaba en
pantalla con su numero crudo por etiqueta.

CENTINELAS: cada columna que puede no tener valor declara el suyo en el manifest
y sus filas se CUENTAN aparte. Sin centinela, las filas sin codigo de estructura
se convertirian en silencio en la estructura del indice 0.

MEMORIA: nada de to_pylist() sobre columnas de 1,8 M -- ya reviento con
MemoryError. Las claves compuestas se arman en SQL, las categoricas se traducen
con el diccionario de Arrow, y los agregados salen de np.bincount en vez de una
mascara booleana por categoria (331 comunas x 1,74 MiB tambien reviento).

Determinismo: sin ORDER BY (el orden natural de la vista union es estable con
preserve_insertion_order=true) y sin ninguna marca de tiempo en el manifest.

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

SIN_U8 = 255
SIN_U16 = 65535

# Codigos oficiales de USO, en ORDEN DE CODIGO y jamas por frecuencia: el indice
# viaja en el .bin y en la URL compartible, asi que reordenarlo por frecuencia
# haria que un enlace guardado apuntase a otro uso tras cualquier reproceso.
USOS = ["01", "02", "03", "04", "05", "06", "07", "08", "09"]

# Estatus legal. SOLO se rotula lo que se puede citar: Alerce y Araucaria son
# Monumento Natural por decreto. Cipres de la Cordillera, Cipres de las
# Guaitecas y Palma Chilena tienen figuras que NO estan verificadas, asi que no
# se rotulan. Y no existe ninguna categoria llamada "proteccion especial": es
# una invencion, y con ella se cae la cifra de 1.080.187 ha que la acompanaba.
ESTATUS_LEGAL = {
    "Alerce": "Monumento Natural (D.S. 490/1976, MINAGRI)",
    "Araucaria": "Monumento Natural (D.S. 43/1990, MINAGRI)",
}

# Nombres de region. La columna reg_nombre viene normalizada a ASCII
# ('Aysen', 'Biobio', 'Nuble', 'La Araucania'), y eso no puede llegar a
# pantalla: son nombres propios mal escritos. NOM_REG si trae tildes pero tiene
# tres valores defectuosos, asi que la fuente es este diccionario curado.
#
# `corto` es lo que cabe en un panel de 320 px; `oficial` es el nombre completo
# de la Ley 21.074, que viaja al title, al CSV y al PDF. En los toponimos
# chilenos el articulo es parte del nombre propio: Los Rios, La Araucania.
REGION_NOMBRE = {
    "15": ("Arica y Parinacota", "Región de Arica y Parinacota"),
    "01": ("Tarapacá", "Región de Tarapacá"),
    "02": ("Antofagasta", "Región de Antofagasta"),
    "03": ("Atacama", "Región de Atacama"),
    "04": ("Coquimbo", "Región de Coquimbo"),
    "05": ("Valparaíso", "Región de Valparaíso"),
    "13": ("Metropolitana", "Región Metropolitana de Santiago"),
    "06": ("O'Higgins", "Región del Libertador General Bernardo O'Higgins"),
    "07": ("Maule", "Región del Maule"),
    "16": ("Ñuble", "Región de Ñuble"),
    "08": ("Biobío", "Región del Biobío"),
    "09": ("La Araucanía", "Región de La Araucanía"),
    "14": ("Los Ríos", "Región de Los Ríos"),
    "10": ("Los Lagos", "Región de Los Lagos"),
    "11": ("Aysén", "Región de Aysén del General Carlos Ibáñez del Campo"),
    "12": ("Magallanes", "Región de Magallanes y de la Antártica Chilena"),
}

CATEGORIAS_SNASPE = ("Parque Nacional", "Reserva Nacional", "Monumento Natural")

# Cuatro unidades traen la categoria mal escrita o vacia en la capa de origen.
# Verificado consultando la base: son exactamente estas cuatro y ninguna otra.
# La correccion NO se aplica en silencio: viaja al manifest y de ahi al panel de
# metodologia.
CORRECCION_SNASPE = {
    "Pan de Azúcar": "Parque Nacional",                       # sin categoria (69 pol)
    "Pinguino de Humboldt": "Reserva Nacional",               # "Reserva Natural" (24)
    "Monumentro Nacional Lahuen Ñadi": "Monumento Natural",   # y errata en el nombre (20)
    "Mon. Natural Islotes de Puñihuil": "Monumento Natural",  # "Monumento Nacional" (6)
}


def sha256(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as fh:
        for bloque in iter(lambda: fh.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def indexar(valores):
    """valor -> indice, y la lista ordenada. Se ordena por el CODIGO para que el
    indice sea estable entre reprocesos."""
    orden = sorted(v for v in valores if v is not None)
    return {v: i for i, v in enumerate(orden)}, orden


def codificar(tabla, columna, idx, centinela, etiqueta, estricto=True):
    """Columna de codigos -> indices canonicos, sin materializar objetos Python.

    Devuelve (array, filas en el centinela, {codigo desconocido: cuantas filas}).
    Un codigo que la guia no nombra NO se absorbe en silencio: se cuenta aparte,
    porque "no tiene valor" y "tiene un valor que no sabemos nombrar" son cosas
    distintas y el .bin no tiene dos centinelas para distinguirlas.
    """
    arr = tabla.column(columna).combine_chunks().dictionary_encode()
    voc = arr.dictionary.to_pylist()
    # Los nulos apuntan a una entrada extra al final, que traduce al centinela.
    # Sin esto, to_numpy() sobre indices con nulos devuelve float64 con NaN.
    ind = arr.indices.fill_null(len(voc)).to_numpy(zero_copy_only=False).astype(np.intp)

    tipo = np.uint16 if centinela == SIN_U16 else np.uint8
    trad = np.full(len(voc) + 1, centinela, dtype=tipo)
    desconocidos = {}
    for i, v in enumerate(voc):
        if v is None:
            continue
        j = idx.get(v)
        if j is None:
            desconocidos[v] = int((ind == i).sum())
        else:
            trad[i] = j
    if desconocidos and estricto:
        raise SystemExit(f"{etiqueta}: fuera del vocabulario oficial: {desconocidos}")
    col = trad[ind]
    return col, int((col == centinela).sum()), desconocidos


def agregados(codigos, ha, k, centinela):
    """Conteo y superficie por indice, en UNA pasada con bincount.

    Nada de `codigos == i` por categoria: son 331 comunas x 1,74 MiB de mascara
    booleana, y eso ya reviento la memoria una vez.
    """
    idx = codigos.astype(np.intp)
    tope = centinela + 1
    cuenta = np.bincount(idx, minlength=tope)[:k]
    suma = np.bincount(idx, weights=ha, minlength=tope)[:k]
    return cuenta, suma


def construir():
    con = duckdb.connect(BASE, read_only=True)
    # Obligatorio para el determinismo: con false, el orden de las vistas union
    # multitabla cambia entre ejecuciones y los bytes dejan de ser reproducibles.
    con.execute("SET preserve_insertion_order=true")

    # ---- vocabularios oficiales, de la guia de codigos de la propia base -----
    # usos_comb da el triplete USO/SUBUSO/ESTRUCTURA por codigo de 6 digitos.
    # OJO: esos 6 digitos NO son clave unica -- 040201 aparece con 40 tipos
    # forestales distintos-- asi que de aqui SOLO sale el triplete.
    lbl_subuso, lbl_estruc = {}, {}
    for iu, isu, ie, est, des in con.execute("""
        SELECT id_uso, id_sub, id_est, est, des_uso
        FROM tab.xls_guia_codigos_v3_usos_comb
    """).fetchall():
        if not (iu and isu and ie):
            continue
        partes = [p.strip() for p in (des or "").split(",")]
        lbl_subuso.setdefault(f"{iu}{isu}",
                              ", ".join(partes[1:-1]) if len(partes) >= 3 else None)
        lbl_estruc.setdefault(f"{iu}{isu}{ie}", est)

    # El tipo forestal SI se deriva de su propio codigo: medido, 701.987 de
    # 708.047 concuerdan y la unica divergencia es la grafia 'roble - hualo'.
    d_tifo = dict(con.execute("""
        SELECT id, des FROM tab.xls_guia_codigos_v3_descriptores
        WHERE tipo_id='ID_TIFO_' AND campo_des='T_F_'
    """).fetchall())

    # La etiqueta que ve el usuario es la del CATASTRO (USO), no la clase IPCC:
    # 'Bosques', no 'Tierras Forestales'.
    nombres_uso = dict(con.execute("""
        SELECT DISTINCT ON (ID_USO) ID_USO, USO FROM cbn_nacional_atributos
        WHERE ID_USO IS NOT NULL AND USO IS NOT NULL ORDER BY ID_USO
    """).fetchall())
    ipcc_uso = dict(con.execute("""
        SELECT id, des FROM tab.xls_guia_codigos_v3_descriptores
        WHERE tipo_id='ID_USO_' AND campo_des='USO_IPCC_'
    """).fetchall())

    # ---- metadatos territoriales (agregados chicos: se resuelven en SQL) -----
    regiones = {}
    for rc, rn, rr, og, per, nn, hh in con.execute("""
        SELECT reg_cod, any_value(reg_nombre), any_value(reg_romana),
               any_value(orden_geo), string_agg(DISTINCT periodo, ' | '),
               count(*), sum(COALESCE(SUPERF_HA,0))
        FROM cbn_nacional_atributos WHERE centroide_lon IS NOT NULL
        GROUP BY reg_cod
    """).fetchall():
        corto, oficial = REGION_NOMBRE.get(rc, (rn, rn))
        if rc not in REGION_NOMBRE:
            # Ruidoso: una region nueva o un codigo cambiado saldria en pantalla
            # con su nombre sin tildes, y nadie se enteraria.
            raise SystemExit(f"region sin nombre curado: {rc!r} ({rn!r})")
        regiones[rc] = {"cod": rc, "nombre": corto, "oficial": oficial,
                        "romana": rr, "orden": og,
                        "anio": per, "n": nn, "ha": round(float(hh), 2)}

    com_meta = {}
    for cc, cn, pn, rc in con.execute("""
        SELECT CODCOM, any_value(NOM_COM), any_value(NOM_PROV), any_value(reg_cod)
        FROM cbn_nacional_atributos
        WHERE CODCOM IS NOT NULL AND centroide_lon IS NOT NULL GROUP BY CODCOM
    """).fetchall():
        com_meta[cc] = {"nombre": cn, "provincia": pn, "region": rc}

    # SNASPE: la categoria se deriva de la UNIDAD, no al reves.
    cat_por_unidad = {}
    for u, cat, cuenta in con.execute("""
        SELECT NOM_SNASPE, TIPO_SNASP, count(*) FROM cbn_nacional_atributos
        WHERE NOM_SNASPE IS NOT NULL AND centroide_lon IS NOT NULL GROUP BY 1,2
    """).fetchall():
        cat_por_unidad.setdefault(u, {})[cat] = cuenta

    canon_cat, corregidas = {}, []
    for u, cuentas in sorted(cat_por_unidad.items()):
        validas = {k: v for k, v in cuentas.items() if k in CATEGORIAS_SNASPE}
        if validas:
            # Radal Siete Tazas trae las dos: fue Reserva Nacional y paso a
            # Parque Nacional. Gana la mayoritaria, que es la vigente.
            elegida = max(validas.items(), key=lambda x: x[1])[0]
            motivo = "la unidad figura con dos categorias; se usa la mayoritaria"
        else:
            elegida = CORRECCION_SNASPE.get(u)
            if elegida is None:
                raise SystemExit(f"SNASPE sin categoria valida ni correccion: {u!r} {cuentas}")
            motivo = "la capa de origen trae una categoria que no existe en el SNASPE"
        canon_cat[u] = elegida
        if len(cuentas) > 1 or not validas:
            corregidas.append({"unidad": u, "en_la_capa": cuentas,
                               "usada": elegida, "motivo": motivo})

    idx_uso, ord_uso = {v: i for i, v in enumerate(USOS)}, USOS
    idx_sub, ord_sub = indexar(lbl_subuso)
    idx_est, ord_est = indexar(lbl_estruc)
    idx_tif, ord_tif = indexar(d_tifo)
    idx_com, ord_com = indexar(com_meta)
    idx_sna, ord_sna = indexar(cat_por_unidad)

    # ---- la pasada de datos --------------------------------------------------
    # Las claves compuestas se arman en SQL: concatenarlas en un bucle de Python
    # materializa 3,6 M de cadenas y revienta la memoria.
    t = con.execute("""
        SELECT centroide_lon AS lon,
               centroide_lat AS lat,
               COALESCE(SUPERF_HA, 0) AS ha,
               ID_USO AS c_uso,
               CASE WHEN ID_USO IS NOT NULL AND ID_SUBUSO IS NOT NULL
                    THEN ID_USO || ID_SUBUSO END AS c_sub,
               CASE WHEN ID_USO IS NOT NULL AND ID_SUBUSO IS NOT NULL
                         AND ID_ESTRUC IS NOT NULL
                    THEN ID_USO || ID_SUBUSO || ID_ESTRUC END AS c_est,
               ID_TIFO AS c_tif, CODCOM AS c_com, NOM_SNASPE AS c_sna
        FROM cbn_nacional_atributos
        WHERE centroide_lon IS NOT NULL AND centroide_lat IS NOT NULL
    """).to_arrow_table()
    n = t.num_rows

    lon = t.column("lon").to_numpy(zero_copy_only=False).astype(np.float32)
    lat = t.column("lat").to_numpy(zero_copy_only=False).astype(np.float32)
    ha32 = t.column("ha").to_numpy(zero_copy_only=False).astype(np.float32)
    # Las CIFRAS se acumulan en float64 SIEMPRE. A 75 millones el ULP de float32
    # son 8 ha: sumando en float32 el total quedaba cuantizado a saltos de 8 y
    # el manifest se contradecia consigo mismo por 3,12 ha.
    ha64 = t.column("ha").to_numpy(zero_copy_only=False).astype(np.float64)

    c_uso, _, _ = codificar(t, "c_uso", idx_uso, SIN_U8, "ID_USO")
    c_sub, sin_sub, dsc_sub = codificar(t, "c_sub", idx_sub, SIN_U8, "subuso", False)
    c_est, sin_est, dsc_est = codificar(t, "c_est", idx_est, SIN_U8, "estructura", False)
    c_tif, sin_tif, _ = codificar(t, "c_tif", idx_tif, SIN_U8, "ID_TIFO")
    c_com, sin_com, _ = codificar(t, "c_com", idx_com, SIN_U16, "CODCOM")
    c_sna, sin_sna, _ = codificar(t, "c_sna", idx_sna, SIN_U8, "NOM_SNASPE")
    t = None   # se libera la tabla de Arrow antes de agregar

    # ---- escritura del .bin --------------------------------------------------
    os.makedirs(SALIDA, exist_ok=True)
    ruta_bin = os.path.join(SALIDA, "cbn_puntos.bin")
    with open(ruta_bin, "wb") as fh:
        for a in (lon, lat, ha32, c_com, c_uso, c_sub, c_est, c_tif, c_sna):
            fh.write(a.tobytes())

    esperado = n * (4 * 3 + 2 + 1 * 5)
    real = os.path.getsize(ruta_bin)
    if real != esperado:
        raise SystemExit(f"tamano inesperado: {real} != {esperado}")

    # ---- dominios y cifras ---------------------------------------------------
    def dominio(codigos, orden, etiqueta, centinela=SIN_U8, extra=None):
        cuenta, suma = agregados(codigos, ha64, len(orden), centinela)
        filas = []
        for i, c in enumerate(orden):
            fila = {"cod": c, "etiqueta": etiqueta(c),
                    "n": int(cuenta[i]), "ha": round(float(suma[i]), 2)}
            if extra:
                fila.update(extra(c))
            filas.append(fila)
        return filas

    manifest = {
        "esquema": 2,
        "fuente": "Catastro de Usos de la Tierra y Recursos Vegetacionales, CONAF",
        # Sin marca de tiempo: es lo que permite commitear datos y que un
        # `git status` limpio signifique "nada cambio".
        "capas": {
            "cbn_puntos": {
                "archivo": "cbn_puntos.bin",
                "filas": n,
                "bytes": real,
                "sha256": sha256(ruta_bin),
                "campos": {
                    "lon":    {"tipo": "f32", "offset": 0,      "centinela": None},
                    "lat":    {"tipo": "f32", "offset": 4 * n,  "centinela": None},
                    "ha":     {"tipo": "f32", "offset": 8 * n,  "centinela": None},
                    "comuna": {"tipo": "u16", "offset": 12 * n, "centinela": SIN_U16},
                    "uso":    {"tipo": "u8",  "offset": 14 * n, "centinela": None},
                    "subuso": {"tipo": "u8",  "offset": 15 * n, "centinela": SIN_U8},
                    "estruc": {"tipo": "u8",  "offset": 16 * n, "centinela": SIN_U8},
                    "tifo":   {"tipo": "u8",  "offset": 17 * n, "centinela": SIN_U8},
                    "snaspe": {"tipo": "u8",  "offset": 18 * n, "centinela": SIN_U8},
                },
                "sin_dato": {"comuna": sin_com, "subuso": sin_sub, "estruc": sin_est,
                             "tifo": sin_tif, "snaspe": sin_sna},
                "bbox": [float(lon.min()), float(lat.min()),
                         float(lon.max()), float(lat.max())],
            }
        },
        "usos": dominio(c_uso, ord_uso, lambda c: nombres_uso.get(c, c),
                        extra=lambda c: {"ipcc": ipcc_uso.get(c)}),
        "subusos": dominio(c_sub, ord_sub, lambda c: lbl_subuso.get(c) or c,
                           extra=lambda c: {"uso": c[:2]}),
        "estructuras": dominio(c_est, ord_est, lambda c: lbl_estruc.get(c) or c,
                               extra=lambda c: {"uso": c[:2], "subuso": c[:4]}),
        "tipos_forestales": dominio(c_tif, ord_tif, lambda c: d_tifo.get(c, c),
                                    extra=lambda c: {"legal": ESTATUS_LEGAL.get(d_tifo.get(c))}),
        "snaspe": dominio(c_sna, ord_sna, lambda c: c,
                          extra=lambda c: {"categoria": canon_cat.get(c)}),
        "comunas": dominio(c_com, ord_com, lambda c: com_meta[c]["nombre"], SIN_U16,
                           extra=lambda c: {"provincia": com_meta[c]["provincia"],
                                            "region": com_meta[c]["region"]}),
        "regiones": sorted(regiones.values(), key=lambda r: r["orden"]),
        "snaspe_categoria_corregida": corregidas,
        "codigos_desconocidos": {"subuso": dsc_sub, "estructura": dsc_est},
        "total": {"filas": n, "ha": round(float(ha64.sum()), 2)},
    }

    ruta_man = os.path.join(SALIDA, "manifest.json")
    with open(ruta_man, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    return manifest, ruta_bin


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

    man, ruta_bin = construir()
    cap = man["capas"]["cbn_puntos"]
    print(f"escrito {ruta_bin}")
    print(f"  {cap['filas']:,} filas x 19 B = {cap['bytes']/1e6:.1f} MB   "
          f"sha256 {cap['sha256'][:16]}…")
    print(f"  total nacional {man['total']['ha']:,.2f} ha")
    print(f"  vocabularios: {len(man['usos'])} usos · {len(man['subusos'])} subusos · "
          f"{len(man['estructuras'])} estructuras · {len(man['tipos_forestales'])} tipos "
          f"forestales · {len(man['snaspe'])} unidades SNASPE · "
          f"{len(man['comunas'])} comunas · {len(man['regiones'])} regiones")
    print(f"  filas sin dato: {cap['sin_dato']}")
    for d in man["snaspe_categoria_corregida"]:
        print(f"  SNASPE {d['unidad']!r}: {d['en_la_capa']} -> {d['usada']!r}")
    for campo, vals in man["codigos_desconocidos"].items():
        if vals:
            print(f"  codigos de {campo} que la guia oficial no nombra: {vals}")

    if previo:
        antes = previo["capas"]["cbn_puntos"].get("sha256")
        estado = "IDENTICO" if antes == cap["sha256"] else "CAMBIO"
        print(f"\n--check: {estado}")
        return 0 if antes == cap["sha256"] else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
