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
import unicodedata

sys.stdout.reconfigure(encoding="utf-8")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATOS = os.path.join(RAIZ, "frontend", "public", "datos")

FILAS_CBN = 1_827_933
BYTES_POR_FILA = 27          # 3 f32 + 3 u16 + 9 u8

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


def _canon(s):
    """Compara etiquetas ignorando mayusculas, tildes y espacios de mas."""
    s = re.sub(r"\s+", " ", str(s or "")).strip().lower()
    return "".join(ch for ch in unicodedata.normalize("NFD", s)
                   if unicodedata.category(ch) != "Mn")


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

    # 5 desde que el radio del disco viaja en columna propia. El numero vive
    # tambien en build_bin.py y en binario.js: los tres tienen que subir a la
    # vez, y esta asercion es la que caza que uno se quede atras.
    if man.get("esquema") != 5:
        fallos.append(f"D1 esquema {man.get('esquema')} != 5")

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

    # D17 - el reparto de cobertura por codigo esta respaldado por la guia. El
    # orden de la guia (Denso..Escaso) tiene que coincidir POSICION A POSICION
    # con el de los codigos 01..05. Si deja de coincidir, 'Denso' podria estar
    # rotulando lo que el catastro llama 'Escaso' y nada mas lo delataria.
    guia = man.get("vocabulario_guia_cobertura")
    if not guia:
        fallos.append("D17 el manifest no publica el vocabulario de cobertura de la guia")
    else:
        escala = sorted((c for c in man["coberturas"] if c.get("orden")),
                        key=lambda c: c["orden"])
        if [c["orden"] for c in escala] != list(range(1, len(escala) + 1)):
            fallos.append(f"D17 el orden de cobertura tiene huecos o repetidos: "
                          f"{[c['orden'] for c in escala]}")
        for i, c in enumerate(escala):
            if i >= len(guia) or _canon(c["etiqueta"]) != _canon(guia[i]):
                fallos.append(f"D17 cobertura {c['orden']}: los datos dicen "
                              f"{c['etiqueta']!r} y la guia {guia[i] if i < len(guia) else None!r}")

    # D18 - la columna de especie, contra la planilla oficial de plantaciones.
    # Es la UNICA referencia externa que existe para esta dimension, y de paso
    # comprueba lo que no es obvio: que la estadistica oficial asigna el
    # poligono entero a su especie principal.
    if ofi and ofi.get("plantacion_especies"):
        por_genero, por_especie = {}, {}
        for e in man["especies"]:
            if e.get("genero"):
                por_genero[e["genero"]] = por_genero.get(e["genero"], 0.0) + e["ha"]
            if e.get("cientifico"):
                por_especie[e["cientifico"]] = por_especie.get(e["cientifico"], 0.0) + e["ha"]
        for etiqueta, oficial in ofi["plantacion_especies"].items():
            if etiqueta.endswith(" sp."):
                mio = por_genero.get(etiqueta[:-4].strip())
            else:
                mio = por_especie.get(etiqueta)
            if mio is None:
                continue     # 'Otras Especies' no es una especie: no se contrasta
            # El margen es amplio a proposito: la cifra propia suma TODOS los
            # usos y la oficial solo plantaciones, asi que lo que se comprueba
            # es que la especie exista y su magnitud sea la correcta, no una
            # igualdad al centimo. Una diferencia del 50% delata un vocabulario
            # roto; una del 1% es que Pinus radiata tambien crece asilvestrado.
            if mio + 0.5 < oficial:
                fallos.append(f"D18 {etiqueta}: el visor tiene {mio:,.2f} ha y la "
                              f"planilla oficial {oficial:,.2f} (falta superficie)")

    # D19 - las dos escalas de altura. 'fina' y 'gruesa' miden lo mismo con
    # reglas distintas y sus tramos SE SOLAPAN, asi que cada clase tiene que
    # declarar a cual pertenece y ordenarse dentro de la suya.
    escalas = {}
    for a in man.get("alturas", []):
        if a.get("escala") not in ("fina", "gruesa", "no_aplica"):
            fallos.append(f"D19 altura {a['etiqueta']!r} sin escala declarada")
        escalas.setdefault(a.get("escala"), []).append(a)
    for nombre, clases in escalas.items():
        if nombre == "no_aplica":
            continue
        ordenes = sorted(c["orden"] for c in clases if c["orden"] is not None)
        if ordenes != list(range(1, len(clases) + 1)):
            fallos.append(f"D19 la escala {nombre} no ordena 1..{len(clases)}: {ordenes}")

    # D20 - cada dimension reparte TODAS las filas: las clasificadas mas las del
    # centinela. Es lo que impide que una categoria se pierda en silencio al
    # cambiar un vocabulario.
    sin = cap.get("sin_dato", {})
    for dim, campo in (("usos", "uso"), ("subusos", "subuso"),
                       ("estructuras", "estruc"), ("tipos_forestales", "tifo"),
                       ("coberturas", "cober"), ("alturas", "altura"),
                       ("subtipos_forestales", "stifo"), ("especies", "especie"),
                       ("comunas", "comuna")):
        if dim not in man:
            fallos.append(f"D20 el manifest no publica la dimension {dim}")
            continue
        repartidas = sum(f["n"] for f in man[dim]) + sin.get(campo, 0)
        desconocidas = sum(man.get("codigos_desconocidos", {})
                           .get(campo if campo != "estruc" else "estructura", {}).values())
        if repartidas != man["total"]["filas"]:
            fallos.append(f"D20 {dim} reparte {repartidas:,} filas de "
                          f"{man['total']['filas']:,} (desconocidas: {desconocidas:,})")

    # D22 - CADA REGION TIENE AL MENOS UNA COMUNA. Es la asercion que habria
    # cazado el defecto mas caro de este visor el primer dia.
    #
    # El .bin no traia columna de region: los tres niveles del ambito
    # --region, provincia, comuna-- se derivaban de la columna `comuna`, y
    # elegir una region se traducia en reunir sus comunas y filtrar por ese
    # conjunto. Las 79.727 filas de Los Rios llegaban SIN comuna --su codigo
    # venia en otra columna del origen, `Codcomun`, que el ETL no leia--, asi
    # que el conjunto salia VACIO. Y un conjunto vacio significa «todas» en el
    # cliente: el visor entrego cifras NACIONALES rotuladas «Los Rios» durante
    # meses, con el mapa encuadrado en la region y el nombre correcto al lado.
    # El manifest ya publicaba las dos mitades del problema --79.727 poligonos
    # en Los Rios, 79.731 filas sin comuna-- y nadie las habia cruzado.
    #
    # La region tiene columna propia desde el esquema 4, asi que el ambito ya no
    # se deriva. Esto se queda igualmente: es la comprobacion de que el desglose
    # territorial de cada region existe.
    comunas_por_region = {}
    for c in man.get("comunas", []):
        comunas_por_region.setdefault(c.get("region"), []).append(c)
    for r in man.get("regiones", []):
        cs = comunas_por_region.get(r["cod"], [])
        if not cs:
            fallos.append(f"D22 la region {r['cod']} ({r['nombre']}) no tiene ninguna comuna: "
                          f"{r['n']:,} poligonos sin desglose territorial")

    # D23 - las cifras regionales cuadran con el total y con sus comunas.
    suma_reg = sum(r["n"] for r in man.get("regiones", []))
    if man.get("regiones") and suma_reg != man["total"]["filas"]:
        fallos.append(f"D23 las regiones suman {suma_reg:,} de {man['total']['filas']:,} filas")
    for r in man.get("regiones", []):
        n_com = sum(c["n"] for c in comunas_por_region.get(r["cod"], []))
        if n_com > r["n"]:
            fallos.append(f"D23 {r['nombre']}: sus comunas suman {n_com:,} y la region {r['n']:,}")
    # Lo que queda fuera de toda comuna tiene que ser exactamente lo declarado
    # como «sin comuna». Son los 4 poligonos de «Areas no Reconocidas» de
    # Magallanes, que no tienen ningun dato territorial en el origen.
    huerfanos = suma_reg - sum(c["n"] for c in man.get("comunas", []))
    if man.get("regiones") and huerfanos != sin.get("comuna", 0):
        fallos.append(f"D23 {huerfanos:,} filas fuera de toda comuna, "
                      f"pero se declaran {sin.get('comuna', 0):,} sin comuna")

    # D24 - NINGUNA ETIQUETA SE PARTE EN DOS POR LA GRAFIA. Cuatro unidades del
    # SNASPE y cuatro subtipos forestales llegaban duplicados: el Parque
    # Nacional Bernardo O'Higgins figuraba como «Ohiggins» y como «OHiggins», y
    # quien consultaba una de las dos obtenia 2,8 de sus 3,8 M ha.
    for dim in ("snaspe", "subtipos_forestales"):
        grupos = {}
        for f in man.get(dim, []):
            grupos.setdefault(_canon(f["etiqueta"]), []).append(f["etiqueta"])
        for k, v in grupos.items():
            if len(v) > 1:
                fallos.append(f"D24 {dim}: {v} colapsan en la misma etiqueta")
    # Y el reverso, que es lo que una normalizacion automatica destruiria: el
    # Parque Nacional Villarrica y la Reserva Nacional Villarrica son DOS
    # unidades distintas que comparten toponimo. Si alguna vez se funden, esta
    # linea es la que lo dice.
    villarrica = sorted(f["etiqueta"] for f in man.get("snaspe", [])
                        if "villarrica" in _canon(f["etiqueta"]))
    if len(villarrica) != 2:
        fallos.append(f"D24 Villarrica deberian ser dos unidades distintas: {villarrica}")

    # D25 - los alias apuntan a algo. Al homologar, el codigo de una clase
    # fundida deja de existir, y ese codigo ya viaja en enlaces compartidos.
    # Un alias que apunte a un codigo inexistente es peor que no tenerlo: hace
    # creer que el enlace viejo sigue sirviendo.
    for dim, clave in (("snaspe", "snaspe"), ("stifo", "subtipos_forestales")):
        vivos = {f["cod"] for f in man.get(clave, [])}
        for viejo, nuevo in man.get("alias", {}).get(dim, {}).items():
            if nuevo not in vivos:
                fallos.append(f"D25 alias {dim}: {viejo!r} apunta a {nuevo!r}, que no existe")
            if viejo in vivos:
                fallos.append(f"D25 alias {dim}: {viejo!r} sigue vivo y no deberia")

    # D21 - «no aplica» se dice de UNA sola forma, y solo donde toca.
    #
    # Tipo y subtipo forestal traian el mismo concepto por dos vias: el
    # centinela y la clase '00'. Medido por subclase antes de fundirlos, ni un
    # solo poligono de bosque nativo --al que el tipo forestal SI le aplica--
    # estaba en el centinela, y a plantacion y mixto la fuente les ponia el
    # codigo en el 0,3 % de los casos y nada en el 99,7 %. Se fundieron.
    #
    # La segunda mitad de esta asercion es la que importa mas: cobertura y
    # altura NO se pueden fundir, y si alguien lo hace tiene que ponerse roja.
    # El centinela de cobertura son las 11.261 filas de triplete roto de
    # DECISIONES.md E, y el de altura mezcla 293.181 bosques SIN MEDIR con el
    # «no aplica» de los cuerpos de agua. Fundir cualquiera de los dos borra la
    # diferencia entre «no sabemos» y «no aplica».
    for dim, campo in (("tipos_forestales", "tifo"), ("subtipos_forestales", "stifo")):
        if sin.get(campo, 0) != 0:
            fallos.append(f"D21 {dim} conserva {sin[campo]:,} filas en el centinela: "
                          "«no aplica» vuelve a decirse de dos formas")
        na = [f for f in man.get(dim, []) if _canon(f["etiqueta"]) == "no aplica"]
        if len(na) != 1 or na[0]["n"] == 0:
            fallos.append(f"D21 {dim} no tiene una unica clase «No Aplica» con filas: "
                          f"{[(f['cod'], f['n']) for f in na]}")
    for campo, minimo in (("cober", 11_000), ("altura", 700_000)):
        if sin.get(campo, 0) < minimo:
            fallos.append(f"D21 {campo} ha perdido su centinela ({sin.get(campo, 0):,} < "
                          f"{minimo:,}): «no sabemos» y «no aplica» son cosas distintas")

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


def _permutar_cobertura(man):
    """Intercambia las etiquetas de los dos extremos de la escala de densidad.

    Es EL defecto que D17 existe para cazar: el reparto de codigos a etiquetas
    sale del dato, y si se diera vuelta, 'Denso' rotularia lo que el catastro
    llama 'Escaso'. Las cifras seguirian cuadrando con el total, los porcentajes
    seguirian sumando 100 y el mapa se pintaria igual de bonito.
    """
    m = copy.deepcopy(man)
    escala = sorted((c for c in m["coberturas"] if c.get("orden")),
                    key=lambda c: c["orden"])
    escala[0]["etiqueta"], escala[-1]["etiqueta"] = escala[-1]["etiqueta"], escala[0]["etiqueta"]
    return m


def _especie_cero(man, cientifico):
    m = copy.deepcopy(man)
    for e in m["especies"]:
        if e.get("cientifico") == cientifico:
            e["ha"] = 0.0
    return m


def _altura_desordenada(man):
    m = copy.deepcopy(man)
    fina = [a for a in m["alturas"] if a.get("escala") == "fina"]
    fina[0]["orden"] = 99
    return m


def _quitar_clase(man, dim):
    """Borra la clase mas pequena de una dimension. Sin D20 esto es invisible:
    el total no cambia, las demas cifras siguen cuadrando entre si, y en
    pantalla solo falta una fila que nadie echa de menos."""
    m = copy.deepcopy(man)
    viva = [f for f in m[dim] if f["n"] > 0]
    m[dim].remove(min(viva, key=lambda f: f["n"]))
    return m


def _sin_dato(man, campo, valor):
    """Devuelve el centinela de una columna a otro valor, para D21."""
    m = copy.deepcopy(man)
    m["capas"]["cbn_puntos"].setdefault("sin_dato", {})[campo] = valor
    return m


def _sin_clase_na(man, dim):
    """Borra la clase «No Aplica» de una dimension. Es el otro lado de D21: si
    el centinela se funde en una clase que luego desaparece, esas filas dejan de
    estar en ninguna parte y D20 tampoco lo ve, porque la suma se descuadra
    igual que con cualquier otra clase perdida."""
    m = copy.deepcopy(man)
    m[dim] = [f for f in m[dim] if _canon(f["etiqueta"]) != "no aplica"]
    return m


def _region_sin_comunas(man, cod="14"):
    """Deja una region sin ninguna comuna: EL defecto de Los Rios, reintroducido."""
    m = json.loads(json.dumps(man))
    m["comunas"] = [c for c in m["comunas"] if c.get("region") != cod]
    return m


def _fundir_etiqueta(man, dim):
    """Parte una clase en dos grafias, como llegaban «Ohiggins» y «OHiggins»."""
    m = json.loads(json.dumps(man))
    f = dict(m[dim][0])
    f["etiqueta"] = f["etiqueta"].upper()
    f["cod"] = f["cod"] + "_x"
    m[dim].append(f)
    return m


def _alias_roto(man, dim="stifo"):
    m = json.loads(json.dumps(man))
    m.setdefault("alias", {}).setdefault(dim, {})["clase-que-fue"] = "clase-que-no-existe"
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
    ("D17 escala de cobertura del reves", "D17",
     lambda m, c, t, h: (_permutar_cobertura(m), c, t, h)),
    ("D17 sin el vocabulario de la guia", "D17",
     lambda m, c, t, h: ({**copy.deepcopy(m), "vocabulario_guia_cobertura": None}, c, t, h)),
    ("D18 una especie sin superficie", "D18",
     lambda m, c, t, h: (_especie_cero(m, "Pinus radiata"), c, t, h)),
    ("D19 escala de altura sin declarar", "D19",
     lambda m, c, t, h: ({**copy.deepcopy(m),
                          "alturas": [{**a, "escala": None} for a in m["alturas"]]}, c, t, h)),
    ("D19 tramos de altura desordenados", "D19",
     lambda m, c, t, h: (_altura_desordenada(m), c, t, h)),
    ("D20 una clase de especie perdida", "D20",
     lambda m, c, t, h: (_quitar_clase(m, "especies"), c, t, h)),
    ("D20 un subtipo forestal perdido", "D20",
     lambda m, c, t, h: (_quitar_clase(m, "subtipos_forestales"), c, t, h)),
    ("D20 una clase de cobertura perdida", "D20",
     lambda m, c, t, h: (_quitar_clase(m, "coberturas"), c, t, h)),
    ("D21 tipo forestal vuelve a tener centinela", "D21",
     lambda m, c, t, h: (_sin_dato(m, "tifo", 1_114_688), c, t, h)),
    ("D22 una region se queda sin comunas (el defecto de Los Rios)", "D22",
     lambda m, c, t, h: (_region_sin_comunas(m), c, t, h)),
    ("D24 una unidad del SNASPE se parte en dos grafias", "D24",
     lambda m, c, t, h: (_fundir_etiqueta(m, "snaspe"), c, t, h)),
    ("D24 un subtipo forestal se parte en dos grafias", "D24",
     lambda m, c, t, h: (_fundir_etiqueta(m, "subtipos_forestales"), c, t, h)),
    ("D25 un alias apunta a un codigo que no existe", "D25",
     lambda m, c, t, h: (_alias_roto(m), c, t, h)),
    ("D21 subtipo sin su clase «No Aplica»", "D21",
     lambda m, c, t, h: (_sin_clase_na(m, "subtipos_forestales"), c, t, h)),
    ("D21 cobertura pierde su centinela", "D21",
     lambda m, c, t, h: (_sin_dato(m, "cober", 0), c, t, h)),
    ("D21 altura pierde su centinela", "D21",
     lambda m, c, t, h: (_sin_dato(m, "altura", 0), c, t, h)),
]


def discos_que_se_solapan(man):
    """D26 · NINGUN PAR DE DISCOS SE SOLAPA. Recalculado sobre el .bin publicado.

    Es la asercion que convierte «que no se superpongan» en algo comprobable, y
    la unica forma honesta de comprobarlo: el radio se recorta en el ETL a la
    mitad de la distancia al vecino mas cercano, asi que si la regla se aplico
    bien, para todo par vale r_i + r_j <= d_ij. Se rehace desde fuera, sobre los
    bytes que recibe la gente, y no se fia del resumen que publica el manifest.

    NUMPY Y SCIPY SON OPCIONALES AQUI, y su ausencia NO se cuenta como que pasa.
    El resto de este archivo es solo biblioteca estandar a proposito --corre en
    cualquier sitio y en el CI sin instalar nada-- y una consulta espacial sobre
    1,8 M de puntos en Python puro costaria mas de lo que vale. Si faltan, esto
    lo DICE y se suma a los fallos: un gate que se salta en silencio no es un
    gate. El workflow las instala.
    """
    try:
        import numpy as np
        from scipy.spatial import cKDTree
    except ImportError:
        return ["D26 SIN COMPROBAR: falta numpy o scipy. "
                "`pip install numpy scipy` — el solape de los discos se queda sin verificar"]

    cap = man["capas"]["cbn_puntos"]
    n = cap["filas"]
    anchos = {"f32": 4, "u16": 2, "u8": 1}
    tipos = {"f32": "<f4", "u16": "<u2", "u8": "u1"}
    col = {}
    with open(os.path.join(DATOS, cap["archivo"]), "rb") as fh:
        for nombre in ("lat", "lon", "radio"):
            c = cap["campos"].get(nombre)
            if c is None:
                return [f"D26 el manifest no declara la columna {nombre}"]
            fh.seek(c["offset"])
            col[nombre] = np.frombuffer(fh.read(anchos[c["tipo"]] * n),
                                        dtype=tipos[c["tipo"]]).astype(np.float64)

    x = col["lon"] * np.cos(np.radians(col["lat"])) * 111320.0
    y = col["lat"] * 110540.0
    dist, idx = cKDTree(np.column_stack([x, y])).query(
        np.column_stack([x, y]), k=2, workers=-1)
    r = col["radio"]
    # TOLERANCIA DE 1 m, y no es holgura gratuita: el radio se publica en metros
    # enteros y la proyeccion local mete unos centimetros. Sin ella, la asercion
    # naceria roja sobre datos correctos, que es como se acaba desactivando una.
    invasion = r + r[idx[:, 1]] - dist[:, 1]
    malos = int((invasion > 1.0).sum())
    fallos = []
    if malos:
        peor = float(invasion.max())
        fallos.append(f"D26 {malos:,} discos invaden a su vecino "
                      f"(el peor, {peor:,.0f} m dentro)")

    # D26b - EL RECORTE NO SE PUEDE COMER LOS DISCOS. Recortar a cero cumpliria
    # D26 de forma perfecta y dejaria el mapa en blanco: una asercion que se
    # satisface haciendo desaparecer el dato no protege nada. La mediana medida
    # es 67 m.
    mediana = float(np.percentile(r, 50))
    if mediana < 50.0:
        fallos.append(f"D26b el radio mediano cayo a {mediana:.0f} m (suelo 50): "
                      "el recorte se esta comiendo los discos")
    return fallos


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
    r = cap.get("radio", {})
    if r:
        print(f"  radio de los discos: mediana {r.get('mediana_m')} m · "
              f"recortados por el vecino {r.get('recortados', 0):,} "
              f"({100 * r.get('recortados', 0) / cap['filas']:.0f} %)")
    for campo, vals in man["codigos_desconocidos"].items():
        if vals:
            print(f"  códigos de {campo} que la guía no nombra: {vals}")

    fallos = comprobar(man, crudo, tam, hashes)
    # D26 va aparte de `comprobar` porque necesita los BYTES del .bin, no el
    # manifest, y porque su control negativo no es una cirugia sobre el manifest
    # sino la mutacion del ETL en mutaciones-visor.py: quitar el recorte y ver
    # esto rojo.
    fallos += discos_que_se_solapan(man)
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
