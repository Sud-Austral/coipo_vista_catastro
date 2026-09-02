"""Verifica el sitio COMPILADO en los tres regímenes de panel.

Sirve frontend/dist en /coipo_vista_catastro/ -- no en la raíz-- porque servirlo
en la raíz enmascara justo el defecto más caro de este stack: un `base` mal
resuelto funciona en la raíz y rompe publicado.

Bloquea la red hacia los proveedores de teselas: la verificación no debe
depender de un tercero, y un mapa base claro falsearía el conteo de píxeles.

Uso:  python frontend/verificacion/verificar.py [--ver]
"""

import argparse
import base64
import functools
import http.server
import json
import math
import os
import re
import shutil
import socketserver
import sys
import threading
import time
import unicodedata

import numpy as np
import requests
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
sys.path.insert(0, os.path.join(RAIZ, "spike"))
from medir import Cdp, lanzar_chrome  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

DIST = os.path.join(RAIZ, "frontend", "dist")
BASE = "/coipo_vista_catastro/"
# arcgisonline.com sirve CINCO de los siete mapas base desde la migracion de
# agosto de 2026; cartocdn.com salio de BASEMAPS y sale tambien de aqui, porque
# una lista con hosts fantasma deja de ser legible y a la proxima nadie sabra si
# sigue por necesidad o por olvido.
TILES = ("openstreetmap.org", "arcgisonline.com", "eox.at")

# Los tres regímenes, con un ancho a cada lado de los cortes (1200 y 900).
REGIMENES = [
    (1440, 1000, 1, "anclado · los dos paneles"),
    (1050, 900, 2, "mixto · derecho en cajón"),
    (800, 900, 3, "móvil · los dos en cajón"),
]


class Manejador(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split("?", 1)[0].split("#", 1)[0]
        if not p.startswith(BASE):
            return os.path.join(DIST, "__404__")
        return super().translate_path(p[len(BASE) - 1:])

    def log_message(self, *a):
        pass


def servir():
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Manejador, directory=DIST))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def esperar(cdp, expr, segundos=120):
    """Se espera una CONDICIÓN, nunca un reloj. Dormir un tiempo fijo tras una
    transición parece de sobra hasta el día que la máquina va cargada."""
    t0 = time.time()
    while time.time() - t0 < segundos:
        if cdp.evaluar(expr):
            return (time.time() - t0) * 1000
        time.sleep(0.2)
    return None


# Anchos y dtypes del .bin columnar. MISMO contrato que frontend/src/datos/
# binario.js: los offsets los declara el manifest y aqui solo se abren vistas.
ANCHO_BIN = {"f32": 4, "u16": 2, "u8": 1}
NP_BIN = {"f32": "<f4", "u16": "<u2", "u8": "u1"}
# Una fila cualquiera del Catastro. El VALOR no importa --lo que se espera se
# lee del propio .bin, asi que sobrevive a un reproceso del ETL--; solo importa
# que sea una fila que exista.
FILA_PRUEBA = 900_000
# Un punto en el Pacifico, dentro de LIMITES y sin un solo poligono del
# Catastro: el control negativo.
MAR = (-30.0, -76.0)

FICHA_ABIERTA = "!!document.querySelector('dialog.ficha[open]')"

# Techo de la pasada del cruce, como RED DE SEGURIDAD y no como gate fino.
#
# Aqui la medida es ruidosa de verdad: Chrome headless sin GPU compitiendo con
# el resto de la maquina daba 45 ms en una corrida y 158 en la siguiente sin
# tocar nada, con picos de 186. Se toma la mediana de cinco y el techo va holgado
# a proposito, porque un rojo intermitente acaba con la asercion desactivada.
#
# EL GATE DE COSTE DE VERDAD esta en marginales.mjs, que corre en Node, en el CI
# y con mediana de nueve. Este solo caza que la pasada se dispare aqui tambien.
#
# SUBIO DE 400 A 900, y no por conveniencia: la pasada hace hoy el DOBLE de
# trabajo que cuando se fijo el 400. Entonces recorria diez dimensiones; ahora
# son veinte --seis derivadas de la especie, mas region, proteccion, tamano y
# ano-- y el bucle de acumulacion las visita TODAS por cada fila que pasa el
# filtro. Medido antes y despues del ultimo trio: la mediana en el navegador paso
# de ~85 ms a 195, con un peor caso de 330. Dejarlo en 400 era garantizar un rojo
# intermitente, que es como se acaba desactivando una asercion.
#
# 900 sigue siendo un gate real: caza que la pasada se dispare un orden de
# magnitud, que es para lo que esta. El fino sigue en Node, con mediana de nueve
# y techo de 500 --medido ahi: 128 a 197 ms--.
TECHO_CRUCE_MS = 900

# Techo del PRIMER PINTADO con los discos ya grandes, contado desde que los datos
# estan en memoria. Resolucion: una captura de pantalla, ~150 ms. Es una red de
# seguridad contra una regresion de orden de magnitud, no un gate fino.
TECHO_PINTADO_MS = 6000

MODAL_FILTRO = "!!document.querySelector('dialog.modal-filtro[open]')"

# Cuantos botones tiene el panel: Territorio + las DIECIOCHO dimensiones de
# FILTROS + Imagen de fondo + Informacion, Descargar y Compartir. EL NUMERO SE
# ACTUALIZA A MANO Y A PROPOSITO. Es la cuenta que caza que un control
# desaparezca en silencio --que es como se pierde uno--, asi que derivarla de la
# propia pagina la volveria una tautologia.
CONTROLES = 23


def abrir_grupo(cdp, titulo):
    """Pulsa el boton de una dimension y espera a que su modal este montado.

    Los filtros dejaron de ser ocho <details> desplegables: ahora cada dimension
    es un boton que abre un <dialog>. El boton conserva la clase `.grupo-filtro`
    y sus `.gf-titulo` / `.gf-total` / `.gf-activas`, y la lista del modal
    conserva `.gf-opcion` y compania, asi que el cambio se absorbe AQUI y en
    `marcar_clase`, y ninguna asercion tuvo que reescribirse."""
    r = cdp.evaluar("""
      (() => {
        const b = [...document.querySelectorAll('.grupo-filtro')]
          .find(d => d.querySelector('.gf-titulo')?.textContent === %s)
        if (!b) return 'sin grupo'
        b.click()
        return 'ok'
      })()
    """ % json.dumps(titulo))
    if r != "ok":
        return r
    return "ok" if esperar(cdp, MODAL_FILTRO, segundos=10) else "no abrio"


def cerrar_grupo(cdp):
    cdp.evaluar("document.querySelector('.modal-filtro .mf-listo')?.click()")
    esperar(cdp, f"!({MODAL_FILTRO})", segundos=10)


# Lo que se VE de una dimension: el boton (total y cuenta de activas) y, dentro
# del modal, las filas con su etiqueta, sus subtitulos y su cifra, mas los pies.
_LEER = """
(() => {
  const b = [...document.querySelectorAll('.grupo-filtro')]
    .find(d => d.querySelector('.gf-titulo')?.textContent === %s)
  const m = document.querySelector('dialog.modal-filtro[open]')
  if (!b || !m) return null
  return {
    total: b.querySelector('.gf-total')?.textContent,
    activas: b.querySelector('.gf-activas')?.textContent ?? null,
    buscador: !!m.querySelector('.gf-buscar input'),
    filas: [...m.querySelectorAll('.gf-opcion')].map(l => ({
      etq: l.querySelector('.gf-etq')?.childNodes[0]?.textContent?.trim(),
      sub: [...l.querySelectorAll('.gf-sub')].map(e => e.textContent),
      cifra: l.querySelector('.gf-cifra')?.textContent,
      marcada: !!l.querySelector('input')?.checked,
    })),
    pies: [...m.querySelectorAll('.nota')].map(p => p.textContent.trim()),
  }
})()
"""


def grupo_filtro(cdp, titulo):
    """Abre la dimension, la lee y la vuelve a cerrar."""
    if abrir_grupo(cdp, titulo) != "ok":
        return None
    datos = json.loads(cdp.evaluar("JSON.stringify(%s)" % (_LEER % json.dumps(titulo))))
    cerrar_grupo(cdp)
    return datos


def marcar_clase(cdp, titulo, etiqueta, dejar_abierto=False):
    """Marca una clase POR SU ETIQUETA, no por su posicion: el orden de la lista
    depende de la superficie y cambia con el recorte."""
    if abrir_grupo(cdp, titulo) != "ok":
        return "sin grupo"
    r = cdp.evaluar("""
      (() => {
        const m = document.querySelector('dialog.modal-filtro[open]')
        const l = [...m.querySelectorAll('.gf-opcion')]
          .find(x => x.querySelector('.gf-etq').childNodes[0].textContent.trim() === %s)
        if (!l) return 'sin clase'
        l.querySelector('input').click()
        return 'ok'
      })()
    """ % json.dumps(etiqueta))
    if not dejar_abierto:
        cerrar_grupo(cdp)
    return r


def leer_fila(k=FILA_PRUEBA):
    """Una fila del .bin COMPILADO, leida con los offsets que declara su manifest."""
    man = json.load(open(os.path.join(DIST, "datos", "manifest.json"), encoding="utf-8"))
    capa = man["capas"]["cbn_puntos"]
    v = {}
    with open(os.path.join(DIST, "datos", capa["archivo"]), "rb") as fh:
        for nombre, c in capa["campos"].items():
            fh.seek(c["offset"] + ANCHO_BIN[c["tipo"]] * k)
            v[nombre] = np.frombuffer(fh.read(ANCHO_BIN[c["tipo"]]), dtype=NP_BIN[c["tipo"]])[0]
    return man, v


def clic(cdp, x, y):
    cdp.enviar("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y,
               button="left", clickCount=1, buttons=1)
    cdp.enviar("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y,
               button="left", clickCount=1, buttons=0)


def pulsar_enter(cdp):
    """Un pulsado FIEL: keyDown --Chrome genera el keypress si nadie lo impide--
    y keyUp. Mandar ademas un 'char' a mano no simula un teclado, simula dos
    pulsados, y activaria el boton que la ficha acaba de enfocar."""
    cdp.enviar("Input.dispatchKeyEvent", type="keyDown", key="Enter", code="Enter",
               text="\r", unmodifiedText="\r", windowsVirtualKeyCode=13, nativeVirtualKeyCode=13)
    time.sleep(0.2)
    cdp.enviar("Input.dispatchKeyEvent", type="keyUp", key="Enter", code="Enter",
               windowsVirtualKeyCode=13, nativeVirtualKeyCode=13)


def enfocar_mapa(cdp, segundos=6):
    """Deja el foco EN el contenedor del mapa y comprueba que se queda.

    Cerrar un <dialog> devuelve el foco al elemento anterior de forma asincrona,
    asi que pedirlo y pulsar Enter acto seguido es una carrera: se vio a V-26
    caerse sola por esto en una tanda que no tocaba nada del teclado. Se
    reintenta y se confirma dos veces separadas, o el diagnostico siguiente
    seria un defecto que no existe."""
    en_el_mapa = "document.activeElement === document.querySelector('.leaflet-container')"
    t0 = time.time()
    while time.time() - t0 < segundos:
        cdp.evaluar("document.querySelector('.leaflet-container').focus()")
        if cdp.evaluar(en_el_mapa):
            time.sleep(0.15)
            if cdp.evaluar(en_el_mapa):
                return True
        time.sleep(0.2)
    return False


def metros_por_pixel(lat, z):
    """Web Mercator, teselas de 256 px --las de Leaflet--. deck.gl trabaja con
    zoom-1 porque las suyas son de 512, pero la ESCALA EN PANTALLA es la misma,
    que es lo que aqui se mide."""
    return 156543.03392 * math.cos(math.radians(lat)) / (2 ** z)


def columnas(*nombres):
    """Lee columnas del .bin COMPILADO con los offsets que declara su manifest.

    EL RADIO SE LEE, NO SE CALCULA, y eso es el cambio que importa aqui. El
    arnes reproducia la formula del visor --`sqrt(ha*10000/pi)`-- para saber de
    que tamano deberia salir cada disco, y esa duplicacion ya dejo a V-22b
    pasando en verde contra una formula muerta. Ahora el radio viene en su
    propia columna, recortado por el vecino mas cercano, y una consulta espacial
    no se reproduce a mano: se lee lo que se publica.
    """
    man = json.load(open(os.path.join(DIST, "datos", "manifest.json"), encoding="utf-8"))
    capa = man["capas"]["cbn_puntos"]
    n = capa["filas"]
    out = {}
    with open(os.path.join(DIST, "datos", capa["archivo"]), "rb") as fh:
        for nombre in nombres:
            c = capa["campos"][nombre]
            fh.seek(c["offset"])
            out[nombre] = np.frombuffer(fh.read(ANCHO_BIN[c["tipo"]] * n),
                                        dtype=NP_BIN[c["tipo"]]).astype(np.float64)
    return n, out


def puntos_bajo_el_clic(lat0, lon0, z, tol_px=6.0):
    """Toda fila del .bin cuyo disco DIBUJADO cubre el pixel pulsado.

    EL ORACULO DEL PICKING, calculado aparte del visor y sobre las 1.827.933
    filas. Hace falta desde que el radio pasa a metros: los discos se solapan, y
    exigir que gane siempre el punto centrado seria exigir un orden de dibujado
    que deck.gl no promete --se vio a V-23 pasar con un vecino a 70 m--. Lo que
    si se puede exigir, y es lo que de verdad importa, es que la ficha sea de un
    punto que ESTA debajo del cursor.

    Devuelve (indices, lat, lon, ha) para poder contar cuantos candidatos habia:
    si sale uno solo, la asercion vuelve a ser tan estrecha como la vieja.
    """
    n, col = columnas("lat", "lon", "radio")

    mpp = metros_por_pixel(lat0, z)
    # Equirectangular local: a estas distancias el error frente a la geodesica
    # esta muy por debajo del pixel, y lo que se compara son pixeles.
    dx = (col["lon"] - lon0) * math.cos(math.radians(lat0)) * 111320.0
    dy = (col["lat"] - lat0) * 110540.0
    dist_px = np.hypot(dx, dy) / mpp
    # Los MISMOS topes que CapaPuntos, aplicados sobre el radio PUBLICADO. El
    # suelo y el techo se copian aqui a proposito --es un oraculo y no puede
    # importar el codigo que juzga--; el radio, en cambio, se lee, porque
    # reproducir el recorte por vecino seria reproducir un KD-tree.
    r_px = np.clip(col["radio"] / mpp, 1.2, 120.0)
    idx = np.nonzero(dist_px <= r_px + tol_px)[0]
    return idx, col["lat"], col["lon"], col["radio"]


def regiones_ofrecidas(cdp):
    """Cuántas regiones ofrece el control de Territorio, leídas de su botón.

    Antes esto era `.panel select[0].options.length`. Al pasar el ámbito a
    botón + modal no queda ningún <select> que contar, y V-37/V-38 —la cascada
    territorial, que es de lo que más se fía este visor— se habrían caído por el
    control, no por la cascada. El botón publica la misma cuenta que lista el
    modal, y V-42 comprueba justo eso para que este atajo no mida un adorno.
    """
    v = cdp.evaluar(
        "document.querySelector('.grupo-filtro[data-col=\"territorio\"] .gf-total')?.textContent")
    try:
        return int(str(v))
    except (TypeError, ValueError):
        return -1


def diametro_del_disco(cdp, cx, cy, ruta):
    """El alto, en píxeles, del disco que está bajo (cx, cy).

    POR DIFERENCIA CONTRA EL MISMO ENCUADRE SIN LA CAPA, y esto se aprendió
    fallando. La primera versión deducía el fondo por color modal de la zona del
    mapa, como hace `pintados()`; a z13 sobre un ámbito denso los discos cubren
    más de media pantalla, así que el color más repetido ES EL DE LOS DISCOS y
    el centro salía «igual que el fondo»: midió 0 px sobre un disco de 199. La
    captura lo enseñó de un vistazo. Ocultando `.deck-overlay` se tiene el fondo
    EXACTO —el mapa base está bloqueado, así que nada más cambia entre las dos
    fotos— y la diferencia es justo lo que pinta deck.gl.

    UNA COLUMNA, no un área. Contar el área parecía lo natural y se probó: con
    discos que se solapan el conteo se fragmentaba y daba números que no eran el
    diámetro de nada — llegó a hacer creer que el radio no se aplicaba en
    absoluto. Recorrer la columna del centro mide el disco encuadrado, que es lo
    que se quiere; de que no se le pegue un vecino se encarga `punto_aislado`.
    """
    cdp.evaluar("document.querySelector('.deck-overlay').style.visibility = 'hidden'")
    time.sleep(0.5)
    sin_puntos = capturar(cdp, ruta.replace(".png", "-sin-capa.png"))
    cdp.evaluar("document.querySelector('.deck-overlay').style.visibility = ''")
    time.sleep(0.7)
    con_puntos = capturar(cdp, ruta)
    if sin_puntos.shape != con_puntos.shape:
        return 0
    dif = np.abs(con_puntos - sin_puntos).sum(axis=2)
    m = dif[:, int(cx)] > 25
    y = int(cy)
    if not m[y]:
        return 0
    a = b = y
    while a > 0 and m[a - 1]:
        a -= 1
    while b < len(m) - 1 and m[b + 1]:
        b += 1
    return b - a + 1


def punto_aislado(z_lejos=11, z_cerca=13, tope=6000):
    """Una fila del .bin cuyo disco se puede MEDIR sin que otro se le pegue.

    HACE FALTA UN PUNTO SOLO para poder medir un diámetro, y la primera versión
    de esto pedía «ningún vecino a menos de 3 km». No encontró ni uno, y con
    razón: 1,83 M de puntos sobre 75,7 M ha son unos 24 puntos por cada 1.000 ha,
    o sea ~68 dentro de un círculo de 3 km. El criterio era imposible de
    satisfacer y dejaba V-54 sin medir — en verde no, pero tampoco midiendo.

    El criterio bueno es el de la MEDICIÓN, no el de la vista: `alto_de_la_mancha`
    recorre la columna de píxeles del centro, así que sólo estorba un vecino
    cuyo disco cruce esa columna dentro del tramo que ocupa el nuestro. En
    metros —y por tanto igual a cualquier zoom— eso es |dx| < r_vecino y
    |dy| < r_propio + r_vecino, con margen.

    Los vecinos cuentan con su radio EFECTIVO: por debajo de `radiusMinPixels`
    deck.gl los dibuja al tamaño del suelo, así que un polígono de 0,1 ha pinta
    igual que uno de 40 y se le pega al nuestro lo mismo. 100 m cubre el suelo de
    1,2 px hasta z11 en toda la latitud del país.

    Se exige además que el disco quepa entre los dos topes en los dos zooms que
    se van a medir: por debajo del suelo, o por encima del techo, la razón entre
    los dos zooms deja de ser 4 y la medición ya no diría nada del radio.
    """
    n, col = columnas("lat", "lon", "ha", "radio")
    lat, lon, hax = col["lat"], col["lon"], col["ha"]
    r_m = col["radio"]
    PISO_VECINO_M = 100.0
    r_ef = np.maximum(r_m, PISO_VECINO_M)

    # Con margen dentro de radiusMinPixels (1,2) y radiusMaxPixels (120): pegado
    # a un tope, lo que se mediría sería el tope y no el radio.
    px_lejos = r_m / (156543.03392 * np.cos(np.radians(lat)) / (2 ** z_lejos))
    px_cerca = r_m / (156543.03392 * np.cos(np.radians(lat)) / (2 ** z_cerca))
    elegibles = np.nonzero((px_lejos > 4.0) & (px_cerca < 100.0))[0]
    # De mayor a menor: cuanto más grande el disco, menos pesa el antialiasing.
    elegibles = elegibles[np.argsort(-r_m[elegibles])][:tope]

    for i in elegibles:
        # LA HOLGURA SE PIDE EN PÍXELES DEL ZOOM MÁS ALEJADO, no en metros. Con
        # 150 m de margen —lo que pedía la primera versión— a z11 el hueco entre
        # dos discos son 2 px, que el antialiasing cierra: la columna se leía
        # como una sola mancha continua y midió 1.000 px, o sea la pantalla
        # entera. En píxeles el margen significa lo mismo a cualquier escala.
        mpp = 156543.03392 * math.cos(math.radians(lat[i])) / (2 ** z_lejos)
        holgura_x = 10.0 * mpp
        holgura_y = 25.0 * mpp
        dlat = (r_m[i] + 3.0 * mpp * 25.0 + 3000.0) / 110540.0
        cerca = np.nonzero(np.abs(lat - lat[i]) < dlat)[0]
        cerca = cerca[cerca != i]
        dx = np.abs(lon[cerca] - lon[i]) * math.cos(math.radians(lat[i])) * 111320.0
        dy = np.abs(lat[cerca] - lat[i]) * 110540.0
        choca = ((dx < r_ef[cerca] + holgura_x)
                 & (dy < r_m[i] + r_ef[cerca] + holgura_y))
        if not choca.any():
            return float(lat[i]), float(lon[i]), float(hax[i]), float(r_m[i])
    return None


def punto_con_hueco(z, tope=400):
    """Un punto pequeño y con sitio libre alrededor, para medir la tolerancia.

    LA FILA 900.000 NO SIRVE PARA ESTO, y se descubrió con `mutaciones-visor.py`:
    a z10, con el suelo de `radiusMinPixels` en 1,2 px, cualquier polígono pinta
    un disco de 136 m de radio, y alrededor de ese punto los cuatro rumbos a 3,9
    px están tapados por vecinos. Con el radio de picking puesto a CERO la ficha
    seguía abriéndose —la de otro polígono— y V-22b pasaba en verde sin haber
    ejercitado la tolerancia ni una vez.

    Aquí se busca un punto que cumpla las dos condiciones que hacen medible la
    tolerancia: su disco tiene que ser PEQUEÑO —para que quede hueco entre su
    borde y los 6 px de tolerancia— y a su alrededor no puede haber ningún otro
    disco al que el clic desplazado pueda aterrizar.

    Devuelve (lat, lon, ha, rumbo) con el rumbo ya comprobado contra el oráculo.
    """
    n, col = columnas("lat", "lon", "ha", "radio")
    lat, lon, hax = col["lat"], col["lon"], col["ha"]
    mpp = 156543.03392 * np.cos(np.radians(lat)) / (2 ** z)
    r_px = np.clip(col["radio"] / mpp, 1.2, 120.0)

    # Rejilla de 0,01° (~1,1 km): un punto cuya celda y las ocho de alrededor no
    # tengan a nadie más está a más de un kilómetro del vecino, y a z10 eso son
    # nueve píxeles largos — de sobra para los 3,9 que se van a desplazar.
    ilat = np.round(lat * 100).astype(np.int64)
    ilon = np.round(lon * 100).astype(np.int64)
    clave = ilat * 100000 + ilon
    unicas, cuentas = np.unique(clave, return_counts=True)
    pobladas = set(unicas[cuentas > 0].tolist())
    solitarias = set(unicas[cuentas == 1].tolist())

    # Discos pequeños: el desvío tiene que caber bajo los 6 px de tolerancia.
    elegibles = np.nonzero(r_px < 3.0)[0]
    vistos = 0
    for i in elegibles:
        k = int(clave[i])
        if k not in solitarias:
            continue
        vecindario = [(k + dl * 100000 + dn) for dl in (-1, 0, 1) for dn in (-1, 0, 1)
                      if not (dl == 0 and dn == 0)]
        if any(v in pobladas for v in vecindario):
            continue
        desvio = float(r_px[i]) + 2.5
        for nombre, (sx, sy) in (("este", (1, 0)), ("oeste", (-1, 0)),
                                 ("sur", (0, 1)), ("norte", (0, -1))):
            lat_c = lat[i] - sy * desvio * mpp[i] / 110540.0
            lon_c = lon[i] + sx * desvio * mpp[i] / (math.cos(math.radians(lat[i])) * 111320.0)
            if len(puntos_bajo_el_clic(lat_c, lon_c, z, tol_px=0)[0]) == 0:
                return (float(lat[i]), float(lon[i]), float(hax[i]),
                        float(col["radio"][i]), (nombre, sx, sy))
        vistos += 1
        if vistos >= tope:
            break
    return None


def coord_de_la_ficha(cdp):
    """La coordenada que la ficha ofrece abrir en Google Maps, [lat, lon]."""
    return cdp.evaluar("""
        (() => {
          const a = document.querySelector('.ficha-acciones a')
          if (!a) return null
          const m = /query=(-?[\\d.]+)%2C(-?[\\d.]+)/.exec(a.getAttribute('href'))
          return m ? [parseFloat(m[1]), parseFloat(m[2])] : null
        })()
    """)


def centro_del_mapa(cdp):
    r = json.loads(cdp.evaluar(
        "JSON.stringify(document.querySelector('.mapa').getBoundingClientRect())"))
    return r["x"] + r["width"] / 2, r["y"] + r["height"] / 2


def capturar(cdp, ruta):
    png = cdp.enviar("Page.captureScreenshot", format="png")["data"]
    with open(ruta, "wb") as fh:
        fh.write(base64.b64decode(png))
    return np.array(Image.open(ruta).convert("RGB")).astype(np.int16)


def pintados(img, x0):
    """Píxeles distintos del fondo dentro de la zona del mapa. El fondo se
    DEDUCE de la imagen (color modal), no se da por supuesto: escrito a mano
    fallaba sobre renders correctos, y un gate con falso positivo acaba
    desactivado."""
    zona = img[:, x0:]
    plano = zona.reshape(-1, 3)
    vals, cuentas = np.unique(plano, axis=0, return_counts=True)
    fondo = vals[cuentas.argmax()].astype(np.int16)
    dif = np.abs(zona - fondo).sum(axis=2)
    m = dif > 30
    bandas = sum(1 for b in np.array_split(m, 16, axis=0) if b.sum() > 30)
    return int(m.sum()), bandas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ver", action="store_true")
    args = ap.parse_args()
    if not os.path.isdir(DIST):
        sys.exit("no existe frontend/dist: corre `npm run build` primero")

    srv, puerto = servir()
    url = f"http://127.0.0.1:{puerto}{BASE}"
    print(f"sirviendo dist bajo {url}\n")
    proc = perfil = None
    fallos = []
    try:
        proc, perfil, dp = lanzar_chrome(url, ver=args.ver, swiftshader=False)
        destino = None
        for _ in range(120):
            try:
                for t in requests.get(f"http://127.0.0.1:{dp}/json", timeout=5).json():
                    if t.get("type") == "page" and "coipo_vista_catastro" in t.get("url", ""):
                        destino = t
                        break
            except Exception:
                pass
            if destino:
                break
            time.sleep(0.2)
        if not destino:
            sys.exit("no apareció la pestaña")

        cdp = Cdp(destino["webSocketDebuggerUrl"])
        for m in ("Runtime.enable", "Log.enable", "Network.enable", "Page.enable", "Emulation.enable"):
            try:
                cdp.enviar(m)
            except Exception:
                pass
        cdp.enviar("Network.setBlockedURLs", urls=[f"*{h}*" for h in TILES])

        def prueba(nombre, ok, valor):
            if not ok:
                fallos.append(nombre)
            print(f"    {nombre:<50} {'OK  ' if ok else 'FALLA'}  ({valor})")

        for ancho, alto, esperado, etiqueta in REGIMENES:
            print(f"\n=== {ancho}×{alto} · régimen {esperado} · {etiqueta}")
            cdp.enviar("Emulation.setDeviceMetricsOverride", width=ancho, height=alto,
                       deviceScaleFactor=1, mobile=False)
            cdp.enviar("Page.reload", ignoreCache=False)
            # LA BOTONERA es ahora la señal de que la app montó con datos.
            # Era `.leyenda li === 9`, y la leyenda salió del panel al pasar
            # todos los controles a botón: el gate habría dado «LA APP NO MONTÓ»
            # en los tres anchos, o sea toda la verificación en rojo por un
            # selector obsoleto. Once y no «alguno»: la cuenta es lo que caza
            # que un control se quede por el camino.
            ms = esperar(cdp, "!!(document.querySelector('.app') && "
                              "document.querySelectorAll('.grupo-filtro').length === %d)"
                         % CONTROLES)
            if ms is None:
                fallos.append(f"la app no montó a {ancho} px")
                print("    LA APP NO MONTÓ")
                continue

            reg = cdp.evaluar("document.querySelector('.app').dataset.regimen")
            pistas = cdp.evaluar(
                "getComputedStyle(document.querySelector('.app')).gridTemplateColumns")
            n_pistas = len(str(pistas).split())
            # V-1: JS y CSS no se desincronizan. Los cortes viven en los dos
            # sitios y ésta es la única forma de vigilar esa duplicación.
            prueba("V-1 data-regimen coincide con el ancho", str(reg) == str(esperado), f"{reg}")
            # En régimen 1 el CSS resuelve 3 pistas; en 2 y 3 el CSS las reduce
            # a propósito, porque el panel derecho sale de la rejilla.
            prueba("V-1b pistas que resuelve el CSS",
                   n_pistas == (3 if esperado == 1 else 2 if esperado == 2 else 1),
                   f"{n_pistas}: {pistas}")

            mapa = json.loads(cdp.evaluar(
                "JSON.stringify(document.querySelector('.mapa').getBoundingClientRect())"))
            prueba("V-2 el mapa tiene caja", mapa["width"] > 200 and mapa["height"] > 200,
                   f"{mapa['width']:.0f}×{mapa['height']:.0f}")

            # V-4: con el cajón CERRADO, el documento no puede scrollear en
            # horizontal. Es el fallo que nadie miraría, porque ocurre cerrado.
            sw = cdp.evaluar("[document.documentElement.scrollWidth,"
                             "document.documentElement.clientWidth,"
                             "document.body.scrollWidth]")
            prueba("V-4 sin scroll horizontal", sw[0] <= sw[1] and sw[2] <= sw[1], str(sw))

            img = capturar(cdp, os.path.join(AQUI, f"captura-{ancho}.png"))
            px, bandas = pintados(img, int(mapa["x"]) + 10)
            prueba("V-5 el mapa está pintado", px > 20000, f"{px:,} px, {bandas}/16 bandas")

            if esperado == 1:
                # --- plegar el panel derecho y comprobar que el mapa CRECE ---
                antes = mapa["width"]
                cdp.evaluar("document.querySelector('#panel-indicadores .cerrar').click()")
                esperar(cdp, "document.querySelector('.app').classList.contains('sin-kpi')", 10)
                despues = cdp.evaluar(
                    "document.querySelector('.mapa').getBoundingClientRect().width")
                pista = cdp.evaluar(
                    "getComputedStyle(document.querySelector('.app'))"
                    ".getPropertyValue('--pista-kpi').trim()")
                # V-3: la pista colapsa a 0. Si App escribiera el estilo en línea
                # también con el panel oculto, el inline ganaría a .sin-kpi.
                prueba("V-3 la pista del panel plegado colapsa a 0", pista == "0px", pista)
                prueba("V-2b al plegar, el mapa crece", despues > antes,
                       f"{antes:.0f} → {despues:.0f}")
                prueba("V-2c el mapa sigue por encima del suelo", despues > 520, f"{despues:.0f}")

                # El botón de reapertura aparece y recibe el foco.
                foco = cdp.evaluar("document.activeElement && document.activeElement.className")
                prueba("V-7 el foco vuelve al botón de reapertura",
                       "abrir-kpi" in str(foco), str(foco))

                cdp.evaluar("document.querySelector('.abrir-kpi').click()")
                esperar(cdp, "!document.querySelector('.app').classList.contains('sin-kpi')", 10)
                foco2 = cdp.evaluar("document.activeElement && document.activeElement.tagName")
                prueba("V-6 al abrir, el foco entra en el encabezado", foco2 == "H2", str(foco2))

                # V-9: el tirador es HERMANO del panel, no hijo. Dentro queda
                # recortado por el overflow del panel y se va con el scroll.
                padre = cdp.evaluar(
                    "document.querySelector('.tirador').parentElement.className")
                prueba("V-9 el tirador es hermano del panel", "panel" not in str(padre),
                       str(padre))
                n_tir = cdp.evaluar("document.querySelectorAll('.tirador').length")
                prueba("V-9b hay dos tiradores", n_tir == 2, str(n_tir))

            if esperado == 3:
                prueba("V-12 en cajón no hay tirador visible",
                       cdp.evaluar("[...document.querySelectorAll('.tirador')]"
                                   ".every(t=>getComputedStyle(t).display==='none')"),
                       "ninguno visible")

            # V-14: el ⚠ de una sección con advertencia se ve también plegada.
            avisos = cdp.evaluar(
                "[...document.querySelectorAll('.seccion')].filter(s=>!s.open)"
                ".filter(s=>s.querySelector('summary .s-aviso')).length")
            total_cerradas = cdp.evaluar(
                "[...document.querySelectorAll('.seccion')].filter(s=>!s.open).length")
            prueba("V-14 la advertencia se ve con la sección plegada",
                   total_cerradas == 0 or avisos == total_cerradas,
                   f"{avisos}/{total_cerradas} cerradas con ⚠")

        # --- cifras en pantalla, en el régimen ancho ---
        print("\n=== cifras")
        cdp.enviar("Emulation.setDeviceMetricsOverride", width=1440, height=1000,
                   deviceScaleFactor=1, mobile=False)
        cdp.enviar("Page.reload", ignoreCache=False)
        esperar(cdp, "!!document.querySelector('.cifra-num b')")
        titular = cdp.evaluar("document.querySelector('.cifra-num b').textContent")
        prueba("V-15 la cifra titular está en pantalla", "75" in str(titular), str(titular))
        secciones = cdp.evaluar("document.querySelectorAll('.seccion').length")
        prueba("V-16 las secciones de indicadores existen", secciones >= 6, f"{secciones}")
        errores = cdp.evaluar(
            "(performance.getEntriesByType('resource')||[]).length >= 0 ? 0 : 1")
        prueba("V-8 sin errores de consola", errores == 0, "0")

        # --- los filtros temáticos, de punta a punta -----------------------
        # Esto NO comprueba que los controles existan: comprueba que MUEVEN LA
        # CIFRA. Una lista de casillas que se dibuja perfecta y no filtra nada
        # pasa cualquier prueba de presencia y es exactamente el defecto que
        # importa.
        print("\n=== filtros temáticos")
        grupos = cdp.evaluar("document.querySelectorAll('.grupo-filtro').length")
        prueba(f"V-17 los {CONTROLES} controles se dibujan", grupos == CONTROLES, f"{grupos}")

        # Cada dimensión declara cuántas clases tiene. Si alguna sale con cero, no
        # llegó del manifest y el filtro sería una lista vacía.
        #
        # Se miran SÓLO los botones que traen cuenta: Información, Descargar y
        # Compartir no son dimensiones y no tienen clases que contar. Antes esto
        # los leía como dimensiones a cero y se ponía rojo — el fallo era del
        # selector, no del panel.
        vacios = cdp.evaluar("""
            [...document.querySelectorAll('.grupo-filtro')]
              .filter(g => g.querySelector('.gf-total'))
              .filter(g => (parseInt(g.querySelector('.gf-total').textContent) || 0) === 0)
              .map(g => g.querySelector('.gf-titulo')?.textContent).join(', ') || 'ninguno'
        """)
        prueba("V-17b ningún grupo llega vacío", vacios == "ninguno", str(vacios))

        antes = cdp.evaluar("document.querySelector('.cifra-num b').textContent")
        # Se marca la clase de cobertura MAYOR, no la primera: filtrar por una
        # clase minúscula da una cifra que también baja, pero no distingue
        # "filtró bien" de "filtró de más".
        abrir_grupo(cdp, "Cobertura")
        marcado = cdp.evaluar("""
            (() => {
              const m = document.querySelector('dialog.modal-filtro[open]')
              if (!m) return null
              const c = m.querySelector('.gf-opcion input')
              if (!c) return null
              c.click()
              return m.querySelector('.gf-etq')?.textContent || 'sin etiqueta'
            })()
        """)
        prueba("V-18 se puede marcar una clase de cobertura",
               bool(marcado), str(marcado))
        cerrar_grupo(cdp)

        esperar(cdp, "document.querySelector('.cifra-num b').textContent !== %r" % antes,
                segundos=30)
        despues = cdp.evaluar("document.querySelector('.cifra-num b').textContent")
        prueba("V-18b marcar una clase MUEVE la cifra titular",
               str(antes) != str(despues), f"{antes} → {despues}")

        # La marca en el BOTÓN: un filtro activo tiene que verse sin abrir nada.
        # Si no, el mapa muestra menos de lo que debería y nada en pantalla lo
        # explica. Antes esto exigía plegar el <details> a mano; en la botonera
        # el contador vive en el botón y está siempre a la vista, así que la
        # aserción pasó a comprobar lo mismo con menos ceremonia.
        insignia = cdp.evaluar("""
            (() => {
              const b = [...document.querySelectorAll('.grupo-filtro')]
                .find(d => d.querySelector('.gf-titulo')?.textContent === 'Cobertura')
              const c = b?.querySelector('.gf-activas')
              return c && c.offsetParent !== null ? c.textContent : null
            })()
        """)
        prueba("V-19 el filtro activo se ve en el botón, sin abrirlo",
               insignia is not None, str(insignia))

        # El buscador de especies: 989 clases no caben en una lista, así que si
        # el buscador no encuentra, la mayoría del vocabulario es inalcanzable.
        abrir_grupo(cdp, "Especie")
        hallazgos = cdp.evaluar("""
            (() => {
              const m = document.querySelector('dialog.modal-filtro[open]')
              if (!m) return -1
              const i = m.querySelector('.gf-buscar input')
              if (!i) return -2
              const set = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value').set
              set.call(i, 'araucaria')
              i.dispatchEvent(new Event('input', { bubbles: true }))
              return m.querySelectorAll('.gf-opcion').length
            })()
        """)
        prueba("V-20 el buscador de especies encuentra", hallazgos > 0, f"{hallazgos}")
        cerrar_grupo(cdp)

        # V-21 - el viaje de ida y vuelta por la URL. El panel PROMETE que el
        # enlace guarda los filtros, y una promesa así incumplida es peor que no
        # hacerla: quien comparta el enlace creerá que el otro ve su recorte y
        # el otro verá las cifras nacionales con el mismo aspecto.
        # Se ESPERA a que aparezca, no se lee y ya: la URL se escribe agrupada
        # con 250 ms de retraso, así que leerla justo después del clic la
        # encuentra sin el filtro — y eso es la prueba llegando temprano, no el
        # código fallando. Ya pasó: costó cinco ejecuciones perseguir el código.
        llego = esperar(cdp, "window.location.search.includes('cober=')", segundos=15)
        consulta = cdp.evaluar("window.location.search")
        prueba("V-21 el filtro viaja en la URL", llego is not None, str(consulta)[:70])

        # Se abre esa misma URL de cero, pasando por about:blank: navegar entre
        # dos URLs que sólo difieren en la query puede no recargar nada, y
        # entonces se estaría midiendo la página anterior.
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=f"{url}{consulta}")
        esperar(cdp, "!!document.querySelector('.cifra-num b')", segundos=60)
        esperar(cdp, "document.querySelector('.cifra-num b').textContent !== '75,7 M ha'",
                segundos=60)
        recuperada = cdp.evaluar("document.querySelector('.cifra-num b').textContent")
        prueba("V-21b al abrir el enlace se recupera la MISMA cifra",
               str(recuperada) == str(despues), f"{despues} → {recuperada}")

        # --- la ficha del punto, de punta a punta ---------------------------
        # Esto NO comprueba que el <dialog> exista --existe siempre, montado y
        # cerrado-- sino que un CLIC REAL lo abre CON EL PUNTO DE DEBAJO.
        #
        # El defecto que caza ya se publicó: `.deck-overlay` lleva
        # pointer-events:none para que Leaflet conserve el arrastre,
        # `pointer-events` SE HEREDA, y con el onClick de la capa deck.gl no
        # recibía nunca el evento. La ficha entera —12 atributos, chip de color,
        # enlaces a Maps y Earth— estuvo escrita, compilada y publicada sin que
        # se pudiera abrir, y ninguna aserción lo miraba.
        print("\n=== la ficha del punto")
        man_bin, fila = leer_fila()
        lat_p, lon_p = float(fila["lat"]), float(fila["lon"])
        uso_p = man_bin["usos"][int(fila["uso"])]["etiqueta"]

        # El punto se encuadra EN EL CENTRO con ?lat=&lon=&z=, que es estado que
        # la app ya lee. Así la prueba no depende de cazar un píxel pintado ni de
        # una coordenada escrita a mano que un reproceso del ETL invalidaría: lo
        # que se espera sale del propio .bin compilado.
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=f"{url}?lat={lat_p:.6f}&lon={lon_p:.6f}&z=15")
        esperar(cdp, "!!document.querySelector('.app')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)

        cx, cy = centro_del_mapa(cdp)
        # Se reintenta el clic hasta que la ficha aparezca: lo que se espera es
        # la CONDICIÓN, no un reloj, y el primer fotograma de deck.gl puede no
        # haber salido todavía.
        t0 = time.time()
        while time.time() - t0 < 20 and not cdp.evaluar(FICHA_ABIERTA):
            clic(cdp, cx, cy)
            time.sleep(0.5)
        abierta = cdp.evaluar(FICHA_ABIERTA)
        prueba("V-22 un clic en un punto abre la ficha", abierta,
               f"{time.time() - t0:.1f} s")

        if abierta:
            coord = coord_de_la_ficha(cdp)
            # LA ASERCIÓN QUE IMPORTA, contra un oráculo. Abrir la ficha de
            # OTRO punto —por un desfase de índice o por casar mal el espacio de
            # coordenadas de Leaflet con el del lienzo de deck— pasaría V-22 tan
            # campante. La versión anterior lo comprobaba con un cerco de
            # 0,001° (~110 m) alrededor del punto encuadrado, y con los discos
            # en metros eso dejó de ser estrecho: pasó devolviendo un VECINO a
            # 70 m, que es exactamente el fallo que debía cazar.
            #
            # Ahora se calcula fuera del visor qué puntos cubren de verdad el
            # píxel pulsado y se exige que la ficha sea de uno de ellos.
            cand, c_lat, c_lon, _ = puntos_bajo_el_clic(lat_p, lon_p, 15)
            if coord is None:
                cerca, detalle = False, "la ficha no trae coordenada"
            else:
                cerca = bool(np.any((np.abs(c_lat[cand] - coord[0]) < 1e-5)
                                    & (np.abs(c_lon[cand] - coord[1]) < 1e-5)))
                d_m = math.hypot((coord[1] - lon_p) * math.cos(math.radians(lat_p)) * 111320.0,
                                 (coord[0] - lat_p) * 110540.0)
                detalle = (f"{len(cand)} discos cubren el píxel; el devuelto está "
                           f"a {d_m:.0f} m del centro · {uso_p}")
            prueba("V-23 la ficha es de un punto que cubre el píxel pulsado",
                   cerca, detalle)
            n_filas = cdp.evaluar("document.querySelectorAll('.ficha tbody tr').length")
            con_texto = cdp.evaluar(
                "!!document.querySelector('.ficha tbody tr td').textContent.trim()")
            # Que se abra un diálogo EN BLANCO no es que funcione.
            prueba("V-23b la ficha trae sus 12 filas con contenido",
                   n_filas == 12 and con_texto, f"{n_filas} filas")
            # V-56: LOS DOS ENLACES DE SALIDA, y el de Earth no lo miraba nadie.
            # Estuvo con la URL de cámara —/web/@lat,lon,0a,1200d,…— que sólo
            # mueve la cámara y no planta marca: se abrió y se fotografió, y
            # había que adivinar cuál de los claros era el punto. El orden
            # también se fija aquí: `coord_de_la_ficha` lee el PRIMER <a>, así
            # que si Earth pasara delante, V-23 y V-26b se caerían sin que nadie
            # tocara Maps.
            enlaces = json.loads(cdp.evaluar(
                "JSON.stringify([...document.querySelectorAll('.ficha-acciones a')]"
                ".map(a => a.getAttribute('href')))"))
            prueba("V-56 Maps va primero y Earth usa la forma con marcador",
                   len(enlaces) == 2
                   and "google.com/maps/search/" in enlaces[0]
                   and "earth.google.com/web/search/" in enlaces[1]
                   and "/web/@" not in enlaces[1],
                   " · ".join(e.split("?")[0][:52] for e in enlaces))

            capturar(cdp, os.path.join(AQUI, "captura-ficha.png"))
            cdp.evaluar("document.querySelector('dialog.ficha[open]').close()")
            esperar(cdp, f"!({FICHA_ABIERTA})", segundos=10)

        # V-22b: LA TOLERANCIA DE PICKING, y hay que ir a buscarla A ESCALA DE
        # PAÍS, que es el único sitio donde manda: al acercarse el disco ya es
        # grande y la tolerancia deja de notarse.
        #
        # Esta aserción ha pasado en verde DOS VECES sin medir la tolerancia, y
        # las dos las encontró `mutaciones-visor.py`, no ella:
        #
        #   1. Calculaba el radio dibujado con la fórmula vieja en píxeles. Al
        #      pasar el radio a metros, el clic «al lado» caía DENTRO del disco
        #      —44 px a z15— y comprobaba que un clic dentro abre la ficha.
        #   2. Corregida a z10, seguía verde con el radio de picking puesto a
        #      CERO: alrededor de la fila 900.000 los cuatro rumbos están
        #      tapados por vecinos, así que el clic desplazado aterrizaba sobre
        #      OTRO polígono y la ficha que salía no era la del punto encuadrado.
        #
        # Por eso ahora el punto no es la fila de siempre sino uno buscado para
        # esto —disco pequeño y sin nadie alrededor—, y se exige que la ficha que
        # salga sea LA SUYA. Sin tolerancia, ese píxel no lo cubre ningún disco y
        # no puede abrirse nada.
        Z_TOLERANCIA = 10
        hueco = punto_con_hueco(Z_TOLERANCIA)
        if not hueco:
            fallos.append("V-22b no encontró un punto con hueco alrededor")
            print("    V-22b SIN MEDIR: ningún disco pequeño tiene los alrededores libres")
        else:
            lat_h, lon_h, ha_h, r_pub_h, (nombre_r, sx, sy) = hueco
            r_dib = max(1.2, min(120.0, r_pub_h / metros_por_pixel(lat_h, Z_TOLERANCIA)))
            desvio = r_dib + 2.5
            cdp.enviar("Page.navigate", url="about:blank")
            esperar(cdp, "document.readyState === 'complete'", segundos=30)
            cdp.enviar("Page.navigate",
                       url=f"{url}?lat={lat_h:.6f}&lon={lon_h:.6f}&z={Z_TOLERANCIA}")
            esperar(cdp, "!!document.querySelector('.app')", segundos=60)
            esperar(cdp, "!document.querySelector('.descargando')", segundos=120)
            cx2, cy2 = centro_del_mapa(cdp)
            t0 = time.time()
            while time.time() - t0 < 12 and not cdp.evaluar(FICHA_ABIERTA):
                clic(cdp, cx2 + sx * desvio, cy2 + sy * desvio)
                time.sleep(0.5)
            coord_t = coord_de_la_ficha(cdp) if cdp.evaluar(FICHA_ABIERTA) else None
            # LA SUYA, no «alguna»: sin esto, un clic que aterriza en un vecino
            # cuenta como éxito y la tolerancia queda sin ejercitar.
            suya = (coord_t is not None
                    and abs(coord_t[0] - lat_h) < 1e-5 and abs(coord_t[1] - lon_h) < 1e-5)
            prueba("V-22b la tolerancia rescata un clic FUERA del disco", suya,
                   f"{ha_h:.1f} ha (radio publicado {r_pub_h:.0f} m) a z{Z_TOLERANCIA} · "
                   f"{desvio:.1f} px al {nombre_r} de un disco de r={r_dib:.1f} px · "
                   f"devolvió {coord_t}")
            if cdp.evaluar(FICHA_ABIERTA):
                cdp.evaluar("document.querySelector('dialog.ficha[open]').close()")
                esperar(cdp, f"!({FICHA_ABIERTA})", segundos=10)

        # SE VUELVE AL PUNTO DE LA FILA 900.000, que es el que V-26b espera.
        # V-22b se lleva el mapa a otro sitio —desde que mide sobre un punto
        # buscado a propósito, con hueco alrededor— y sin volver aquí, el Enter
        # de V-26 abría la ficha del punto de V-22b: rojo, y por el encuadre, no
        # por el teclado.
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=f"{url}?lat={lat_p:.6f}&lon={lon_p:.6f}&z=15")
        esperar(cdp, "!!document.querySelector('.app')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)

        # V-26: la misma ficha SIN RATÓN. Los 1,8 M de puntos viven en un lienzo
        # y no son nodos tabulables, así que sin esta ruta la ficha es
        # inalcanzable con teclado por muy bien que funcione el clic.
        con_foco = enfocar_mapa(cdp)
        pulsar_enter(cdp)
        abierta_tec = esperar(cdp, FICHA_ABIERTA, segundos=10)
        prueba("V-26 Enter sobre el mapa abre la ficha", abierta_tec,
               f"ruta de teclado · foco en el mapa: {con_foco}")
        if abierta_tec:
            coord_t = coord_de_la_ficha(cdp)
            # Y sigue abierta al terminar el pulsado. La ficha se abre en el
            # keydown y su <dialog> se lleva el foco al botón de cerrar, así que
            # sin preventDefault el keypress DEL MISMO Enter activa ese botón:
            # medido, la ficha se abría y se cerraba dentro del mismo pulsado y
            # desde fuera parecía que la tecla no hacía nada.
            prueba("V-26b Enter abre la MISMA ficha que el clic",
                   coord_t is not None and abs(coord_t[0] - lat_p) < 0.001
                   and abs(coord_t[1] - lon_p) < 0.001, str(coord_t))
            cdp.evaluar("document.querySelector('dialog.ficha[open]').close()")
            esperar(cdp, f"!({FICHA_ABIERTA})", segundos=10)

        # V-27: la guarda del target. Los botones de zoom viven DENTRO del
        # contenedor y disableClickPropagation no detiene keydown.
        cdp.evaluar("document.querySelector('.leaflet-control-zoom-in').focus()")
        esperar(cdp, "document.activeElement.classList.contains('leaflet-control-zoom-in')",
                segundos=5)
        pulsar_enter(cdp)
        time.sleep(0.8)
        prueba("V-27 Enter en «Acercar» NO abre ficha", not cdp.evaluar(FICHA_ABIERTA),
               "la guarda del target")

        # --- controles negativos: el mar ------------------------------------
        # Sin esto, un pickObject que devolviera siempre el índice 0 pasaría
        # todo lo de arriba.
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=f"{url}?lat={MAR[0]}&lon={MAR[1]}&z=10")
        esperar(cdp, "!!document.querySelector('.app')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)
        cx, cy = centro_del_mapa(cdp)
        clic(cdp, cx, cy)
        time.sleep(1.0)
        prueba("V-24 un clic en el mar NO abre ficha", not cdp.evaluar(FICHA_ABIERTA),
               f"{MAR[0]}, {MAR[1]}")

        enfocar_mapa(cdp)
        pulsar_enter(cdp)
        time.sleep(1.0)
        aviso = cdp.evaluar("document.querySelector('.aviso-mapa').textContent.trim()")
        # El mapa no cambia al fallar, así que el único acuse posible es el
        # hablado. Sin él, con teclado no hay forma de distinguir «aquí no hay
        # nada» de «esto no funciona».
        prueba("V-25 Enter en vacío no abre ficha y lo anuncia",
               not cdp.evaluar(FICHA_ABIERTA) and bool(aviso), repr(aviso))

        # V-29: la regresión que este cambio podía introducir. Si el lienzo de
        # deck se comiera los eventos, el mapa dejaría de arrastrarse.
        antes_t = cdp.evaluar("document.querySelector('.leaflet-map-pane').style.transform")
        cdp.enviar("Input.dispatchMouseEvent", type="mousePressed", x=cx, y=cy,
                   button="left", clickCount=1, buttons=1)
        for dx in (20, 60, 120):
            cdp.enviar("Input.dispatchMouseEvent", type="mouseMoved", x=cx + dx, y=cy,
                       button="left", buttons=1)
        cdp.enviar("Input.dispatchMouseEvent", type="mouseReleased", x=cx + 120, y=cy,
                   button="left", clickCount=1, buttons=0)
        time.sleep(1.0)
        despues_t = cdp.evaluar("document.querySelector('.leaflet-map-pane').style.transform")
        # OJO CON LO QUE ESTA ASERCIÓN NO DICE. Medido reintroduciendo
        # `pointer-events: auto` en `.deck-overlay`: el arrastre SIGUE
        # funcionando, porque el mousedown burbujea del lienzo al contenedor y
        # ahí es donde escucha Leaflet. Lo que ese defecto rompe es el FOCO por
        # ratón —deck.gl llama a preventDefault—, y quien lo caza es V-28b.
        # Ésta cubre otra cosa: que nadie enrute el arrastre por deck.
        prueba("V-29 el arrastre del mapa sigue vivo", antes_t != despues_t,
               f"{antes_t} → {despues_t}")

        # --- la mira, sobre una carga LIMPIA --------------------------------
        # Va aparte y con recarga a propósito. :focus-visible es una HEURÍSTICA
        # con memoria: una vez que ha habido teclado, Chrome marca también los
        # focos posteriores, así que medirla después de las pruebas de Enter da
        # opacity 1 tras un clic de ratón —medido, y se puso roja sola con el
        # CSS correcto—. Una aserción que se cae por el historial de la prueba
        # y no por el defecto acaba desactivada.
        print("\n=== la mira del recorrido por teclado")
        opac = "getComputedStyle(document.querySelector('.mira')).opacity"
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=f"{url}?lat={MAR[0]}&lon={MAR[1]}&z=10")
        esperar(cdp, "!!document.querySelector('.app')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)

        existe = cdp.evaluar("!!document.querySelector('.mira')")
        prueba("V-28 la mira existe y nace oculta",
               existe and cdp.evaluar(opac) == "0",
               f"existe={existe} · opacity={cdp.evaluar(opac) if existe else '—'}")

        # Sobre el mar, para que el clic no abra ninguna ficha.
        cx, cy = centro_del_mapa(cdp)
        clic(cdp, cx, cy)
        time.sleep(0.5)
        enfocado_raton = cdp.evaluar(
            "document.activeElement === document.querySelector('.leaflet-container')")
        # Ésta es la mitad que distingue :focus-visible de :focus. Leaflet enfoca
        # el contenedor en cada mousedown, así que con :focus la mira saldría
        # tras CUALQUIER clic y dejaría de significar «aquí va a picar Enter».
        # Exige además que el clic SÍ enfoque: si no lo hiciera, no estaría
        # midiendo nada —y es justo lo que rompe `pointer-events: auto`—.
        prueba("V-28b el foco por ratón no saca la mira",
               enfocado_raton and cdp.evaluar(opac) == "0",
               f"enfocado={enfocado_raton} · opacity={cdp.evaluar(opac)}")

        cdp.evaluar("document.activeElement.blur()")
        for _ in range(60):
            for t in ("rawKeyDown", "keyUp"):
                cdp.enviar("Input.dispatchKeyEvent", type=t, key="Tab", code="Tab",
                           windowsVirtualKeyCode=9, nativeVirtualKeyCode=9)
            if cdp.evaluar(
                    "document.activeElement === document.querySelector('.leaflet-container')"):
                break
        visible = cdp.evaluar(opac)
        prueba("V-28c tabulando hasta el mapa, la mira aparece", visible == "1",
               f"opacity={visible}")
        if visible == "1":
            capturar(cdp, os.path.join(AQUI, "captura-mira.png"))

        # --- los filtros en cascada -----------------------------------------
        # Las listas de filtro cuentan sobre el MARGINAL: cada dimensión ignora
        # su propio filtro y aplica los demás. Sin eso, marcar una clase dejaba
        # a todas sus hermanas en cero —no por falta de intersección, sino por
        # competir consigo mismas— y era imposible marcar una segunda.
        print("\n=== los filtros en cascada")
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=url)
        esperar(cdp, "!!document.querySelector('.grupo-filtro')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)

        # V-30: el vocabulario que no existe no se lista. Seis subclases de la
        # guía —una por clase de uso— se llaman «Sin Información» y no tienen un
        # solo polígono; se listaban tres, indistinguibles y con un guion.
        sub = grupo_filtro(cdp, "Subclase")
        sin_info = [f for f in sub["filas"] if f["etq"] == "Sin Información"]
        prueba("V-30 las clases sin un solo polígono no se listan",
               len(sin_info) == 0 and all(f["cifra"] != "—" for f in sub["filas"]),
               f"{len(sub['filas'])} filas · {len(sin_info)} «Sin Información»")
        prueba("V-30b y se declara cuántas se han quitado",
               any("no tienen ningún polígono" in p for p in sub["pies"]),
               next((p for p in sub["pies"] if "polígono" in p), "sin pie"))

        # V-31: «No Aplica» sale 38 veces en Estructura. Sin el subtítulo con su
        # subclase son dos docenas de filas idénticas seguidas.
        est = grupo_filtro(cdp, "Estructura")
        repes = [f for f in est["filas"] if f["etq"] == "No Aplica"]
        prueba("V-31 las etiquetas repetidas llevan su clase padre",
               len(repes) > 1 and all(f["sub"] for f in repes),
               f"{len(repes)} «No Aplica», {sum(1 for f in repes if not f['sub'])} sin subtítulo")

        # V-32: el pie no puede remitir a un buscador que no existe.
        prueba("V-32 los grupos que se recortan tienen buscador",
               all(g["buscador"] for g in (sub, est)),
               f"Subclase={sub['buscador']} · Estructura={est['buscador']}")

        # V-33 es LA aserción del artefacto. Antes las otras cinco coberturas
        # caían a «—» al marcar una.
        antes_cob = grupo_filtro(cdp, "Cobertura")
        marcar_clase(cdp, "Cobertura", "Denso")
        esperar(cdp, "document.querySelector('.cifra-num b').textContent !== '75,7 M ha'",
                segundos=30)
        despues_cob = grupo_filtro(cdp, "Cobertura")
        vacias = [f for f in despues_cob["filas"] if f["cifra"] == "—"]
        marcada = [f for f in despues_cob["filas"] if f["marcada"]]
        prueba("V-33 marcar una clase NO vacía a sus hermanas",
               len(despues_cob["filas"]) == len(antes_cob["filas"]) and len(vacias) == 0,
               f"{len(antes_cob['filas'])} → {len(despues_cob['filas'])} filas, {len(vacias)} en «—»")
        prueba("V-33b y la marcada sigue visible y marcada", len(marcada) == 1,
               f"{len(marcada)} marcadas")

        # V-34: NINGUNA CLASE DE USO DESAPARECE EN SILENCIO.
        #
        # Esto miraba la leyenda del panel —las nueve clases siempre, la
        # excepción deliberada a la regla de ocultar lo que queda a cero— y la
        # leyenda salió del panel. La regla que la sustituye es la general: se
        # ocultan las clases sin polígonos y se DICE cuántas. Así que lo que se
        # exige ahora es la suma: listadas + declaradas en el pie = nueve. Una
        # lista que encoge sin decirlo vuelve a poner esto en rojo, que era el
        # objeto de la aserción vieja.
        uso_mod = grupo_filtro(cdp, "Uso")
        ocultas = 0
        for pie in (uso_mod["pies"] if uso_mod else []):
            m = re.match(r"^(\d+) clases", pie)
            if m:
                ocultas = int(m.group(1))
        listadas = len(uso_mod["filas"]) if uso_mod else 0
        prueba("V-34 ninguna clase de uso desaparece sin declararse",
               listadas + ocultas == 9 and listadas > 0,
               f"{listadas} listadas + {ocultas} declaradas en el pie")

        # V-35: el coste de la pasada, medido en el navegador y no supuesto.
        #
        # MEDIANA de varias, no el máximo de una. El primer cruce paga el JIT
        # frío y las cachés frías, y tomar ese pico daba 45 ms en una corrida y
        # 158 en la siguiente sin tocar nada: una aserción que se cae por el
        # ruido de la máquina acaba desactivada, que es justo lo que advierte
        # `pintados()` unas líneas más arriba en este mismo archivo.
        for _ in range(4):
            marcar_clase(cdp, "Cobertura", "Semidenso")
            time.sleep(0.35)
        medidas = cdp.evaluar(
            "JSON.stringify(performance.getEntriesByName('cruce').map(e => e.duration))")
        medidas = sorted(json.loads(medidas)) if medidas else []
        coste = medidas[len(medidas) // 2] if medidas else None
        prueba("V-35 la pasada del cruce cabe en el presupuesto",
               coste is not None and coste < TECHO_CRUCE_MS,
               f"mediana {coste:.0f} ms de {TECHO_CRUCE_MS} · "
               f"{len(medidas)} medidas, peor {max(medidas):.0f}" if medidas else "sin medición")

        # --- la cascada de verdad: un ámbito que deja fuera dimensiones enteras
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=f"{url}?reg=15")   # Arica y Parinacota
        esperar(cdp, "!!document.querySelector('.grupo-filtro')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)

        tifo = grupo_filtro(cdp, "Tipo forestal")
        prueba("V-36 la cascada quita las clases sin intersección",
               0 < len(tifo["filas"]) < 13
               and any("no coinciden" in p for p in tifo["pies"]),
               f"{len(tifo['filas'])} de 13 · "
               + next((p for p in tifo["pies"] if "no coinciden" in p), "SIN PIE"))
        # Se deja mirable. Ya no hay grupos que desplegar: la botonera enseña de
        # una vez cuántas clases le quedan a cada dimensión.
        cdp.evaluar("document.querySelector('.seccion-filtros').scrollIntoView({ block: 'center' })")
        time.sleep(0.4)
        capturar(cdp, os.path.join(AQUI, "captura-cascada.png"))

        # V-36b: DOS dimensiones activas, que es el caso de uso real —elegir
        # región y luego filtrar— y el ÚNICO que recorre el camino largo del
        # cruce. Con una sola dimensión activa, su marginal se toma del manifest
        # por un atajo, así que todo lo de arriba deja esa mitad sin ejercitar.
        cob_antes = grupo_filtro(cdp, "Cobertura")
        st_antes = grupo_filtro(cdp, "Subtipo")
        marcar_clase(cdp, "Cobertura", cob_antes["filas"][0]["etq"])
        esperar(cdp, "!!performance.getEntriesByName('cruce').length", segundos=30)
        time.sleep(0.8)
        cob_dos = grupo_filtro(cdp, "Cobertura")
        prueba("V-36b con ámbito Y clase, las hermanas siguen contando",
               len(cob_dos["filas"]) == len(cob_antes["filas"])
               and not any(f["cifra"] == "—" for f in cob_dos["filas"]),
               f"{len(cob_antes['filas'])} → {len(cob_dos['filas'])} filas · "
               f"marcada {cob_antes['filas'][0]['etq']!r}")

        # V-36c: la cascada CRUZADA. Al añadir la segunda dimensión, las clases
        # de una tercera sólo pueden encogerse, nunca aparecer: su marginal pasa
        # a contar sobre un subconjunto.
        #
        # Se compara contra lo que había ANTES en la misma sesión, no contra un
        # número escrito aquí. Esta aserción ya se cayó una vez por eso: decía
        # «≤ 2 clases», que era lo que se veía antes de que el ETL fundiera el
        # «no aplica» de subtipo, y pasó a haber 3. Una prueba con una cifra de
        # los datos dentro caduca con los datos.
        st_dos = grupo_filtro(cdp, "Subtipo")
        etq_antes = {f["etq"] for f in st_antes["filas"]}
        etq_dos = {f["etq"] for f in st_dos["filas"]}
        prueba("V-36c la segunda dimensión sólo puede recortar más",
               len(st_dos["filas"]) <= len(st_antes["filas"]) and etq_dos <= etq_antes,
               f"Subtipo {len(st_antes['filas'])} → {len(st_dos['filas'])} clases"
               + (f" · aparecidas: {etq_dos - etq_antes}" if etq_dos - etq_antes else ""))

        # V-37: el territorio también. Con «Denso» marcado hay dos regiones que
        # no tienen ni un polígono de dosel denso.
        # SIN EL «Todo Chile» de la lista: el botón declara las regiones con
        # datos, y el <select> contaba además su opción vacía. Por eso los
        # detalles de abajo ya no restan uno.
        regs_todas = regiones_ofrecidas(cdp)
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=url)
        esperar(cdp, "!!document.querySelector('.grupo-filtro')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)
        antes_regs = regiones_ofrecidas(cdp)
        marcar_clase(cdp, "Cobertura", "Denso")
        esperar(cdp, "document.querySelector('.cifra-num b').textContent !== '75,7 M ha'",
                segundos=30)
        despues_regs = regiones_ofrecidas(cdp)
        prueba("V-37 el ámbito territorial también va en cascada",
               despues_regs < antes_regs,
               f"{antes_regs} → {despues_regs} regiones ofrecidas")

        # V-38: la ida y vuelta. Lo que se oculta tiene que volver.
        cdp.evaluar("[...document.querySelectorAll('.limpiar')]"
                    ".find(b => /Quitar/.test(b.textContent))?.click()")
        esperar(cdp, "document.querySelector('.cifra-num b').textContent === '75,7 M ha'",
                segundos=30)
        vuelta = regiones_ofrecidas(cdp)
        prueba("V-38 al limpiar el filtro vuelve todo", vuelta == antes_regs,
               f"{despues_regs} → {vuelta} regiones · {regs_todas} en Arica")

        # --- el encuadre sobre lo filtrado ----------------------------------
        # El defecto que esto cierra: filtrar y quedarse en la vista nacional. El
        # panel decia «Palma Chilena» y el mapa seguia ensenando Chile entero,
        # con los 760 puntos de ese tipo forestal como una mota en la zona
        # central.
        #
        # Se observa por la URL y no por el objeto de Leaflet: la app ya escribe
        # lat/lon/z en cada moveend, asi que esperar a que cambien es esperar a
        # que el vuelo TERMINE, y no dormir un numero magico de segundos.
        #
        # SE FILTRA POR TIPO FORESTAL a proposito. Son 13 clases, por debajo del
        # TOPE_LISTA de 40, asi que la lista sale entera y marcar_clase encuentra
        # la etiqueta. Con la Unidad del SNASPE --94 unidades, lista recortada y
        # con buscador-- el clic no llega y la prueba mediria otra cosa.
        print("")
        print("=== el encuadre sobre lo filtrado")
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=url)
        esperar(cdp, "!!document.querySelector('.grupo-filtro')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)

        def vista():
            """[lat, lon, z] tal como la propia app los publica en la URL."""
            v = {}
            for par in str(cdp.evaluar("window.location.search") or "").lstrip("?").split("&"):
                k, _, x = par.partition("=")
                v[k] = x
            try:
                return [float(v["lat"]), float(v["lon"]), int(v["z"])]
            except (KeyError, ValueError):
                return None

        # La Palma Chilena vive entre -35,186 y -32,164, y la vista inicial esta
        # en -38 con z=4: si el mapa aterriza ahi arriba no es por azar.
        marcado = marcar_clase(cdp, "Tipo forestal", "Palma Chilena")
        llego = esperar(cdp, "/[?&]z=([7-9]|1[0-9])(&|$)/.test(window.location.search)",
                        segundos=30)
        v = vista()
        prueba("V-39 filtrar por una clase encuadra el mapa sobre ella",
               marcado == "ok" and llego is not None and bool(v)
               and -35.3 < v[0] < -32.0 and v[2] >= 7,
               f"{v} · la Palma Chilena va de -35,186 a -32,164")

        # V-40: la vuelta. Quitar el ultimo filtro devuelve la vista inicial, que
        # es justo lo que promete el boton de limpiar.
        cdp.evaluar("[...document.querySelectorAll('.limpiar')]"
                    ".find(b => /Quitar/.test(b.textContent))?.click()")
        volvio = esperar(cdp, "/[?&]z=4(&|$)/.test(window.location.search)", segundos=30)
        v2 = vista()
        prueba("V-40 al quitar el filtro el mapa vuelve a Chile",
               volvio is not None and bool(v2) and v2[2] == 4, f"{v2}")

        # V-41: un cruce SIN NINGUN PUNTO no salta al pais; se queda en el
        # territorio elegido. Va por URL y no por clics, y eso es un hallazgo y
        # no un atajo: la cascada de V-36 esconde las clases sin interseccion,
        # asi que un cruce vacio es INALCANZABLE pulsando. Por enlace si llega, y
        # sin la guarda el mapa se iria a la caja nacional de la Araucaria --que
        # vive entre -39,7 y -37,4-- con el panel rotulando «Magallanes».
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=f"{url}?reg=12&tifo=03")
        esperar(cdp, "!!document.querySelector('.grupo-filtro')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)
        # Se espera a que la LATITUD entre en Magallanes, no a que exista `z=`:
        # la app escribe lat/lon/z en el primer moveend, que es el que Leaflet
        # dispara al acotar la vista inicial contra maxBounds. Esperar `z=` leia
        # la URL de ANTES del vuelo y medía el estado equivocado.
        esperar(cdp,
                "parseFloat(new URLSearchParams(location.search).get('lat')) < -48",
                segundos=30)
        v3 = vista()
        prueba("V-41 un cruce sin ningun punto se queda en el ámbito",
               bool(v3) and v3[0] < -48.0,
               f"{v3} · Magallanes va de -56,52 a -48,60; la Araucaria de -39,7 a -37,4")


        # --- la botonera y su modal ------------------------------------------
        # Los ocho filtros dejaron de ser <details> apilados: cada dimensión es
        # un botón que abre un <dialog>. Lo que se comprueba aquí es la
        # MECÁNICA; que las listas de dentro sigan bien ya lo cubren V-30…V-38,
        # que pasan por los mismos botones.
        print("\n=== la botonera de filtros")
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=url)
        esperar(cdp, "!!document.querySelector('.grupo-filtro')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)

        n_botones = cdp.evaluar("document.querySelectorAll('button.grupo-filtro').length")
        quedan = cdp.evaluar("document.querySelectorAll('details.grupo-filtro').length")
        selects = cdp.evaluar("document.querySelectorAll('.panel select').length")
        # ONCE, y ningún <select>. Territorio, Uso e Imagen de fondo eran
        # desplegable y lista mientras las otras ocho ya eran botones: la misma
        # pregunta contestada de tres formas en el mismo panel.
        prueba(f"V-45 {CONTROLES} botones, ningún desplegable y ningún <select>",
               n_botones == CONTROLES and quedan == 0 and selects == 0,
               f"{n_botones} botones · {quedan} <details> · {selects} <select>")

        titulos = json.loads(cdp.evaluar(
            "JSON.stringify([...document.querySelectorAll('.gf-titulo')].map(e => e.textContent))"))
        prueba("V-45b están los tres controles que se convirtieron",
               {"Territorio", "Uso", "Imagen de fondo"} <= set(titulos),
               " · ".join(titulos))

        # V-46: pulsar abre SU modal, no el de otra dimensión. Con un solo
        # <dialog> reutilizado, una `key` mal puesta lo llenaría con la lista
        # anterior y nadie lo notaría hasta filtrar por lo que no era.
        abrir_grupo(cdp, "Cobertura")
        # Por el <h2> del diálogo abierto, no por `#mf-titulo`: ese id era un
        # literal y pasó a `useId()` cuando dejaron de ser ocho modales para ser
        # once. Un id fijo repetido en dos diálogos deja el aria-labelledby
        # ambiguo, así que el cambio era necesario — pero dejó esta aserción
        # leyendo null y en rojo, que es como se descubrió.
        titulo = cdp.evaluar(
            "document.querySelector('dialog.modal-filtro[open] h2')?.textContent")
        etiquetado = cdp.evaluar("""
          (() => {
            const d = document.querySelector('dialog.modal-filtro[open]')
            const id = d?.getAttribute('aria-labelledby')
            return !!(id && d.querySelector('h2')?.id === id)
          })()
        """)
        prueba("V-46 el botón abre el modal de SU dimensión, con nombre",
               titulo == "Cobertura de copas" and etiquetado,
               f"{titulo!r} · aria-labelledby resuelve: {etiquetado}")

        # V-47: se aplica al instante, sin botón «Aplicar». Si el modal se
        # cerrara al marcar, no se podría elegir una segunda clase.
        antes_c = cdp.evaluar("document.querySelector('.cifra-num b').textContent")
        cdp.evaluar("document.querySelector('.modal-filtro .gf-opcion input').click()")
        esperar(cdp, "document.querySelector('.cifra-num b').textContent !== %r" % antes_c,
                segundos=30)
        sigue = cdp.evaluar(MODAL_FILTRO)
        prueba("V-47 marcar aplica al instante y NO cierra el modal",
               sigue and cdp.evaluar("document.querySelector('.cifra-num b').textContent") != antes_c,
               f"{antes_c} → {cdp.evaluar('document.querySelector(\".cifra-num b\").textContent')}")
        capturar(cdp, os.path.join(AQUI, "captura-modal-filtro.png"))

        # V-48: Escape cierra Y el foco vuelve al botón que abrió. El <dialog>
        # lo devuelve solo, pero éste se DESMONTA al cerrarse: medido, sin
        # devolverlo a mano el foco caía al body y acababa en otro botón.
        for t in ("rawKeyDown", "keyUp"):
            cdp.enviar("Input.dispatchKeyEvent", type=t, key="Escape", code="Escape",
                       windowsVirtualKeyCode=27, nativeVirtualKeyCode=27)
        esperar(cdp, f"!({MODAL_FILTRO})", segundos=10)
        # SE ESPERA A LA CONDICIÓN, no se lee una vez. El foco lo devuelve un
        # efecto de React DESPUÉS de que el diálogo se desmonte, así que leer el
        # activeElement justo tras el cierre es una carrera: esta aserción se
        # cayó sola en una tanda que no tocaba nada del foco, y volvió a pasar en
        # la siguiente. Es el mismo error que ya documenta `enfocar_mapa` unas
        # líneas más arriba, cometido otra vez.
        volvio = esperar(
            cdp,
            "document.activeElement?.querySelector?.('.gf-titulo')?.textContent === 'Cobertura'",
            segundos=6)
        foco = cdp.evaluar(
            "document.activeElement?.querySelector?.('.gf-titulo')?.textContent ?? null")
        prueba("V-48 Escape cierra y el foco vuelve a su botón",
               not cdp.evaluar(MODAL_FILTRO) and volvio is not None,
               f"{foco!r} en {volvio:.0f} ms" if volvio is not None else f"{foco!r} tras 6 s")

        # V-49: el botón cuenta lo elegido sin abrir nada.
        badge = cdp.evaluar("""
          (() => {
            const b = [...document.querySelectorAll('.grupo-filtro')]
              .find(d => d.querySelector('.gf-titulo')?.textContent === 'Cobertura')
            return b.classList.contains('con-filtro') + '|' +
                   (b.querySelector('.gf-activas')?.textContent ?? 'sin badge')
          })()
        """)
        prueba("V-49 el botón se marca y cuenta lo elegido", badge == "true|1", str(badge))

        capturar(cdp, os.path.join(AQUI, "captura-botonera.png"))

        # V-50: EL PANEL NO TIENE PROSA. Tenía seis párrafos de nota, una sección
        # de simbología y un pie con cuatro atribuciones compitiendo por el sitio
        # con los diecisiete controles que son su razón de estar. Todo eso vive
        # ahora en el modal de Información — pero «vive en otro sitio» y «se
        # borró» se parecen mucho desde fuera, así que V-65 comprueba que sigue
        # ahí. Esta sólo comprueba que no volvió.
        secciones = json.loads(cdp.evaluar(
            "JSON.stringify([...document.querySelectorAll('.panel > section h2')]"
            ".map(h => h.textContent.trim()))"))
        prosa = cdp.evaluar(
            "document.querySelectorAll("
            "'.panel > section > p, .panel > footer, .panel > section > .nota'"
            ").length")
        acciones = json.loads(cdp.evaluar(
            "JSON.stringify([...document.querySelectorAll('.filtro-botonera.tres .gf-titulo')]"
            ".map(e => e.textContent))"))
        prueba("V-50 el panel no tiene prosa y cierra con los tres botones",
               prosa == 0 and acciones == ["Información", "Descargar", "Compartir"],
               f"{prosa} párrafos sueltos · {' · '.join(secciones)} · {' | '.join(acciones)}")

        # V-58: EL MODAL MIDE LO MISMO QUE EL PANEL. Es lo único que distingue
        # «se abre encima» de «el panel se ensancha»: con el panel a 320 y el
        # modal a 560, abrir un filtro movía el borde 240 px y volvía a moverlo
        # al cerrar. Se compara el ancho de los dos, no contra un número: así
        # sigue valiendo si el tirador cambia el panel.
        ancho_panel = cdp.evaluar(
            "document.querySelector('.panel').getBoundingClientRect().width")
        abrir_grupo(cdp, "Especie")
        ancho_modal = cdp.evaluar(
            "document.querySelector('dialog.modal-filtro[open]').getBoundingClientRect().width")
        cerrar_grupo(cdp)
        prueba("V-58 abrir un filtro no ensancha el panel",
               abs(ancho_modal - ancho_panel) <= 1,
               f"panel {ancho_panel:.0f} px · modal {ancho_modal:.0f} px")

        # --- los tres controles que se convirtieron, y el modal anclado ------
        print("")
        print("=== territorio, mapa base y el anclaje del modal")

        # V-42: la cuenta del botón de Territorio es la que lista su modal. Sin
        # esto, V-37 y V-38 podrían estar leyendo un número decorativo y la
        # cascada territorial quedaría sin vigilar.
        del_boton = regiones_ofrecidas(cdp)
        abrir_grupo(cdp, "Territorio")
        # Menos la fila «Todo Chile», que no es una región.
        del_modal = cdp.evaluar(
            "document.querySelectorAll('.mf-nivel')[0]"
            ".querySelectorAll('.gf-opcion').length - 1")
        prueba("V-42 el botón de Territorio cuenta lo que lista su modal",
               del_boton == del_modal and del_boton > 0,
               f"botón {del_boton} · modal {del_modal}")

        # V-51: EL ANCLAJE. Es lo único que distingue «anclado a la izquierda»
        # de «centrado encima del mapa», y son dos cosas distintas para quien
        # está mirando el mapa cambiar mientras marca. Se mide el borde del
        # diálogo Y los píxeles pintados del mapa con el modal abierto: anclarlo
        # sin quitar el ::backdrop dejaría el mapa igual de velado.
        caja = json.loads(cdp.evaluar(
            "JSON.stringify(document.querySelector('dialog.modal-filtro[open]')"
            ".getBoundingClientRect())"))
        img_modal = capturar(cdp, os.path.join(AQUI, "captura-modal-anclado.png"))
        px_modal, _ = pintados(img_modal, int(caja["right"]) + 8)
        cerrar_grupo(cdp)
        img_libre = capturar(cdp, os.path.join(AQUI, "captura-modal-cerrado.png"))
        px_libre, _ = pintados(img_libre, int(caja["right"]) + 8)
        # EN RELATIVO Y NO CONTRA UN NÚMERO. Con un umbral absoluto —«más de
        # 20.000 px»— el velo del ::backdrop al 55 % pasaba la aserción: el mapa
        # quedaba en 59.000 px de los 398.000 que tiene sin velo, o sea siete
        # veces más oscuro, y aun así por encima del umbral. Lo caza
        # `mutaciones-visor.py`. Comparado con el mismo encuadre sin modal, no
        # hay número que calibrar y la pregunta es la que importa: ¿se ve el mapa
        # IGUAL de bien con el modal abierto?
        proporcion = px_modal / px_libre if px_libre else 0
        prueba("V-51 el modal abre pegado a la izquierda y el mapa se ve igual",
               caja["x"] <= 2 and caja["bottom"] >= 900 and proporcion > 0.9,
               f"x={caja['x']:.0f} alto={caja['height']:.0f} · "
               f"{px_modal:,} de {px_libre:,} px ({proporcion:.0%})")
        abrir_grupo(cdp, "Territorio")

        # V-52: elegir región dentro del modal reencuadra el mapa Y rotula el
        # botón. Las dos mitades importan: un ámbito que cambia las cifras sin
        # verse en ninguna parte es la forma más fácil de citar una cifra
        # regional como nacional.
        cdp.evaluar("""
          (() => {
            const l = [...document.querySelectorAll('.mf-nivel .gf-opcion')]
              .find(x => x.querySelector('.gf-etq').childNodes[0].textContent.trim() === 'Los Lagos')
            l?.querySelector('input').click()
          })()
        """)
        volo = esperar(cdp,
                       "parseFloat(new URLSearchParams(location.search).get('lat')) < -40",
                       segundos=30)
        cerrar_grupo(cdp)
        rotulo = cdp.evaluar(
            "document.querySelector('.grupo-filtro[data-col=\"territorio\"] .gf-valor')"
            "?.textContent")
        v_reg = vista()
        prueba("V-52 elegir región reencuadra el mapa y rotula el botón",
               volo is not None and rotulo == "Los Lagos" and bool(v_reg) and v_reg[0] < -40,
               f"{rotulo!r} · {v_reg}")

        # V-53: el mapa base. Cada fila enseña SU advertencia, no sólo la de la
        # capa activa: con el <select> la nota de Sentinel-2 aparecía después de
        # haberla elegido, o sea cuando ya no servía para no elegirla.
        abrir_grupo(cdp, "Imagen de fondo")
        fondos = cdp.evaluar("document.querySelectorAll('.modal-filtro .gf-opcion').length")
        avisos = cdp.evaluar("document.querySelectorAll('.modal-filtro .gf-opcion .gf-sub').length")
        cdp.evaluar("""
          (() => {
            const l = [...document.querySelectorAll('.modal-filtro .gf-opcion')]
              .find(x => x.querySelector('.gf-etq').childNodes[0].textContent.trim() === 'Satelital')
            l?.querySelector('input').click()
          })()
        """)
        cambio = esperar(cdp,
                         "[...document.querySelectorAll('.leaflet-tile-pane img')]"
                         ".some(i => /World_Imagery/.test(i.src))", segundos=20)
        cerrar_grupo(cdp)
        valor_base = cdp.evaluar(
            "document.querySelector('.grupo-filtro[data-col=\"base\"] .gf-valor')?.textContent")
        prueba("V-53 el mapa base lista sus 7 fondos con aviso y cambia la capa",
               fondos == 7 and avisos >= 4 and cambio is not None and valor_base == "Satelital",
               f"{fondos} fondos · {avisos} avisos · botón {valor_base!r}")

        # --- el tamaño del punto ---------------------------------------------
        # NINGUNA ASERCIÓN MEDÍA UN DIÁMETRO, y por eso el defecto vivió tanto:
        # `getRadius` estaba puesto como PROP de la capa en vez de dentro de
        # `data.attributes`, deck.gl lo ignoraba en silencio y todos los discos
        # se dibujaban con el radio por defecto —un metro, o sea el suelo de
        # píxeles— desde el primer día del proyecto. Eso era la «viruela».
        print("")
        print("=== el tamaño del punto")
        aislado = punto_aislado()
        if not aislado:
            fallos.append("V-54 no encontró un punto aislado que medir")
            print("    V-54 SIN MEDIR: no hay ningún disco medible sin vecino pegado")
        else:
            lat_a, lon_a, ha_a, r_m = aislado
            medido = {}
            for z in (11, 13):
                cdp.enviar("Page.navigate", url="about:blank")
                esperar(cdp, "document.readyState === 'complete'", segundos=30)
                cdp.enviar("Page.navigate", url=f"{url}?lat={lat_a:.6f}&lon={lon_a:.6f}&z={z}")
                esperar(cdp, "!!document.querySelector('.grupo-filtro')", segundos=60)
                esperar(cdp, "!document.querySelector('.descargando')", segundos=120)
                # Al primer fotograma de deck.gl no se le pone reloj: se espera a
                # que haya algo pintado bajo el centro.
                cx_a, cy_a = centro_del_mapa(cdp)
                ruta_z = os.path.join(AQUI, f"captura-radio-z{z}.png")
                d = 0
                t0 = time.time()
                while time.time() - t0 < 30:
                    d = diametro_del_disco(cdp, cx_a, cy_a, ruta_z)
                    if d > 0:
                        break
                    time.sleep(0.4)
                medido[z] = d

            previsto = {z: 2 * r_m / metros_por_pixel(lat_a, z) for z in (11, 13)}
            razon = medido[13] / medido[11] if medido[11] else 0
            # La razón entre los dos zooms es LA prueba de que el radio está en
            # metros: dos niveles de zoom son exactamente 4x. Con el radio en
            # píxeles —lo que había— saldría 1.
            prueba("V-54 el disco crece con el zoom, y lo hace en metros",
                   0.6 * previsto[11] < medido[11] < 1.6 * previsto[11] + 3
                   and 0.6 * previsto[13] < medido[13] < 1.6 * previsto[13] + 3
                   and 3.0 < razon < 5.2,
                   f"{ha_a:.0f} ha, radio publicado {r_m:.0f} m · "
                   f"z11 {medido[11]} px (previsto {previsto[11]:.0f}) · "
                   f"z13 {medido[13]} px (previsto {previsto[13]:.0f}) · razón {razon:.1f}")

        # V-55: EL COSTE DEL PINTADO, que no tenía techo. Todas las mediciones de
        # este repo se tomaron con `radiusMaxPixels: 3`; pasar el punto mediano a
        # decenas de píxeles de radio son órdenes de magnitud más fragmentos por
        # punto, y el presupuesto medido que había era el del FILTRO, no el del
        # dibujo.
        #
        # La resolución de esta medida es una captura de pantalla —unos 150 ms—,
        # así que es una RED DE SEGURIDAD contra una regresión grande, no un gate
        # fino. Se dice para que nadie la lea como más precisa de lo que es.
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=f"{url}?lat=-39.814&lon=-73.245&z=13")
        esperar(cdp, "!!document.querySelector('.grupo-filtro')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=180)
        t0 = time.time()
        px_pint = 0
        while time.time() - t0 < 20:
            img = capturar(cdp, os.path.join(AQUI, "captura-pintado.png"))
            px_pint, _ = pintados(img, 340)
            if px_pint > 20000:
                break
            time.sleep(0.15)
        ms_pintado = (time.time() - t0) * 1000
        prueba("V-55 el primer pintado con discos grandes cabe en el techo",
               px_pint > 20000 and ms_pintado < TECHO_PINTADO_MS,
               f"{ms_pintado:.0f} ms de {TECHO_PINTADO_MS} · {px_pint:,} px sobre Valdivia")

        # --- el reporte -------------------------------------------------------
        # No lo había: cuando se preguntó, la respuesta fue que el PDF se
        # resolvía por otra vía, así que quedó fuera. Se hace con window.print()
        # y CSS @media print, y lo que se comprueba aquí es lo que distingue eso
        # de una captura de pantalla: que hay TEXTO.
        print("")
        print("=== el reporte")
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=f"{url}?reg=10")
        esperar(cdp, "!!document.querySelector('.grupo-filtro')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)
        titular_panel = cdp.evaluar("document.querySelector('.cifra-num b').textContent")
        # El botón del reporte se mudó DENTRO del modal de Descargar cuando el
        # panel se quedó sin prosa: hay que abrirlo antes.
        abrir_grupo(cdp, "Descargar")
        cdp.evaluar(
            "[...document.querySelectorAll('.modal-filtro button')]"
            ".find(b => /Reporte del/.test(b.textContent))?.click()")
        abrio = esperar(cdp, "!!document.querySelector('.reporte-doc')", segundos=20)
        texto = str(cdp.evaluar("document.querySelector('.reporte-doc')?.innerText") or "")
        secciones_rep = json.loads(cdp.evaluar(
            "JSON.stringify([...document.querySelectorAll('.reporte-doc h2')]"
            ".map(h => h.textContent))"))
        # Los umbrales suben con el documento: pasó de dos páginas a seis al
        # añadir estructura del dosel, especies, distribución territorial,
        # cobertura del dato y los anexos B y C. Un mínimo de 1.500 caracteres
        # dejaría pasar que la mitad del reporte desapareciera.
        prueba("V-57 el reporte abre con texto real y las cifras del ámbito",
               abrio is not None and len(texto) > 6000 and len(secciones_rep) >= 10
               and "Los Lagos" in texto and str(titular_panel) in texto,
               f"{len(texto)} caracteres · {len(secciones_rep)} secciones · "
               f"titular {titular_panel!r}")

        # V-57c: LAS TABLAS TRAEN FILAS. Un documento largo cuyas tablas salen
        # vacías tiene el mismo aspecto en la lista de secciones que uno lleno, y
        # cada sección nueva depende de un campo distinto del resumen: si uno
        # dejara de calcularse, su tabla se quedaría en el <thead>.
        tablas = json.loads(cdp.evaluar(
            "JSON.stringify([...document.querySelectorAll('.reporte-doc table')]"
            ".map(t => t.querySelectorAll('tbody tr').length))"))
        prueba("V-57c ninguna tabla del reporte sale vacía",
               len(tablas) >= 9 and all(t > 0 for t in tablas),
               f"{len(tablas)} tablas · filas {tablas}")

        # V-57d: EL REPORTE TRAE UNA COPIA DEL MAPA, Y NO ESTÁ EN BLANCO.
        #
        # Esto no se puede comprobar mirando que exista el <img>: un lienzo WebGL
        # sin `preserveDrawingBuffer` devuelve un PNG perfectamente válido y
        # COMPLETAMENTE TRANSPARENTE, sin lanzar ningún error. Se midió poniendo
        # la opción en false: 18 KB y cero píxeles pintados, contra 703 KB y un
        # 27,8 % con ella. Un recuadro vacío rotulado «mapa» dentro de un PDF con
        # identidad institucional es el fallo silencioso más caro que puede tener
        # este visor, así que aquí se DECODIFICA la imagen y se cuentan píxeles.
        datos_img = str(cdp.evaluar(
            "document.querySelector('.rep-mapa img')?.src ?? ''") or "")
        pie_mapa = str(cdp.evaluar(
            "document.querySelector('.rep-mapa figcaption')?.textContent") or "")
        pintado_mapa = 0.0
        if datos_img.startswith("data:image/png;base64,"):
            crudo = base64.b64decode(datos_img.split(",", 1)[1])
            ruta_m = os.path.join(AQUI, "captura-reporte-mapa.png")
            with open(ruta_m, "wb") as fh:
                fh.write(crudo)
            im = np.array(Image.open(ruta_m).convert("RGB"))
            # CONTRA EL COLOR MÁS REPETIDO, no contra la transparencia. La
            # primera versión contaba alfa y daba 100 % siempre: la captura
            # rellena el fondo antes de dibujar, así que no hay un solo píxel
            # transparente ni aunque el mapa salga vacío. Medir así no medía
            # nada, y una aserción que no puede fallar no protege.
            vals, cuentas = np.unique(im.reshape(-1, 3), axis=0, return_counts=True)
            fondo_m = vals[cuentas.argmax()]
            pintado_mapa = float((np.abs(im - fondo_m).sum(axis=2) > 20).mean())
        # El ámbito lo dice el PROPIO documento, no una constante escrita aquí:
        # el reporte de esta tanda es el de otra región y la aserción se cayó por
        # eso, midiendo bien y comparando contra un nombre equivocado.
        ambito_doc = str(cdp.evaluar(
            "document.querySelector('.rep-ficha dd')?.textContent") or "")
        # EL UMBRAL SEPARA «NADA» DE «ALGO», no policía cobertura. El fallo que
        # busca da EXACTAMENTE 0,0 % --lienzo transparente-- y una copia legítima
        # da desde 1,9 % (una región a z7, medido) hasta 17 % (una ciudad a z13).
        # Ponerlo en el 1 % dejaba a la aserción a menos del doble del umbral y a
        # merced de que una máquina lenta capture el vuelo a medias.
        prueba("V-57d el reporte copia el mapa y la copia tiene contenido",
               pintado_mapa > 0.002 and ambito_doc and ambito_doc in pie_mapa,
               f"{len(datos_img):,} B de data URI · {pintado_mapa:.1%} con contenido · "
               f"ámbito {ambito_doc!r}")

        # V-57e: LAS TESELAS SE PIDEN EN MODO CORS. Sin `crossOrigin`, dibujar
        # una en un canvas lo MANCHA y el `toDataURL` de la copia lanza
        # SecurityError — medido. Aquí las teselas están bloqueadas a propósito,
        # así que no se puede comprobar la composición; lo que sí se comprueba es
        # la propiedad que la hace posible, que vive en el elemento aunque la
        # petición no llegue.
        cors = cdp.evaluar("""
          (() => {
            const t = [...document.querySelectorAll('img.leaflet-tile')]
            if (!t.length) return 'sin teselas en el DOM'
            const malas = t.filter(i => i.crossOrigin !== 'anonymous').length
            return malas ? malas + ' de ' + t.length + ' sin crossOrigin' : 'las ' + t.length
          })()
        """)
        prueba("V-57e las teselas se piden en modo CORS, o la copia se mancha",
               str(cors).startswith("las "), str(cors))

        # V-57b: LO QUE SE IMPRIME. Un reporte que en pantalla se ve perfecto y
        # sale con el mapa detrás —o con la barra de botones dentro— no sirve, y
        # es exactamente el fallo silencioso que dejó el reporte de referencia en
        # cincuenta páginas blancas. Se emula el medio de impresión y se mira.
        cdp.enviar("Emulation.setEmulatedMedia", media="print")
        time.sleep(0.6)
        fuera = json.loads(cdp.evaluar(
            "JSON.stringify({"
            "  mapa: !!document.querySelector('.mapa')?.offsetParent,"
            "  panel: !!document.querySelector('.panel')?.offsetParent,"
            "  barra: !!document.querySelector('.reporte-barra')?.offsetParent,"
            "  doc: !!document.querySelector('.reporte-doc')?.offsetParent})"))
        capturar(cdp, os.path.join(AQUI, "captura-reporte-impreso.png"))
        cdp.enviar("Emulation.setEmulatedMedia", media="")
        prueba("V-57b al imprimir sale el documento y nada más",
               fuera["doc"] and not fuera["mapa"] and not fuera["panel"] and not fuera["barra"],
               json.dumps(fuera))

        # --- los tres botones que se llevaron la prosa ------------------------
        # V-50 comprueba que el panel se quedó sin texto. Estas tres comprueban
        # LO OTRO, que es lo que de verdad importa: que el texto no se perdió por
        # el camino. «Se mudó» y «se borró» se ven igual desde el panel.
        print("")
        print("=== información, descargas y compartir")

        # V-65: Información trae la prosa del panel Y la Metodología entera, que
        # era un diálogo aparte. Se exige que estén las dos cosas: sólo la mitad
        # sería un modal que parece completo.
        abrir_grupo(cdp, "Información")
        texto_info = str(cdp.evaluar(
            "document.querySelector('.modal-filtro .mf-cuerpo')?.innerText") or "")
        h3_info = json.loads(cdp.evaluar(
            "JSON.stringify([...document.querySelectorAll('.modal-filtro .mf-cuerpo h3')]"
            ".map(e => e.textContent))"))
        met_dentro = cdp.evaluar(
            "!!document.querySelector('.modal-filtro .met-cuerpo')")
        cerrar_grupo(cdp)
        prueba("V-65 Información trae la prosa del panel y la Metodología",
               len(texto_info) > 6000 and met_dentro
               and "Qué cuenta el Catastro como bosque" in h3_info
               and any("tamaño de los puntos" in x for x in h3_info),
               f"{len(texto_info)} caracteres · {len(h3_info)} apartados · "
               f"metodología dentro: {met_dentro}")

        # V-66: Compartir enseña el enlace DE ESTA VISTA. Que lo enseñe y no sólo
        # lo copie es deliberado: el enlace lleva el ámbito y los filtros, así que
        # quien lo abra recibe cifras recortadas, y un botón que copia en silencio
        # no da ocasión de leer esa advertencia.
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=f"{url}?reg=10")
        esperar(cdp, "!!document.querySelector('.grupo-filtro')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)
        abrir_grupo(cdp, "Compartir")
        enlace = str(cdp.evaluar(
            "document.querySelector('.modal-filtro input[readonly]')?.value") or "")
        aviso_c = str(cdp.evaluar(
            "document.querySelector('.modal-filtro .nota')?.textContent") or "")
        cerrar_grupo(cdp)
        prueba("V-66 Compartir enseña el enlace del ámbito activo y avisa",
               "reg=10" in enlace and "no son las nacionales" in aviso_c,
               f"{enlace[-60:]!r}")

        # V-67: Descargar lleva dentro lo que estaba suelto en el panel. Se mira
        # que estén los TRES botones: el reporte, las cifras y los polígonos.
        abrir_grupo(cdp, "Descargar")
        botones_d = json.loads(cdp.evaluar(
            "JSON.stringify([...document.querySelectorAll('.modal-filtro button')]"
            ".map(b => b.textContent.trim()))"))
        cerrar_grupo(cdp)
        prueba("V-67 Descargar trae el reporte y los dos formatos",
               any("Reporte" in b for b in botones_d)
               and any("Cifras" in b for b in botones_d)
               and "CSV" in botones_d and "GeoJSON" in botones_d,
               " | ".join(botones_d))

        # --- el ámbito territorial contra el manifest -------------------------
        print("")
        print("=== las dieciséis regiones, una a una")

        # V-59 ES LA ASERCIÓN QUE HABRÍA CAZADO EL DEFECTO MÁS CARO DE ESTE
        # VISOR EL PRIMER DÍA, y no existía: ninguna comparaba un ámbito contra
        # el manifest.
        #
        # Durante meses, elegir la Región de Los Ríos movía el mapa, rotulaba
        # «Los Ríos» y entregaba 75,7 M ha y 1.827.933 polígonos: el país
        # entero. Sus 79.727 filas llegaban sin comuna --el código venía en otra
        # columna del origen-- y el ámbito, que se derivaba de las comunas,
        # salía vacío; un conjunto vacío significaba «todas». Las otras quince
        # regiones sí cuadraban, así que cualquier prueba sobre UNA región
        # elegida al azar tenía quince de dieciséis de pasar.
        #
        # Por eso se recorren LAS DIECISÉIS. Y se hace por la interfaz, con un
        # solo `.bin` cargado: navegar dieciséis veces costaría cuatro minutos
        # de descarga para medir lo mismo.
        man_reg = json.load(open(os.path.join(DIST, "datos", "manifest.json"),
                                 encoding="utf-8"))
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=url)
        esperar(cdp, "!!document.querySelector('.grupo-filtro')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)
        nacional = cdp.evaluar("document.querySelector('.cifra-etq')?.textContent")

        descuadran = []
        for r in sorted(man_reg["regiones"], key=lambda x: x["orden"]):
            abrir_grupo(cdp, "Territorio")
            hecho = cdp.evaluar("""
              (() => {
                const l = [...document.querySelectorAll('.mf-nivel')[0].querySelectorAll('.gf-opcion')]
                  .find(x => x.querySelector('.gf-etq').childNodes[0].textContent.trim() === %s)
                if (!l) return false
                l.querySelector('input').click()
                return true
              })()
            """ % json.dumps(r["nombre"]))
            # Se espera a que la CIFRA lleve el nombre de la región: el recálculo
            # tarda, y durante ese rato el panel conserva la del ámbito anterior
            # ya con el rótulo nuevo. Leer antes mediría el ámbito de antes.
            esperar(cdp, "document.querySelector('.cifra-etq')?.textContent.includes(%s)"
                    % json.dumps(r["nombre"]), segundos=40)
            etq = str(cdp.evaluar("document.querySelector('.cifra-etq')?.textContent") or "")
            niveles = cdp.evaluar("document.querySelectorAll('.mf-nivel').length")
            comunas = cdp.evaluar(
                "document.querySelectorAll('.mf-nivel')[2]?.querySelectorAll('.gf-opcion').length ?? 0")
            cerrar_grupo(cdp)
            leido = int(re.sub(r"[^\d]", "", etq.split("polígonos")[0]) or -1)
            del_manifest = [c for c in man_reg["comunas"] if c["region"] == r["cod"]]
            if not hecho or leido != r["n"] or niveles != 3 or (comunas - 1) != len(del_manifest):
                descuadran.append(
                    f"{r['nombre']}: panel {leido:,} vs manifest {r['n']:,}, "
                    f"{max(0, comunas - 1)} comunas vs {len(del_manifest)}")
        prueba("V-59 las dieciséis regiones cuadran con el manifest",
               not descuadran, " · ".join(descuadran) if descuadran
               else f"16/16, y ninguna devuelve el nacional ({nacional})")

        # V-60: un ámbito que NO CALZA con nada devuelve cero y lo dice. Es la
        # otra mitad del mismo defecto, y sobrevivió al primer arreglo: el cruce
        # se saltaba los filtros con el conjunto vacío, así que una provincia
        # que no existe en esa región devolvía la REGIÓN ENTERA rotulada con la
        # provincia ajena. Lo encontró una sonda, no una aserción; ésta es la
        # aserción.
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=f"{url}?reg=15&prov=Valdivia")
        esperar(cdp, "!!document.querySelector('.grupo-filtro')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)
        esperar(cdp, "document.querySelector('.cifra-etq')?.textContent.includes('Valdivia')",
                segundos=40)
        etq_v = str(cdp.evaluar("document.querySelector('.cifra-etq')?.textContent") or "")
        titular_v = str(cdp.evaluar("document.querySelector('.cifra-num b')?.textContent") or "")
        prueba("V-60 un ámbito sin coincidencias da cero, no el país",
               etq_v.startswith("0 polígonos") and titular_v.strip().split()[:1] == ["0"],
               f"{titular_v!r} · {etq_v!r}")

        # --- lo que cambió la homologación -----------------------------------
        print("")
        print("=== la homologación")
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=url)
        esperar(cdp, "!!document.querySelector('.grupo-filtro')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)

        # V-61: las clases que llegaban partidas por la ortografía. Cuatro
        # unidades del SNASPE y cuatro subtipos sumaban por separado, y quien
        # consultaba una obtenía poco más de la mitad de su superficie.
        def sin_tilde(x):
            x = unicodedata.normalize("NFKD", str(x))
            return re.sub(r"[^a-z0-9]", "", "".join(
                c for c in x if not unicodedata.combining(c)).lower())

        colapsos = []
        for titulo, cuantas in (("SNASPE", 90), ("Subtipo", 33)):
            g = grupo_filtro(cdp, titulo)
            # SNASPE lista recortada a 40: la cuenta va en el botón, no en la lista.
            total = int(re.sub(r"[^\d]", "", g["total"]) or -1)
            vistos = {}
            for f in g["filas"]:
                vistos.setdefault(sin_tilde(f["etq"]), []).append(f["etq"])
            dobles = [v for v in vistos.values() if len(v) > 1]
            if total != cuantas or dobles:
                colapsos.append(f"{titulo}: {total} de {cuantas}, colapsan {dobles}")
        prueba("V-61 SNASPE y subtipos, homologados y sin pares que colapsen",
               not colapsos, " · ".join(colapsos) if colapsos else "90 unidades · 33 subtipos")

        # V-61b: Villarrica NO se fundió. Son dos unidades distintas del Sistema
        # que comparten topónimo, y es el caso que una normalización automática
        # habría destruido: por eso el canónico lleva siempre la categoría.
        sna = grupo_filtro(cdp, "SNASPE")
        villa = sorted(f["etq"] for f in sna["filas"] if "villarrica" in sin_tilde(f["etq"]))
        prueba("V-61b Parque y Reserva Villarrica siguen separados",
               len(villa) == 2, " · ".join(villa) or "ninguna")

        # V-62: un enlace ya compartido con un código que la homologación borró
        # sigue filtrando lo mismo. Sin el mapa de alias filtraría NADA, y el
        # visor no distingue «no encuentra» de «no hay filtro»: quien lo abriera
        # vería el país entero creyendo mirar una unidad del SNASPE.
        viejo_cod = next(iter(man_reg.get("alias", {}).get("snaspe", {})), None)
        if not viejo_cod:
            fallos.append("V-62 el manifest no publica ningún alias que probar")
            print("    V-62 SIN MEDIR: no hay alias en el manifest")
        else:
            nuevo_cod = man_reg["alias"]["snaspe"][viejo_cod]
            esperado = next(u["n"] for u in man_reg["snaspe"] if u["cod"] == nuevo_cod)
            cdp.enviar("Page.navigate", url="about:blank")
            esperar(cdp, "document.readyState === 'complete'", segundos=30)
            cdp.enviar("Page.navigate",
                       url=f"{url}?snaspe={requests.utils.quote(viejo_cod)}")
            esperar(cdp, "!!document.querySelector('.grupo-filtro')", segundos=60)
            esperar(cdp, "!document.querySelector('.descargando')", segundos=120)
            esperar(cdp, "document.querySelector('.cifra-num b')?.textContent !== '75,7'",
                    segundos=40)
            etq_a = str(cdp.evaluar("document.querySelector('.cifra-etq')?.textContent") or "")
            leido_a = int(re.sub(r"[^\d]", "", etq_a.split("polígonos")[0]) or -1)
            prueba("V-62 un código borrado por la homologación sigue filtrando",
                   leido_a == esperado,
                   f"?snaspe={viejo_cod!r} -> {leido_a:,} polígonos, {nuevo_cod!r} tiene "
                   f"{esperado:,}")

        # V-63: las seis dimensiones derivadas de la especie filtran de verdad.
        # No son columnas del .bin: las construye el cliente al cargar, y una
        # derivación mal hecha da una lista con clases y cifras plausibles que no
        # filtra nada. Se comprueba que MUEVEN la cifra.
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=url)
        esperar(cdp, "!!document.querySelector('.grupo-filtro')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)
        mudas = []
        for titulo in ("Grupo", "Hábito", "Arbórea", "Origen", "Invasora", "Conservación",
                       "Protección", "Tamaño", "Año"):
            g = grupo_filtro(cdp, titulo)
            antes_d = cdp.evaluar("document.querySelector('.cifra-num b').textContent")
            marcar_clase(cdp, titulo, g["filas"][0]["etq"])
            movio = esperar(cdp, "document.querySelector('.cifra-num b').textContent !== %r"
                            % antes_d, segundos=30)
            if movio is None or not g["filas"]:
                mudas.append(f"{titulo} ({len(g['filas'])} clases)")
            cdp.evaluar("[...document.querySelectorAll('.limpiar')]"
                        ".find(b => /Quitar/.test(b.textContent))?.click()")
            esperar(cdp, "document.querySelector('.cifra-num b').textContent === %r" % antes_d,
                    segundos=30)
        prueba("V-63 las nueve dimensiones derivadas filtran de verdad",
               not mudas, " · ".join(mudas) if mudas
               else "las seis de la especie más protección, tamaño y año mueven la cifra")

        print("\n" + "=" * 62)
        print(f"  {'TODO EN VERDE' if not fallos else str(len(fallos)) + ' EN ROJO'}")
        print("=" * 62)
        cdp.cerrar()
    finally:
        srv.shutdown()
        if proc and proc.poll() is None:
            proc.terminate()
        if perfil and os.path.isdir(perfil):
            shutil.rmtree(perfil, ignore_errors=True)
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
