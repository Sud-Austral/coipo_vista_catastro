"""Comprueba la integridad de los datos COMMITEADOS (frontend/public/datos).

Vive aqui y no dentro del YAML del workflow por una razon concreta: una asercion
que solo existe en CI no se puede correr en local ni, sobre todo, VER FALLAR. Y
una prueba que no se ha visto fallar no es una prueba.

    python ETL/verificar_datos.py              comprueba
    python ETL/verificar_datos.py --negativas  reintroduce cada defecto y EXIGE
                                               que su asercion se ponga roja

No abre el .duckdb: comprueba lo que se publica, que es lo que recibe la gente.
"""

import argparse
import copy
import hashlib
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATOS = os.path.join(RAIZ, "frontend", "public", "datos")

# Cifra oficial publicada por CONAF para el total nacional del Catastro.
OFICIAL_HA = 75_661_194.48
FILAS_CBN = 1_827_933

# Tolerancia entre el total y la suma de sus partes. Sale de la DEFINICION: el
# ETL calcula el total como la suma de las nueve partes, asi que la unica
# diferencia posible es el redondeo de nueve valores a dos decimales
# (9 x 0,005 = 0,045 ha). Estuvo en 1 ha y era flojo: cazo el fallo de
# acumulacion en float32 (3,12 ha) por suerte de magnitud, pero con las partes
# ya corregidas el mismo total malo se quedaba en 0,48 y habria pasado en verde.
TOL_PARTES = 0.1

# La superficie viaja en float32 en el .bin (+0,09 ha sobre el total) y la propia
# serie CBN tiene residuos por region de hasta 6,33 ha contra lo publicado.
# Apretar esto a +-1 haria nacer roja la asercion sobre datos correctos.
TOL_OFICIAL = 15.0


def sha256(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def comprobar(man, crudo, tam, hashes):
    """Devuelve la lista de fallos. Recibe todo lo del disco ya leido para que
    las pruebas negativas puedan alterar una cosa sin tocar los archivos."""
    fallos = []

    if man.get("esquema") != 1:
        fallos.append(f"D1 esquema {man.get('esquema')} != 1")

    # Ninguna marca de tiempo. Es lo que permite commitear datos: si el manifest
    # llevara fecha, cada regeneracion ensuciaria git aunque los datos fueran
    # identicos, y el historial creceria sin motivo.
    if re.search(r"\d{4}-\d{2}-\d{2}T", crudo):
        fallos.append("D2 el manifest contiene una marca de tiempo")

    for nombre, capa in man["capas"].items():
        real = tam.get(capa["archivo"])
        if real is None:
            fallos.append(f"D3 {nombre}: falta {capa['archivo']}")
            continue
        if real != capa["bytes"]:
            fallos.append(f"D3 {nombre}: {real} bytes, el manifest dice {capa['bytes']}")

        # Los offsets cuadran con el numero de filas. Un .bin truncado abre
        # vistas tipadas VALIDAS sobre basura y el mapa saldria con puntos en
        # medio del Pacifico, sin ningun error.
        n = capa["filas"]
        esperado = n * 4 * 3 + n
        if capa["bytes"] != esperado:
            fallos.append(f"D4 {nombre}: {capa['bytes']} != {esperado} para {n} filas")

        if hashes.get(capa["archivo"]) != capa["sha256"]:
            fallos.append(f"D5 {nombre}: sha256 no coincide")

        if real and real > 50 * 1024 * 1024:
            fallos.append(f"D6 {nombre}: {real/1048576:.0f} MiB, por encima del aviso de 50 MiB")

    suma = sum(u["ha"] for u in man["usos"])
    if abs(suma - man["total"]["ha"]) > TOL_PARTES:
        fallos.append(f"D7 usos suman {suma:,.2f} ha y el total dice {man['total']['ha']:,.2f}")

    # La unica asercion que mira FUERA del propio artefacto: todo lo demas
    # comprueba que el manifest es coherente consigo mismo, y un ETL puede ser
    # perfectamente coherente y estar equivocado.
    d = man["total"]["ha"] - OFICIAL_HA
    if abs(d) > TOL_OFICIAL:
        fallos.append(f"D8 total {man['total']['ha']:,.2f} ha se aleja {d:+,.2f} de la cifra oficial")

    # No es redundante con D4: aquel comprueba que el .bin mide lo que dice para
    # N filas; este, que N es el numero de poligonos que tiene el Catastro. Un
    # ETL que perdiera una capa entera pasaria D4 sin despeinarse.
    if man["total"]["filas"] != FILAS_CBN:
        fallos.append(f"D9 filas {man['total']['filas']:,} != {FILAS_CBN:,}")
    if sum(u["n"] for u in man["usos"]) != man["total"]["filas"]:
        fallos.append("D9 los conteos por uso no suman el total de filas")

    return fallos


def leer():
    ruta_man = os.path.join(DATOS, "manifest.json")
    crudo = open(ruta_man, encoding="utf-8").read()
    man = json.loads(crudo)
    tam, hashes = {}, {}
    for capa in man["capas"].values():
        r = os.path.join(DATOS, capa["archivo"])
        if os.path.exists(r):
            tam[capa["archivo"]] = os.path.getsize(r)
            hashes[capa["archivo"]] = sha256(r)
    return man, crudo, tam, hashes


# Cada defecto altera lo leido en memoria y declara que asercion DEBE ponerse
# roja. Los archivos del disco no se tocan.
NEGATIVAS = [
    ("D2 marca de tiempo", "D2", lambda m, c, t, h: (m, c + '"generado":"2026-08-19T10:00:00"', t, h)),
    ("D3 tamano declarado erroneo", "D3", lambda m, c, t, h: (_set(m, "bytes", 123), c, t, h)),
    ("D5 sha256 alterado", "D5", lambda m, c, t, h: (_set(m, "sha256", "0" * 64), c, t, h)),
    ("D7 total en float32", "D7", lambda m, c, t, h: (_tot(m, 75_661_196.88), c, t, h)),
    ("D8 total lejos de lo oficial", "D8", lambda m, c, t, h: (_tot(m, 75_700_000.0), c, t, h)),
    ("D9 falta una capa entera", "D9", lambda m, c, t, h: (_quita_uso(m), c, t, h)),
]


def _set(man, campo, valor):
    m = copy.deepcopy(man)
    m["capas"]["cbn_puntos"][campo] = valor
    return m


def _tot(man, valor):
    m = copy.deepcopy(man)
    m["total"]["ha"] = valor
    return m


def _quita_uso(man):
    m = copy.deepcopy(man)
    m["usos"][3]["n"] = 0          # Bosques desaparece del conteo
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--negativas", action="store_true")
    args = ap.parse_args()

    if not os.path.isdir(DATOS):
        sys.exit(f"no existe {DATOS}")
    man, crudo, tam, hashes = leer()

    for nombre, capa in man["capas"].items():
        print(f"  {nombre}: {capa['filas']:,} filas, {capa['bytes']/1e6:.1f} MB, "
              f"sha256 {capa['sha256'][:16]}…")
    print(f"  total nacional: {man['total']['ha']:,.2f} ha en {man['total']['filas']:,} polígonos")
    print(f"  contra la cifra oficial de CONAF: {man['total']['ha'] - OFICIAL_HA:+.2f} ha "
          f"(tolerancia ±{TOL_OFICIAL:g})")

    fallos = comprobar(man, crudo, tam, hashes)
    if fallos:
        print("\nFALLA:")
        for f in fallos:
            print(f"  - {f}")
        return 1
    print("\nintegridad OK")

    if args.negativas:
        print("\n--- pruebas negativas: cada defecto DEBE poner roja su asercion ---")
        malas = 0
        for nombre, esperada, romper in NEGATIVAS:
            m2, c2, t2, h2 = romper(man, crudo, tam, hashes)
            f2 = comprobar(m2, c2, t2, h2)
            cazado = any(x.startswith(esperada) for x in f2)
            if not cazado:
                malas += 1
            print(f"  {nombre:<34} -> {'ROJA, correcto' if cazado else 'VERDE: EL GATE NO SIRVE'}")
        if malas:
            print(f"\n{malas} asercion(es) no cazan su propio defecto")
            return 1
        print("\ntodas las aserciones se han visto fallar")
    return 0


if __name__ == "__main__":
    sys.exit(main())
