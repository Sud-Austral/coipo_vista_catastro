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

FILAS_CBN = 1_827_933
BYTES_POR_FILA = 19          # 3 f32 + 1 u16 + 5 u8

# Las cifras oficiales NO se escriben aqui: se leen de oficiales.json, que
# `ETL/cifras_oficiales.py` parsea de la planilla que CONAF publico dentro de la
# propia base. Una constante escrita a mano se desincroniza el dia que alguien
# actualiza la planilla, y entonces la prueba mide su propia copia.

# La tolerancia sale de la DEFINICION, no del gusto: el unico desvio posible
# entre un total y la suma de sus partes es el redondeo de cada parte a dos
# decimales, o sea n x 0,005 ha. Un TOL_PARTES plano de 0,1 era un numero
# elegido a ojo: cazo el fallo de acumulacion en float32 (3,12 ha) por suerte de
# magnitud, y con las partes ya corregidas el mismo total malo se quedaba en
# 0,48 y habria pasado en verde.
def TOL_TABLA(n):
    return n * 0.005


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


def suma_ha(filas, **filtro):
    return sum(f["ha"] for f in filas
               if all(f.get(k) == v for k, v in filtro.items()))


def comprobar(man, crudo, tam, hashes):
    """Devuelve la lista de fallos. Recibe todo lo del disco ya leido para que
    las pruebas negativas puedan alterar una cosa sin tocar los archivos."""
    fallos = []
    cap = man["capas"]["cbn_puntos"]

    if man.get("esquema") != 2:
        fallos.append(f"D1 esquema {man.get('esquema')} != 2")

    # Ninguna marca de tiempo. Es lo que permite commitear datos: si el manifest
    # llevara fecha, cada regeneracion ensuciaria git aunque los datos fueran
    # identicos, y el historial creceria sin motivo.
    if re.search(r"\d{4}-\d{2}-\d{2}T", crudo):
        fallos.append("D2 el manifest contiene una marca de tiempo")

    real = tam.get(cap["archivo"])
    if real is None:
        fallos.append(f"D3 falta {cap['archivo']}")
        return fallos
    if real != cap["bytes"]:
        fallos.append(f"D3 {real} bytes en disco, el manifest dice {cap['bytes']}")

    n = cap["filas"]
    # Los offsets tienen que ser contiguos y ascendentes, y el total cuadrar con
    # el ancho de fila. Un offset corrompido hoy pasaria en verde y el mapa
    # saldria PLAUSIBLE, con los puntos desplazados.
    anchos = {"f32": 4, "u16": 2, "u8": 1}
    esperado = 0
    for nombre, c in cap["campos"].items():
        if c["offset"] != esperado:
            fallos.append(f"D4 offset de {nombre}: {c['offset']} != {esperado}")
        esperado += anchos[c["tipo"]] * n
    if cap["bytes"] != esperado:
        fallos.append(f"D4 {cap['bytes']} != {esperado} para {n} filas")
    if cap["bytes"] != n * BYTES_POR_FILA:
        fallos.append(f"D4 ancho de fila != {BYTES_POR_FILA} B")

    if hashes.get(cap["archivo"]) != cap["sha256"]:
        fallos.append("D5 sha256 no coincide")

    if real > 50 * 1024 * 1024:
        fallos.append(f"D6 {real/1048576:.0f} MiB, por encima del aviso de 50 MiB")

    # --- las cifras cierran, contando los centinelas -------------------------
    # Las filas en centinela NO se descuentan a mano ni se ignoran: entran en la
    # ecuacion. Es la diferencia entre "las partes suman el total" y "las partes
    # mas lo que no supimos clasificar suman el total", y solo la segunda es
    # cierta. La estructura del bosque nativo se desvia -0,50 ha por una unica
    # fila con el codigo 040200, que la guia oficial no nombra.
    total = man["total"]["ha"]
    suma_usos = suma_ha(man["usos"])
    if abs(suma_usos - total) > TOL_TABLA(len(man["usos"])):
        fallos.append(f"D7 los usos suman {suma_usos:,.2f} y el total dice {total:,.2f}")

    ofi = leer_oficiales()
    if ofi is None:
        fallos.append("D8 falta oficiales.json: no hay contra que contrastar")
    else:
        # Se comprueban TODAS las dimensiones publicadas, no solo el total: un
        # ETL puede acertar el total y repartirlo mal.
        for clave, valor in sorted(ofi["total_pais"].items()):
            if clave == "total":
                mio, limite = total, TOL_OFICIAL
            else:
                dim, cod = clave.split(":")
                lista = man["usos"] if dim == "uso" else man["subusos"]
                fila = next((x for x in lista if x["cod"] == cod), None)
                mio, limite = (fila["ha"] if fila else None), 10.0
            if mio is None:
                fallos.append(f"D8 no hay cifra propia para {clave}")
                continue
            if abs(mio - valor) > limite:
                fallos.append(f"D8 {clave}: {mio:,.2f} contra {valor:,.2f} oficial "
                              f"({mio - valor:+,.2f}, tolerancia {limite:g})")

    if man["total"]["filas"] != FILAS_CBN:
        fallos.append(f"D9 filas {man['total']['filas']:,} != {FILAS_CBN:,}")
    if sum(u["n"] for u in man["usos"]) != man["total"]["filas"]:
        fallos.append("D9 los conteos por uso no suman el total de filas")

    # D10 - los subusos de Bosques suman Bosques.
    bosques = next(u for u in man["usos"] if u["cod"] == "04")
    sub = [s for s in man["subusos"] if s.get("uso") == "04" and s["n"]]
    if abs(suma_ha(sub) - bosques["ha"]) > TOL_TABLA(len(sub) + 1):
        fallos.append(f"D10 subusos de Bosques suman {suma_ha(sub):,.2f} "
                      f"y Bosques dice {bosques['ha']:,.2f}")

    # D11 - las estructuras del bosque nativo, MAS lo no clasificable, suman BN.
    bn = next(s for s in man["subusos"] if s["cod"] == "0402")
    est = [e for e in man["estructuras"] if e.get("subuso") == "0402" and e["n"]]
    huerfano = sum(v for k, v in man["codigos_desconocidos"]["estructura"].items()
                   if k.startswith("0402"))
    # El manifest publica cuantas FILAS son huerfanas, no cuantas hectareas, asi
    # que la comprobacion se hace en filas y la de hectareas se acota por arriba.
    if sum(e["n"] for e in est) + huerfano != bn["n"]:
        fallos.append(f"D11 las estructuras del bosque nativo suman "
                      f"{sum(e['n'] for e in est) + huerfano:,} filas y el subuso dice {bn['n']:,}")

    # D12 - las categorias del SNASPE suman el total del SNASPE.
    por_cat = {}
    for s in man["snaspe"]:
        if s["n"]:
            por_cat[s["categoria"]] = por_cat.get(s["categoria"], 0.0) + s["ha"]
    if None in por_cat:
        fallos.append("D12 hay unidades del SNASPE sin categoria asignada")
    if abs(sum(por_cat.values()) - suma_ha(man["snaspe"])) > TOL_TABLA(len(man["snaspe"])):
        fallos.append("D12 las categorias del SNASPE no suman el total de unidades")

    # D13 - todo centinela declarado tiene su cuenta publicada, y al reves.
    declarados = {k for k, c in cap["campos"].items() if c["centinela"] is not None}
    if declarados != set(cap["sin_dato"]):
        fallos.append(f"D13 centinelas declarados {sorted(declarados)} != "
                      f"contados {sorted(cap['sin_dato'])}")

    # D14 - los codigos que la guia no nombra se publican. Cero es un valor
    # legitimo; lo que no vale es que el campo no exista.
    if "codigos_desconocidos" not in man:
        fallos.append("D14 el manifest no publica los codigos desconocidos")

    # D15 - las correcciones del SNASPE se publican, nunca se aplican en silencio.
    if not man.get("snaspe_categoria_corregida"):
        fallos.append("D15 no se publican las correcciones de categoria del SNASPE")

    # D16 - la decision de los 7.191 poligonos, comprobada contra la cifra
    # oficial de Plantacion. Es la asercion que se pone roja si alguien vuelve a
    # agregar por texto.
    pl = next(s for s in man["subusos"] if s["cod"] == "0401")
    if ofi:
        oficial_pl = ofi["total_pais"].get("subuso:0401")
        if oficial_pl and abs(pl["ha"] - oficial_pl) > 0.1:
            fallos.append(f"D16 Plantacion {pl['ha']:,.2f} != oficial {oficial_pl:,.2f} "
                          f"(se agrego por texto?)")

    return fallos


def leer_oficiales():
    """Las cifras publicadas por CONAF. Si el archivo no esta, se dice: la
    comprobacion contra el exterior se pierde, y callarlo dejaria el gate
    aparentemente verde sin su unica asercion que mira fuera."""
    ruta = os.path.join(DATOS, "oficiales.json")
    if not os.path.exists(ruta):
        return None
    with open(ruta, encoding="utf-8") as fh:
        return json.load(fh)


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


def _cap(man, campo, valor):
    m = copy.deepcopy(man)
    m["capas"]["cbn_puntos"][campo] = valor
    return m


def _off(man, campo, valor):
    m = copy.deepcopy(man)
    m["capas"]["cbn_puntos"]["campos"][campo]["offset"] = valor
    return m


def _uso(man, cod, ha):
    m = copy.deepcopy(man)
    next(u for u in m["usos"] if u["cod"] == cod)["ha"] = ha
    return m


def _sub(man, cod, ha):
    m = copy.deepcopy(man)
    next(s for s in m["subusos"] if s["cod"] == cod)["ha"] = ha
    return m


NEGATIVAS = [
    ("D2 marca de tiempo", "D2",
     lambda m, c, t, h: (m, c + '"generado":"2026-08-20T10:00:00"', t, h)),
    ("D3 tamano declarado erroneo", "D3",
     lambda m, c, t, h: (_cap(m, "bytes", 123), c, t, h)),
    ("D4 offset corrompido", "D4",
     lambda m, c, t, h: (_off(m, "lat", 999), c, t, h)),
    ("D5 sha256 alterado", "D5",
     lambda m, c, t, h: (_cap(m, "sha256", "0" * 64), c, t, h)),
    ("D7 total incoherente con sus partes", "D7",
     lambda m, c, t, h: ({**copy.deepcopy(m), "total": {**m["total"], "ha": m["total"]["ha"] + 5}}, c, t, h)),
    ("D8 total lejos de lo oficial", "D8",
     lambda m, c, t, h: ({**copy.deepcopy(m), "total": {**m["total"], "ha": 75_700_000.0}}, c, t, h)),
    ("D8 un uso repartido mal", "D8",
     lambda m, c, t, h: (_uso(m, "03", 29_000_000.0), c, t, h)),
    ("D10 un subuso de Bosques perdido", "D10",
     lambda m, c, t, h: (_sub(m, "0403", 0.0), c, t, h)),
    ("D16 Plantacion agregada por texto", "D16",
     lambda m, c, t, h: (_sub(m, "0401", 3_118_188.80), c, t, h)),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--negativas", action="store_true")
    args = ap.parse_args()

    if not os.path.isdir(DATOS):
        sys.exit(f"no existe {DATOS}")
    man, crudo, tam, hashes = leer()
    cap = man["capas"]["cbn_puntos"]

    print(f"  cbn_puntos: {cap['filas']:,} filas x {BYTES_POR_FILA} B = "
          f"{cap['bytes']/1e6:.1f} MB · sha256 {cap['sha256'][:16]}…")
    ofi = leer_oficiales()
    oficial_total = ofi["total_pais"]["total"] if ofi else None
    print(f"  total nacional {man['total']['ha']:,.2f} ha" + (
        f" · {man['total']['ha'] - oficial_total:+.2f} contra la cifra oficial "
        f"(±{TOL_OFICIAL:g})" if oficial_total else " · SIN oficiales.json"))
    pl = next(s for s in man["subusos"] if s["cod"] == "0401")
    bn = next(s for s in man["subusos"] if s["cod"] == "0402")
    oficial_pl = ofi["total_pais"].get("subuso:0401") if ofi else None
    print(f"  bosque nativo {bn['ha']:,.2f} ha · plantación {pl['ha']:,.2f} ha" + (
        f" ({pl['ha'] - oficial_pl:+.2f} contra la oficial)" if oficial_pl else ""))
    print(f"  filas sin dato: {cap['sin_dato']}")
    for campo, vals in man["codigos_desconocidos"].items():
        if vals:
            print(f"  códigos de {campo} que la guía no nombra: {vals}")

    fallos = comprobar(man, crudo, tam, hashes)
    if fallos:
        print("\nFALLA:")
        for f in fallos:
            print(f"  - {f}")
        return 1
    print("\nintegridad OK")

    if args.negativas:
        print("\n--- pruebas negativas: cada defecto DEBE poner roja su aserción ---")
        malas = 0
        for nombre, esperada, romper in NEGATIVAS:
            m2, c2, t2, h2 = romper(man, crudo, tam, hashes)
            f2 = comprobar(m2, c2, t2, h2)
            cazado = any(x.startswith(esperada) for x in f2)
            malas += 0 if cazado else 1
            print(f"  {nombre:<38} -> {'ROJA, correcto' if cazado else 'VERDE: EL GATE NO SIRVE'}")
        if malas:
            print(f"\n{malas} aserción(es) no cazan su propio defecto")
            return 1
        print("\ntodas las aserciones se han visto fallar")
    return 0


if __name__ == "__main__":
    sys.exit(main())
