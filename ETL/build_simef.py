"""Emite simef.json: la serie de cambio de uso del bosque nativo.

SIMEF es OTRA FUENTE, no una continuación del Catastro. Se publica porque la
cifra de deforestación es la que se pregunta, y esconderla sería peor; pero se
publica con lo que la hace honesta:

  1. CADA PAR DE AÑOS CUBRE UN CONJUNTO DISTINTO DE REGIONES. Las 15 capas de
     SIMEF traen columnas de años distintas, así que 2001-2013 y 2019-2021 no
     miden el mismo país. Sumar la serie entera daría un total de seis
     territorios diferentes, y por eso este script emite el NÚMERO DE REGIONES
     de cada par y el visor no dibuja ninguna línea de tiempo ni total.
  2. DEFORESTACIÓN Y SUSTITUCIÓN SON DISJUNTAS. La pérdida bruta de bosque
     nativo es la SUMA de las dos, no la mayor. Por eso el gráfico son barras
     apiladas y no una mancuerna: la mancuerna codifica un intervalo, y aquí el
     dato es una suma.
  3. SÓLO ARICA, TARAPACÁ Y ATACAMA cuadran contra cifras oficiales publicadas.
     El resto es consistencia interna, y se dice.

Uso:  python ETL/build_simef.py [--check]
"""

import argparse
import hashlib
import json
import os
import re
import sys

import duckdb

sys.stdout.reconfigure(encoding="utf-8")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(RAIZ, "data", "catastro_gef_singeometria.duckdb")
SALIDA = os.path.join(RAIZ, "frontend", "public", "datos")

# Las tres regiones cuyas cifras cuadran contra lo publicado. Fuera de ellas la
# comprobación es interna y el visor lo declara.
REGIONES_CON_ANCLA = {"15", "01", "03"}

# Un par con menos de este número de polígonos no es una medición del país: es
# el residuo de una capa regional suelta. Se emite igualmente, marcado, porque
# esconderlo sería decidir por el lector.
MINIMO_PARA_SERIE = 1000


def sigla_a_anio(s):
    """'19' -> 2019, '01' -> 2001. El corte está en el propio dato: SIMEF va de
    2001 a 2023, así que no hay ambigüedad de siglo."""
    n = int(s)
    return 2000 + n


def construir():
    con = duckdb.connect(BASE, read_only=True)
    con.execute("SET preserve_insertion_order=true")

    columnas = [r[0] for r in con.execute("DESCRIBE simef_nacional_atributos").fetchall()
                if r[0].startswith("D_TC_")]

    # Nombre de región curado, el mismo que usa el resto del visor.
    from build_bin import REGION_NOMBRE

    pares = []
    for cvarname in sorted(columnas):
        m = re.match(r"^D_TC_(\d{2})_(\d{2})$", cvarname)
        if not m:
            continue
        a, b = sigla_a_anio(m.group(1)), sigla_a_anio(m.group(2))

        filas = con.execute(f"""
            SELECT reg_cod, {cvarname} AS clase, count(*) AS n, sum(SUP_HA) AS ha
            FROM simef_nacional_atributos
            WHERE {cvarname} IS NOT NULL
            GROUP BY 1, 2
            ORDER BY 1, 2
        """).fetchall()
        if not filas:
            continue

        por_region = {}
        for rc, clase, n, hh in filas:
            r = por_region.setdefault(rc, {"cod": rc, "nombre": REGION_NOMBRE.get(rc, (rc,))[0],
                                           "deforestacion": 0.0, "sustitucion": 0.0,
                                           "n_def": 0, "n_sus": 0})
            if clase == "Deforestación":
                r["deforestacion"] = round(float(hh), 2)
                r["n_def"] = n
            elif clase == "Sustitución":
                r["sustitucion"] = round(float(hh), 2)
                r["n_sus"] = n

        defo = round(sum(r["deforestacion"] for r in por_region.values()), 2)
        sust = round(sum(r["sustitucion"] for r in por_region.values()), 2)
        n_def = sum(r["n_def"] for r in por_region.values())
        n_sus = sum(r["n_sus"] for r in por_region.values())
        anios = max(1, b - a)

        pares.append({
            "clave": cvarname,
            "desde": a,
            "hasta": b,
            "anios": anios,
            "regiones": len(por_region),
            # Se emite la LISTA, no sólo el número: sin ella nadie puede
            # comprobar si dos pares cubren el mismo territorio.
            "regiones_cod": sorted(por_region),
            "con_ancla_oficial": sorted(set(por_region) & REGIONES_CON_ANCLA),
            "deforestacion": defo,
            "sustitucion": sust,
            # La pérdida bruta es la SUMA: las dos clases son disjuntas.
            "perdida_bruta": round(defo + sust, 2),
            "por_anio": round((defo + sust) / anios, 2),
            "n_deforestacion": n_def,
            "n_sustitucion": n_sus,
            "marginal": (n_def + n_sus) < MINIMO_PARA_SERIE,
            # Desempate por CÓDIGO de región, no sólo por superficie: sin él,
            # dos regiones con la misma deforestación (típicamente 0,0) se
            # ordenan según el orden de salida del GROUP BY, que DuckDB no
            # garantiza. Medido: --check daba CAMBIO entre corridas idénticas.
            "por_region": sorted(por_region.values(),
                                 key=lambda r: (-r["deforestacion"], r["cod"])),
        })

    pares.sort(key=lambda p: (p["desde"], p["hasta"]))

    # El par de referencia: dos pares son comparables entre sí sólo si cubren el
    # MISMO conjunto de regiones y abarcan el MISMO número de años. Se calcula
    # aquí y no en el frontend porque es una afirmación sobre el dato.
    comparables = []
    utiles = [p for p in pares if not p["marginal"]]
    for i, p in enumerate(utiles):
        for q in utiles[i + 1:]:
            if p["regiones_cod"] == q["regiones_cod"] and p["anios"] == q["anios"]:
                comparables.append([p["clave"], q["clave"]])

    salida = {
        "esquema": 1,
        "fuente": "SIMEF · Sistema Integrado de Monitoreo de Ecosistemas Forestales",
        "aviso": (
            "SIMEF es otra fuente, no una continuación del Catastro. Cada par de años cubre "
            "un conjunto distinto de regiones, así que las barras no se comparan entre sí "
            "salvo donde se indica. Antofagasta no tiene capa SIMEF."
        ),
        "regiones_con_ancla_oficial": sorted(REGIONES_CON_ANCLA),
        "pares": pares,
        "pares_comparables": comparables,
    }

    os.makedirs(SALIDA, exist_ok=True)
    ruta = os.path.join(SALIDA, "simef.json")
    with open(ruta, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(salida, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    return salida, ruta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    previo = None
    ruta = os.path.join(SALIDA, "simef.json")
    if args.check and os.path.exists(ruta):
        previo = hashlib.sha256(open(ruta, "rb").read()).hexdigest()

    d, ruta = construir()
    print(f"escrito {ruta}  ({os.path.getsize(ruta)/1024:.1f} KB)")
    print(f"  {len(d['pares'])} pares de años\n")
    print(f"  {'par':<14} {'años':>5} {'reg':>4} {'deforestación':>16} {'sustitución':>14} "
          f"{'bruta/año':>12}")
    for p in d["pares"]:
        marca = "  · marginal" if p["marginal"] else ""
        ancla = f"  · {len(p['con_ancla_oficial'])} con ancla" if p["con_ancla_oficial"] else ""
        print(f"  {p['desde']}-{p['hasta']:<9} {p['anios']:>5} {p['regiones']:>4} "
              f"{p['deforestacion']:>16,.1f} {p['sustitucion']:>14,.1f} "
              f"{p['por_anio']:>12,.1f}{marca}{ancla}")
    print(f"\n  pares plenamente comparables entre sí: {d['pares_comparables']}")

    if previo:
        ahora = hashlib.sha256(open(ruta, "rb").read()).hexdigest()
        print(f"\n--check: {'IDENTICO' if previo == ahora else 'CAMBIO'}")
        return 0 if previo == ahora else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
