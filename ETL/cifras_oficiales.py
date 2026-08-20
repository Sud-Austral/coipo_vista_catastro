"""Parsea las cifras OFICIALES publicadas por CONAF y emite oficiales.json.

Por qué existe: sin esto, las cifras contra las que se contrasta el ETL viven
escritas a mano en `verificar_datos.py`, y una constante escrita a mano se
desincroniza del día que alguien actualiza la planilla. Aquí se leen de la
propia base, que es donde CONAF las publicó.

Es la ÚNICA comprobación que mira fuera del artefacto: todo lo demás verifica
que el manifest es coherente consigo mismo, y un ETL puede ser perfectamente
coherente y estar equivocado.

La tabla `tab.xls_cifras_oficiales_catastrocon_usos_de_la_tierra` es un volcado
crudo de Excel: columnas `unnamed_*`, títulos y notas mezclados entre los datos.
La cabecera real está en la fila 4 y los datos entre la 5 y la 21.

Uso:  python ETL/cifras_oficiales.py [--check]
"""

import argparse
import json
import os
import re
import sys
import unicodedata

import duckdb

sys.stdout.reconfigure(encoding="utf-8")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(RAIZ, "data", "catastro_gef_singeometria.duckdb")
SALIDA = os.path.join(RAIZ, "frontend", "public", "datos")
TABLA = "tab.xls_cifras_oficiales_catastrocon_usos_de_la_tierra"

# Cada columna de la planilla, a qué dimensión y código del visor corresponde.
# Escrito a mano PORQUE los nombres de la planilla no son los del vocabulario
# oficial de códigos ('Plantaciones forestales (ha)' contra 'Plantación'), y
# adivinarlo con una heurística de parecido sería exactamente el error de
# "un porcentaje de coincidencia mide la heurística, no los datos".
COLUMNAS = {
    "Áreas Urbanas e Industriales": ("uso", "01"),
    "Terrenos Agrícolas": ("uso", "02"),
    "Praderas y Matorrales": ("uso", "03"),
    "Superficie total de Bosques (ha)": ("uso", "04"),
    "Humedales": ("uso", "05"),
    "Áreas desprovistas de vegetación": ("uso", "06"),
    "Nieves y Glaciares": ("uso", "07"),
    "Cuerpos de agua": ("uso", "08"),
    "Áreas no reconocidas": ("uso", "09"),
    "Plantaciones forestales (ha)": ("subuso", "0401"),
    "Bosque Nativo (ha)": ("subuso", "0402"),
    "Bosque Mixto": ("subuso", "0403"),
    "TOTAL (nacional ha)": ("total", None),
}


def canon(s):
    if s is None:
        return ""
    s = re.sub(r"\s+", " ", str(s)).strip().lower()
    return "".join(ch for ch in unicodedata.normalize("NFD", s)
                   if unicodedata.category(ch) != "Mn")


def numero(v):
    """La planilla trae los números como TEXTO y con punto decimal a la inglesa
    ('10577.4123430778'), no a la española. Se intenta primero tal cual y sólo
    si eso falla se prueba la forma española.

    Escrito al revés —quitando el punto como separador de miles— multiplicaba
    cada cifra por mil millones y las trece comparaciones salían fuera de
    tolerancia a la vez. Trece fallos simultáneos son un fallo del parser, no
    trece errores del dato."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        pass
    try:
        return float(s.replace(".", "").replace(",", "."))
    except ValueError:
        return None


def construir():
    con = duckdb.connect(BASE, read_only=True)
    filas = con.execute(f"SELECT * FROM {TABLA}").fetchall()

    # La cabecera se BUSCA, no se da por hecha en la fila 4: si CONAF añade una
    # fila de título arriba, un índice fijo leería basura sin avisar.
    idx_cab = next(i for i, f in enumerate(filas)
                   if any(canon(x) == "region" for x in f if x))
    cab = filas[idx_cab]
    col_region = next(i for i, x in enumerate(cab) if canon(x) == "region")

    mapa = {}
    for i, x in enumerate(cab):
        if x and str(x).strip() in COLUMNAS:
            mapa[i] = COLUMNAS[str(x).strip()]
    faltan = set(COLUMNAS) - {str(cab[i]).strip() for i in mapa}
    if faltan:
        raise SystemExit(f"columnas de la planilla que no aparecen: {sorted(faltan)}")

    col_actualizacion = next(
        (i for i, x in enumerate(cab) if canon(x).startswith("ano de actualizacion")), None)

    regiones, total_pais = {}, {}
    for f in filas[idx_cab + 1:]:
        etiqueta = f[col_region]
        if not etiqueta:
            continue
        nombre = str(etiqueta).strip()
        if canon(nombre).startswith("% de uso"):
            break
        es_total = canon(nombre).startswith("total pais")
        # El asterisco marca las regiones cuya última publicación es distinta.
        # Se conserva como dato, no se borra.
        limpio = nombre.rstrip("*").strip()
        destino = total_pais if es_total else regiones.setdefault(
            limpio, {"region": limpio, "asterisco": nombre.endswith("*"), "valores": {}})
        caja = destino if es_total else destino["valores"]
        for i, (dim, cod) in mapa.items():
            v = numero(f[i])
            if v is None:
                continue
            caja[f"{dim}:{cod}" if cod else "total"] = round(v, 2)
        if not es_total and col_actualizacion is not None:
            destino["anio_actualizacion"] = (
                str(f[col_actualizacion]).strip() if f[col_actualizacion] else None)

    # --- el año: tres fuentes, y no dicen todas lo mismo ---------------------
    # Se cruza el año de la planilla oficial contra el que traen las propias
    # capas. NO se elige en silencio: la discrepancia se publica, porque el año
    # del catastro es la advertencia central de todo el visor.
    discrepan = []
    man_p = os.path.join(SALIDA, "manifest.json")
    if os.path.exists(man_p):
        man = json.load(open(man_p, encoding="utf-8"))
        por_canon = {canon(r["nombre"]): r for r in man["regiones"]}
        for r in regiones.values():
            k = canon(r["region"]).replace("magallanes y de la antartica", "magallanes")
            m = por_canon.get(k)
            if not m:
                continue
            planilla = r.get("anio_actualizacion")
            if planilla and str(planilla) != str(m["anio"]):
                discrepan.append({
                    "region": m["nombre"],
                    "en_la_planilla_oficial": planilla,
                    "en_las_capas": m["anio"],
                    # El nombre del shapefile original es una tercera fuente
                    # independiente, y coincide con las capas.
                    "usado": m["anio"],
                })

    salida = {
        "esquema": 1,
        "fuente": f"{TABLA}, publicada por CONAF dentro de la propia base",
        "anio_discrepante": discrepan,
        "nota_anio": (
            "El año de levantamiento tiene tres fuentes: la columna `periodo` de cada capa, el "
            "nombre del shapefile de origen que asignó CONAF, y la planilla oficial de cifras. "
            "Las dos primeras coinciden en las 22 capas; la planilla difiere en tres regiones. "
            "Este visor usa el de las capas, que es el que respaldan dos fuentes, y publica la "
            "diferencia en vez de resolverla en silencio."
        ),
        "nota": (
            "Cifras oficiales publicadas por CONAF. Son la única referencia externa contra la "
            "que este visor se contrasta: todo lo demás comprueba que el manifest es coherente "
            "consigo mismo, y un ETL puede ser coherente y estar equivocado."
        ),
        "total_pais": total_pais,
        "regiones": sorted(regiones.values(), key=lambda r: r["region"]),
    }
    os.makedirs(SALIDA, exist_ok=True)
    ruta = os.path.join(SALIDA, "oficiales.json")
    with open(ruta, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(salida, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    return salida, ruta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.parse_args()

    d, ruta = construir()
    print(f"escrito {ruta}")
    print(f"  {len(d['regiones'])} regiones + TOTAL PAÍS\n")

    man = None
    p = os.path.join(SALIDA, "manifest.json")
    if os.path.exists(p):
        man = json.load(open(p, encoding="utf-8"))

    print(f"  {'dimensión':<28} {'oficial':>18} {'este visor':>18} {'diferencia':>12}")
    fallos = 0
    for clave, oficial in sorted(d["total_pais"].items()):
        mio = None
        if man:
            if clave == "total":
                mio = man["total"]["ha"]
            else:
                dim, cod = clave.split(":")
                lista = man["usos"] if dim == "uso" else man["subusos"]
                fila = next((x for x in lista if x["cod"] == cod), None)
                mio = fila["ha"] if fila else None
        if mio is None:
            print(f"  {clave:<28} {oficial:>18,.2f} {'—':>18} {'—':>12}")
            continue
        d_ = mio - oficial
        # Tolerancia por dimensión: la superficie viaja en float32 en el .bin y
        # la propia serie tiene residuos regionales de hasta 6,33 ha contra lo
        # publicado. Apretarla más haría nacer roja la aserción sobre datos
        # correctos, y un gate con falso positivo acaba desactivado.
        limite = 15.0 if clave == "total" else 10.0
        marca = "" if abs(d_) <= limite else "   ← FUERA DE TOLERANCIA"
        if abs(d_) > limite:
            fallos += 1
        print(f"  {clave:<28} {oficial:>18,.2f} {mio:>18,.2f} {d_:>+12,.2f}{marca}")

    print(f"\n  {'todas dentro de tolerancia' if not fallos else f'{fallos} fuera de tolerancia'}")

    if any(r.get("anio_actualizacion") for r in d["regiones"]):
        print("\n  año de actualización según la planilla oficial (tercera fuente):")
        for r in d["regiones"]:
            if r.get("anio_actualizacion"):
                print(f"     {r['region']:<26} {r['anio_actualizacion']}")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
