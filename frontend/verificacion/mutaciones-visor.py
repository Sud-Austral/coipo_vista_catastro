"""Rompe el CODIGO DEL VISOR a proposito y exige que la asercion se entere.

Hermana de `mutaciones.py`, que hace lo mismo con la aritmetica del cruce. Aqui
las victimas son la interfaz y el mapa: la botonera, el anclaje del modal, el
tamano del punto, los enlaces de la ficha y el reporte.

POR QUE HACE FALTA. Una asercion que nunca se ha visto roja no es una prueba, y
en este mismo repo ya paso dos veces:

  - V-22b se quedo en VERDE midiendo otra cosa. Calculaba el radio dibujado con
    la formula vieja en pixeles; cuando el radio paso a metros, el clic «al
    lado» le caia DENTRO del disco y la asercion decia OK sin tocar la
    tolerancia que dice proteger.
  - `marginales.mjs` paso en VERDE con la casilla del centinela rota, y lo
    encontro `mutaciones.py`, no la prueba.

Cada caso: se parchea el fuente, se compila, se abre el visor y se corre SOLO la
sonda de esa asercion. Tiene que salir ROJA. Y antes de nada se corre la tanda
en LIMPIO, que es el control positivo: si una sonda ya sale roja sin mutar, lo
que esta mal es la sonda.

NO va en el CI: parchea archivos del repo y compila. Se corre a mano despues de
tocar el mapa o el panel, y restaura siempre, pase lo que pase.

Uso:  python frontend/verificacion/mutaciones-visor.py [--solo <trozo del nombre>]
"""

import argparse
import functools
import http.server
import json
import math
import os
import re
import unicodedata
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time

import base64

import numpy as np
from PIL import Image
import requests

AQUI = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.dirname(AQUI)
RAIZ = os.path.dirname(FRONTEND)
DIST = os.path.join(FRONTEND, "dist")
BASE = "/coipo_vista_catastro/"
TILES = ("openstreetmap.org", "arcgisonline.com", "eox.at")
sys.path.insert(0, os.path.join(RAIZ, "spike"))
from medir import Cdp, lanzar_chrome  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

# Se reutilizan las MISMAS piezas del arnes en vez de copiarlas: si `capturar` o
# `punto_aislado` cambian, esto tiene que cambiar con ellas o la mutacion
# probaria una version distinta de la medida.
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("verificar", os.path.join(AQUI, "verificar.py"))
V = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(V)


# --------------------------------------------------------------- infraestructura
class Manejador(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split("?", 1)[0].split("#", 1)[0]
        if not p.startswith(BASE):
            return os.path.join(DIST, "__404__")
        return super().translate_path(p[len(BASE) - 1:])

    def log_message(self, *a):
        pass


def compilar():
    r = subprocess.run(["npm", "run", "build"], cwd=FRONTEND, shell=True,
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("no compila:\n" + r.stdout[-2000:] + r.stderr[-2000:])


def construir_datos():
    """Regenera el .bin y el manifest. Cuesta 15 s, medido, asi que las
    mutaciones del ETL --las que rompen el DATO y no el codigo del visor-- salen
    baratas. Sin esto, el defecto de Los Rios no se podria reintroducir: vivia en
    una consulta SQL, no en el frontend."""
    r = subprocess.run([sys.executable, os.path.join(RAIZ, "ETL", "build_bin.py")],
                       cwd=RAIZ, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("el ETL no construye:\n" + (r.stdout + r.stderr)[-2000:])
    # `dist/datos` es una copia de `public/datos` que hace Vite al compilar.
    compilar()


def abrir(url):
    proc, perfil, dp = lanzar_chrome(url, ver=False, swiftshader=False)
    destino = None
    for _ in range(200):
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
        proc.kill()
        raise RuntimeError("no aparecio la pestana")
    cdp = Cdp(destino["webSocketDebuggerUrl"])
    for m in ("Runtime.enable", "Page.enable", "Network.enable", "Emulation.enable"):
        try:
            cdp.enviar(m)
        except Exception:
            pass
    cdp.enviar("Network.setBlockedURLs", urls=[f"*{h}*" for h in TILES])
    cdp.enviar("Emulation.setDeviceMetricsOverride", width=1440, height=1000,
               deviceScaleFactor=1, mobile=False)
    return proc, perfil, cdp


def ir(cdp, url):
    """Navega y espera a que la app este montada Y con datos."""
    cdp.enviar("Page.navigate", url="about:blank")
    V.esperar(cdp, "document.readyState === 'complete'", segundos=30)
    cdp.enviar("Page.navigate", url=url)
    V.esperar(cdp, "!!document.querySelector('.grupo-filtro')", segundos=90)
    V.esperar(cdp, "!document.querySelector('.descargando')", segundos=180)


# --------------------------------------------------------------------- las sondas
# Cada sonda devuelve (pasa, detalle). `pasa` es lo que la asercion del arnes
# afirma; una mutacion correcta tiene que volverlo False.

def sonda_botones(cdp, url):
    ir(cdp, url)
    n = cdp.evaluar("document.querySelectorAll('button.grupo-filtro').length")
    sel = cdp.evaluar("document.querySelectorAll('.panel select').length")
    tit = json.loads(cdp.evaluar(
        "JSON.stringify([...document.querySelectorAll('.gf-titulo')].map(e => e.textContent))"))
    # 23: 20 controles mas Informacion, Descargar y Compartir. El
    # numero se actualiza a mano, igual que CONTROLES en verificar.py: es la
    # cuenta que caza que un control desaparezca sin que nadie lo note.
    pasa = (n == 23 and sel == 0
            and {"Territorio", "Uso", "Imagen de fondo", "Protección", "Tamaño", "Año",
                 "Información", "Descargar", "Compartir"} <= set(tit))
    return pasa, f"{n} botones · {sel} <select>"


def sonda_anclaje(cdp, url):
    ir(cdp, url)
    V.abrir_grupo(cdp, "Cobertura")
    caja = json.loads(cdp.evaluar(
        "JSON.stringify(document.querySelector('dialog.modal-filtro[open]')"
        ".getBoundingClientRect())"))
    img = V.capturar(cdp, os.path.join(AQUI, "mutacion-anclaje.png"))
    px, _ = V.pintados(img, int(caja["right"]) + 8)
    V.cerrar_grupo(cdp)
    libre, _ = V.pintados(V.capturar(cdp, os.path.join(AQUI, "mutacion-anclaje-libre.png")),
                          int(caja["right"]) + 8)
    prop = px / libre if libre else 0
    pasa = caja["x"] <= 2 and caja["bottom"] >= 900 and prop > 0.9
    return pasa, f"x={caja['x']:.0f} alto={caja['height']:.0f} · {px:,}/{libre:,} ({prop:.0%})"


def sonda_uso(cdp, url):
    ir(cdp, url + "?reg=11")
    m = V.grupo_filtro(cdp, "Uso")
    if not m:
        return False, "no abrio el modal de Uso"
    ocultas = 0
    for pie in m["pies"]:
        mm = re.match(r"^(\d+) clases", pie)
        if mm:
            ocultas = int(mm.group(1))
    listadas = len(m["filas"])
    return listadas + ocultas == 9 and listadas > 0, f"{listadas} + {ocultas}"


def sonda_territorio(cdp, url):
    ir(cdp, url)
    boton = V.regiones_ofrecidas(cdp)
    V.abrir_grupo(cdp, "Territorio")
    modal = cdp.evaluar("document.querySelectorAll('.mf-nivel')[0]"
                        ".querySelectorAll('.gf-opcion').length - 1")
    cdp.evaluar("""
      (() => {
        const l = [...document.querySelectorAll('.mf-nivel .gf-opcion')]
          .find(x => x.querySelector('.gf-etq').childNodes[0].textContent.trim() === 'Los Lagos')
        l?.querySelector('input').click()
      })()
    """)
    volo = V.esperar(cdp, "parseFloat(new URLSearchParams(location.search).get('lat')) < -40",
                     segundos=30)
    V.cerrar_grupo(cdp)
    rotulo = cdp.evaluar(
        "document.querySelector('.grupo-filtro[data-col=\"territorio\"] .gf-valor')?.textContent")
    pasa = boton == modal and boton > 0 and volo is not None and rotulo == "Los Lagos"
    return pasa, f"boton {boton} · modal {modal} · rotulo {rotulo!r}"


def sonda_base(cdp, url):
    ir(cdp, url)
    V.abrir_grupo(cdp, "Imagen de fondo")
    fondos = cdp.evaluar("document.querySelectorAll('.modal-filtro .gf-opcion').length")
    avisos = cdp.evaluar("document.querySelectorAll('.modal-filtro .gf-opcion .gf-sub').length")
    cdp.evaluar("""
      (() => {
        const l = [...document.querySelectorAll('.modal-filtro .gf-opcion')]
          .find(x => x.querySelector('.gf-etq').childNodes[0].textContent.trim() === 'Satelital')
        l?.querySelector('input').click()
      })()
    """)
    cambio = V.esperar(cdp, "[...document.querySelectorAll('.leaflet-tile-pane img')]"
                            ".some(i => /World_Imagery/.test(i.src))", segundos=20)
    V.cerrar_grupo(cdp)
    valor = cdp.evaluar(
        "document.querySelector('.grupo-filtro[data-col=\"base\"] .gf-valor')?.textContent")
    pasa = fondos == 7 and avisos >= 4 and cambio is not None and valor == "Satelital"
    return pasa, f"{fondos} fondos · {avisos} avisos · {valor!r}"


def sonda_radio(cdp, url):
    aislado = V.punto_aislado()
    if not aislado:
        return False, "sin punto aislado"
    # El radio PUBLICADO, no el de igual área: desde que se recorta por el vecino
    # más cercano, la fórmula ya no describe lo que se dibuja.
    lat, lon, hah, r_m = aislado
    medido = {}
    for z in (11, 13):
        ir(cdp, f"{url}?lat={lat:.6f}&lon={lon:.6f}&z={z}")
        cx, cy = V.centro_del_mapa(cdp)
        ruta = os.path.join(AQUI, f"mutacion-radio-z{z}.png")
        d, t0 = 0, time.time()
        while time.time() - t0 < 25:
            d = V.diametro_del_disco(cdp, cx, cy, ruta)
            if d > 0:
                break
            time.sleep(0.4)
        medido[z] = d
    previsto = {z: 2 * r_m / V.metros_por_pixel(lat, z) for z in (11, 13)}
    razon = medido[13] / medido[11] if medido[11] else 0
    pasa = (0.6 * previsto[11] < medido[11] < 1.6 * previsto[11] + 3
            and 0.6 * previsto[13] < medido[13] < 1.6 * previsto[13] + 3
            and 3.0 < razon < 5.2)
    return pasa, (f"z11 {medido[11]} px (prev {previsto[11]:.0f}) · "
                  f"z13 {medido[13]} px (prev {previsto[13]:.0f}) · razon {razon:.1f}")


def _abrir_ficha(cdp, url):
    man, fila = V.leer_fila()
    lat, lon = float(fila["lat"]), float(fila["lon"])
    ir(cdp, f"{url}?lat={lat:.6f}&lon={lon:.6f}&z=15")
    cx, cy = V.centro_del_mapa(cdp)
    t0 = time.time()
    while time.time() - t0 < 20 and not cdp.evaluar(V.FICHA_ABIERTA):
        V.clic(cdp, cx, cy)
        time.sleep(0.5)
    return lat, lon


def sonda_enlaces(cdp, url):
    _abrir_ficha(cdp, url)
    if not cdp.evaluar(V.FICHA_ABIERTA):
        return False, "no abrio la ficha"
    enlaces = json.loads(cdp.evaluar(
        "JSON.stringify([...document.querySelectorAll('.ficha-acciones a')]"
        ".map(a => a.getAttribute('href')))"))
    pasa = (len(enlaces) == 2
            and "google.com/maps/search/" in enlaces[0]
            and "earth.google.com/web/search/" in enlaces[1]
            and "/web/@" not in enlaces[1])
    return pasa, " · ".join(e.split("?")[0][:44] for e in enlaces)


def sonda_ficha_correcta(cdp, url):
    lat, lon = _abrir_ficha(cdp, url)
    if not cdp.evaluar(V.FICHA_ABIERTA):
        return False, "no abrio la ficha"
    coord = V.coord_de_la_ficha(cdp)
    cand, c_lat, c_lon, _ = V.puntos_bajo_el_clic(lat, lon, 15)
    if coord is None:
        return False, "sin coordenada"
    pasa = bool(np.any((np.abs(c_lat[cand] - coord[0]) < 1e-5)
                       & (np.abs(c_lon[cand] - coord[1]) < 1e-5)))
    return pasa, f"{len(cand)} discos cubren el pixel"


def sonda_tolerancia(cdp, url):
    hueco = V.punto_con_hueco(10)
    if not hueco:
        return False, "ningun punto con hueco alrededor"
    lat, lon, hah, r_pub, (nombre, sx, sy) = hueco
    r_dib = max(1.2, min(120.0, r_pub / V.metros_por_pixel(lat, 10)))
    desvio = r_dib + 2.5
    ir(cdp, f"{url}?lat={lat:.6f}&lon={lon:.6f}&z=10")
    cx, cy = V.centro_del_mapa(cdp)
    t0 = time.time()
    while time.time() - t0 < 12 and not cdp.evaluar(V.FICHA_ABIERTA):
        V.clic(cdp, cx + sx * desvio, cy + sy * desvio)
        time.sleep(0.5)
    coord = V.coord_de_la_ficha(cdp) if cdp.evaluar(V.FICHA_ABIERTA) else None
    pasa = coord is not None and abs(coord[0] - lat) < 1e-5 and abs(coord[1] - lon) < 1e-5
    return pasa, f"{desvio:.1f} px al {nombre} · devolvio {coord}"


def sonda_ancho(cdp, url):
    ir(cdp, url)
    panel = cdp.evaluar("document.querySelector('.panel').getBoundingClientRect().width")
    V.abrir_grupo(cdp, "Especie")
    modal = cdp.evaluar(
        "document.querySelector('dialog.modal-filtro[open]').getBoundingClientRect().width")
    V.cerrar_grupo(cdp)
    return abs(modal - panel) <= 1, f"panel {panel:.0f} px · modal {modal:.0f} px"


def sonda_datos(cdp, url):
    """Corre `ETL/verificar_datos.py` y exige que pase.

    ES LA SONDA DE UN DEFECTO DEL DATO, y por eso no mira el navegador. Se
    intento con la sonda de V-59 --las dieciseis regiones contra el manifest-- y
    salio VERDE con el defecto puesto, por dos razones que conviene dejar
    escritas:

      1. La columna de region hizo que el defecto original ya no se pueda
         reproducir por ese camino. El ambito regional ya no se deriva de las
         comunas, asi que aunque Los Rios pierda las suyas, sus 79.727 poligonos
         siguen contandose bien. Eso es el arreglo funcionando.
      2. Y lo que si queda roto --Los Rios sin desglose territorial-- es
         INVISIBLE para V-59: esa asercion compara el visor contra el manifest, y
         un defecto del ETL corrompe LOS DOS a la vez. Los dos coinciden en estar
         mal.

    Quien lo caza es D22 en el verificador de datos, que no compara el visor con
    el manifest sino el manifest CONSIGO MISMO. Lo mismo vale para D26: el
    solape de los discos se comprueba sobre el .bin publicado, no en pantalla.
    """
    r = subprocess.run([sys.executable, os.path.join(RAIZ, "ETL", "verificar_datos.py")],
                       cwd=RAIZ, capture_output=True, text=True)
    salida = (r.stdout + r.stderr)
    lineas = [x.strip() for x in salida.splitlines() if x.strip().startswith("- D")]
    return r.returncode == 0, (" · ".join(lineas) if lineas else "integridad OK")


def sonda_regiones(cdp, url):
    """Las dieciseis regiones contra el manifest, por la interfaz.

    Es la sonda de V-59, la asercion que habria cazado el defecto de Los Rios el
    primer dia. Se recorren las DIECISEIS y no una: quince cuadraban, asi que
    cualquier prueba sobre una region al azar tenia quince de dieciseis de pasar.
    """
    man = json.load(open(os.path.join(DIST, "datos", "manifest.json"), encoding="utf-8"))
    ir(cdp, url)
    malas = []
    for r in sorted(man["regiones"], key=lambda x: x["orden"]):
        V.abrir_grupo(cdp, "Territorio")
        cdp.evaluar("""
          (() => {
            const l = [...document.querySelectorAll('.mf-nivel')[0].querySelectorAll('.gf-opcion')]
              .find(x => x.querySelector('.gf-etq').childNodes[0].textContent.trim() === %s)
            l?.querySelector('input').click()
          })()
        """ % json.dumps(r["nombre"]))
        V.esperar(cdp, "document.querySelector('.cifra-etq')?.textContent.includes(%s)"
                  % json.dumps(r["nombre"]), segundos=40)
        etq = str(cdp.evaluar("document.querySelector('.cifra-etq')?.textContent") or "")
        V.cerrar_grupo(cdp)
        leido = int(re.sub(r"[^\d]", "", etq.split("polígonos")[0]) or -1)
        if leido != r["n"]:
            malas.append(f"{r['nombre']} {leido:,}!={r['n']:,}")
    return not malas, (" · ".join(malas) if malas else "16/16 cuadran")


def sonda_ambito_vacio(cdp, url):
    ir(cdp, url + "?reg=15&prov=Valdivia")
    V.esperar(cdp, "document.querySelector('.cifra-etq')?.textContent.includes('Valdivia')",
              segundos=40)
    etq = str(cdp.evaluar("document.querySelector('.cifra-etq')?.textContent") or "")
    return etq.startswith("0 polígonos"), etq


def sonda_homologacion(cdp, url):
    ir(cdp, url)

    def plano(x):
        x = unicodedata.normalize("NFKD", str(x))
        return re.sub(r"[^a-z0-9]", "",
                      "".join(c for c in x if not unicodedata.combining(c)).lower())
    problemas = []
    for titulo, cuantas in (("SNASPE", 90), ("Subtipo", 33)):
        g = V.grupo_filtro(cdp, titulo)
        total = int(re.sub(r"[^\d]", "", g["total"]) or -1)
        vistos = {}
        for f in g["filas"]:
            vistos.setdefault(plano(f["etq"]), []).append(f["etq"])
        if total != cuantas or any(len(v) > 1 for v in vistos.values()):
            problemas.append(f"{titulo}={total}")
    return not problemas, (" · ".join(problemas) if problemas else "90 y 33, sin colapsos")


def sonda_alias(cdp, url):
    man = json.load(open(os.path.join(DIST, "datos", "manifest.json"), encoding="utf-8"))
    viejo = next(iter(man.get("alias", {}).get("snaspe", {})), None)
    if not viejo:
        return False, "el manifest no publica alias"
    nuevo = man["alias"]["snaspe"][viejo]
    esperado = next(u["n"] for u in man["snaspe"] if u["cod"] == nuevo)
    ir(cdp, f"{url}?snaspe={requests.utils.quote(viejo)}")
    V.esperar(cdp, "document.querySelector('.cifra-num b')?.textContent !== '75,7'", segundos=40)
    etq = str(cdp.evaluar("document.querySelector('.cifra-etq')?.textContent") or "")
    leido = int(re.sub(r"[^\d]", "", etq.split("polígonos")[0]) or -1)
    return leido == esperado, f"{viejo!r} -> {leido:,} (esperado {esperado:,})"


def sonda_panel_limpio(cdp, url):
    """El panel no tiene prosa y cierra con los tres botones."""
    ir(cdp, url)
    prosa = cdp.evaluar(
        "document.querySelectorAll("
        "'.panel > section > p, .panel > footer, .panel > section > .nota'"
        ").length")
    acciones = json.loads(cdp.evaluar(
        "JSON.stringify([...document.querySelectorAll('.filtro-botonera.tres .gf-titulo')]"
        ".map(e => e.textContent))"))
    pasa = prosa == 0 and acciones == ["Información", "Descargar", "Compartir"]
    return pasa, f"{prosa} parrafos sueltos · {' | '.join(acciones)}"


def sonda_informacion(cdp, url):
    """Informacion trae la prosa del panel Y la Metodologia entera."""
    ir(cdp, url)
    V.abrir_grupo(cdp, "Información")
    texto = str(cdp.evaluar(
        "document.querySelector('.modal-filtro .mf-cuerpo')?.innerText") or "")
    h3 = json.loads(cdp.evaluar(
        "JSON.stringify([...document.querySelectorAll('.modal-filtro .mf-cuerpo h3')]"
        ".map(e => e.textContent))"))
    met = cdp.evaluar("!!document.querySelector('.modal-filtro .met-cuerpo')")
    V.cerrar_grupo(cdp)
    pasa = (len(texto) > 6000 and met
            and "Qué cuenta el Catastro como bosque" in h3
            and any("tamaño de los puntos" in x for x in h3))
    return pasa, f"{len(texto)} caracteres · {len(h3)} apartados · metodologia: {met}"


def sonda_compartir(cdp, url):
    ir(cdp, url + "?reg=10")
    V.abrir_grupo(cdp, "Compartir")
    enlace = str(cdp.evaluar(
        "document.querySelector('.modal-filtro input[readonly]')?.value") or "")
    aviso = str(cdp.evaluar(
        "document.querySelector('.modal-filtro .nota')?.textContent") or "")
    V.cerrar_grupo(cdp)
    return ("reg=10" in enlace and "no son las nacionales" in aviso), enlace[-52:]


def sonda_tres_nuevas(cdp, url):
    """Proteccion, tamano y ano existen, reparten TODO y filtran de verdad.

    Se exige que cada una sume las 1.827.933 filas: ninguna tiene centinela, asi
    que una fila fuera de toda clase significa que la derivacion se dejo casos.
    Y que MUEVAN la cifra, porque una lista con clases y cifras plausibles que no
    filtra nada pasa cualquier prueba de presencia.
    """
    man = json.load(open(os.path.join(DIST, "datos", "manifest.json"), encoding="utf-8"))
    ir(cdp, url)
    problemas = []
    for titulo, clave in (("Protección", "protecciones"), ("Tamaño", "tamanos"),
                          ("Año", "anios")):
        dom = man.get(clave, [])
        if not dom or sum(d["n"] for d in dom) != man["total"]["filas"]:
            problemas.append(f"{titulo}: reparte {sum(d['n'] for d in dom):,}")
            continue
        g = V.grupo_filtro(cdp, titulo)
        if not g or not g["filas"]:
            problemas.append(f"{titulo}: sin clases")
            continue
        antes = cdp.evaluar("document.querySelector('.cifra-num b').textContent")
        V.marcar_clase(cdp, titulo, g["filas"][0]["etq"])
        movio = V.esperar(cdp, "document.querySelector('.cifra-num b').textContent !== %r"
                          % antes, segundos=30)
        if movio is None:
            problemas.append(f"{titulo}: no mueve la cifra")
        cdp.evaluar("[...document.querySelectorAll('.limpiar')]"
                    ".find(b => /Quitar/.test(b.textContent))?.click()")
        V.esperar(cdp, "document.querySelector('.cifra-num b').textContent === %r" % antes,
                  segundos=30)
    return not problemas, (" · ".join(problemas) if problemas
                           else "protección, tamaño y año reparten todo y filtran")


def sonda_reporte(cdp, url):
    ir(cdp, url + "?reg=10")
    titular = cdp.evaluar("document.querySelector('.cifra-num b').textContent")
    # El reporte vive dentro del modal de Descargar desde que el panel se quedo
    # sin prosa.
    V.abrir_grupo(cdp, "Descargar")
    cdp.evaluar("[...document.querySelectorAll('.modal-filtro button')]"
                ".find(b => /Reporte del/.test(b.textContent))?.click()")
    abrio = V.esperar(cdp, "!!document.querySelector('.reporte-doc')", segundos=20)
    texto = str(cdp.evaluar("document.querySelector('.reporte-doc')?.innerText") or "")
    secciones = json.loads(cdp.evaluar(
        "JSON.stringify([...document.querySelectorAll('.reporte-doc h2')].map(h => h.textContent))"))
    tablas = json.loads(cdp.evaluar(
        "JSON.stringify([...document.querySelectorAll('.reporte-doc table')]"
        ".map(t => t.querySelectorAll('tbody tr').length))"))
    pasa = (abrio is not None and len(texto) > 6000 and len(secciones) >= 10
            and "Los Lagos" in texto and str(titular) in texto
            and len(tablas) >= 9 and all(t > 0 for t in tablas))
    return pasa, f"{len(texto)} caracteres · {len(secciones)} secciones · {len(tablas)} tablas"


def sonda_mapa_del_reporte(cdp, url):
    """La lamina del mapa del reporte trae contenido de verdad.

    Se DECODIFICA la imagen y se cuentan pixeles contra el color mas repetido.
    Mirar que exista el <img> no serviria: un lienzo WebGL sin
    preserveDrawingBuffer devuelve un PNG valido y completamente transparente
    sin lanzar nada --medido: 18 KB y cero pixeles-- y el reporte imprimiria un
    recuadro en blanco con identidad institucional encima.
    """
    ir(cdp, url + "?reg=10")
    V.abrir_grupo(cdp, "Descargar")
    cdp.evaluar("[...document.querySelectorAll('.modal-filtro button')]"
                ".find(b => /Reporte del/.test(b.textContent))?.click()")
    V.esperar(cdp, "!!document.querySelector('.reporte-doc')", segundos=25)
    src = str(cdp.evaluar("document.querySelector('.rep-mapa img')?.src") or "")
    if not src.startswith("data:image/png;base64,"):
        return False, "no hay lamina en el reporte"
    ruta = os.path.join(AQUI, "mutacion-mapa-reporte.png")
    with open(ruta, "wb") as fh:
        fh.write(base64.b64decode(src.split(",", 1)[1]))
    im = np.array(Image.open(ruta).convert("RGB"))
    vals, cuentas = np.unique(im.reshape(-1, 3), axis=0, return_counts=True)
    frac = float((np.abs(im - vals[cuentas.argmax()]).sum(axis=2) > 20).mean())
    return frac > 0.002, f"{len(src):,} B · {frac:.1%} con contenido"


def sonda_impresion(cdp, url):
    ir(cdp, url + "?reg=10")
    # El reporte vive dentro del modal de Descargar desde que el panel se quedo
    # sin prosa.
    V.abrir_grupo(cdp, "Descargar")
    cdp.evaluar("[...document.querySelectorAll('.modal-filtro button')]"
                ".find(b => /Reporte del/.test(b.textContent))?.click()")
    V.esperar(cdp, "!!document.querySelector('.reporte-doc')", segundos=20)
    cdp.enviar("Emulation.setEmulatedMedia", media="print")
    time.sleep(0.7)
    f = json.loads(cdp.evaluar(
        "JSON.stringify({"
        "  mapa: !!document.querySelector('.mapa')?.offsetParent,"
        "  panel: !!document.querySelector('.panel')?.offsetParent,"
        "  barra: !!document.querySelector('.reporte-barra')?.offsetParent,"
        "  doc: !!document.querySelector('.reporte-doc')?.offsetParent})"))
    cdp.enviar("Emulation.setEmulatedMedia", media="")
    return (f["doc"] and not f["mapa"] and not f["panel"] and not f["barra"]), json.dumps(f)


# ------------------------------------------------------------------ las mutaciones
JSX = os.path.join(FRONTEND, "src", "components")
CAPA = os.path.join(FRONTEND, "src", "mapa", "CapaPuntos.jsx")
CSS = os.path.join(FRONTEND, "src", "App.css")

# (nombre, sonda, [(archivo, de, a), ...])
MUTACIONES = [
    ("V-54 · getRadius vuelve a ser prop de la capa (EL defecto original)",
     sonda_radio,
     [(CAPA, "          getRadius: { value: radio, size: 1 },\n", ""),
      (CAPA, "      radiusUnits: 'meters',",
             "      getRadius: { value: radio, size: 1 },\n      radiusUnits: 'meters',")]),

    ("V-54 · el radio vuelve a estar en pixeles",
     sonda_radio,
     [(CAPA, "      radiusUnits: 'meters',", "      radiusUnits: 'pixels',")]),

    ("V-45 · Territorio vuelve a ser un <select>",
     sonda_botones,
     [(os.path.join(JSX, "PanelLateral.jsx"),
       '          <BotonControl\n            col="territorio"',
       '          <select><option>Todo Chile</option></select>\n          <BotonControl\n            col="territorio-x"')]),

    # Se quita TAMBIEN el `margin: 0`. Dejandolo puesto, la hoja del navegador
    # aporta `inset: 0` y el dialogo se pega a la esquina superior izquierda:
    # x=0, que es lo que la sonda pide, con el modal mal colocado igual. La
    # mutacion tiene que dejar el dialogo como lo dejaria borrar el bloque.
    ("V-51 · el modal se queda centrado (sin position+inset+margin)",
     sonda_anclaje,
     [(CSS, "  position: fixed;\n  inset: var(--alto-banner) auto 0 0;\n  margin: 0;\n", "")]),

    ("V-51 · vuelve el velo opaco sobre el mapa",
     sonda_anclaje,
     [(CSS, ".modal-filtro::backdrop { background: transparent; }",
            ".modal-filtro::backdrop { background: rgba(0, 0, 0, 0.55); }")]),

    ("V-34 · el modal de Uso oculta clases sin declararlas",
     sonda_uso,
     [(os.path.join(JSX, "GrupoFiltro.jsx"),
       "      {sinCoincidencias > 0 && (", "      {false && (")]),

    ("V-42/V-52 · el boton de Territorio deja de rotular lo elegido",
     sonda_territorio,
     [(os.path.join(JSX, "GrupoFiltro.jsx"),
       "      {valor && <span className=\"gf-valor\">{valor}</span>}", "")]),

    ("V-53 · las filas del mapa base pierden su advertencia",
     sonda_base,
     [(os.path.join(JSX, "ControlesPanel.jsx"),
       "                {BASEMAPS[k].nota && <em className=\"gf-sub\">{BASEMAPS[k].nota}</em>}", "")]),

    ("V-56 · Earth vuelve a la URL de camara, sin marcador",
     sonda_enlaces,
     [(os.path.join(JSX, "ModalFicha.jsx"),
       "https://earth.google.com/web/search/${ficha.coord[0]},${ficha.coord[1]}",
       "https://earth.google.com/web/@${ficha.coord[0]},${ficha.coord[1]},0a,1200d,35y,0h,0t,0r")]),

    ("V-23 · la ficha se arma con el indice equivocado",
     sonda_ficha_correcta,
     [(CAPA, "      if (info && info.index >= 0) onPunto?.(info.index)",
             "      if (info && info.index >= 0) onPunto?.(info.index + 1)")]),

    ("V-22b · el picking pierde su tolerancia",
     sonda_tolerancia,
     [(CAPA, "      const info = picar(e.containerPoint.x, e.containerPoint.y, 6)",
             "      const info = picar(e.containerPoint.x, e.containerPoint.y, 0)")]),

    ("V-58 · el modal vuelve a ser mas ancho que el panel",
     sonda_ancho,
     [(CSS, "  width: min(max(var(--pista-panel, var(--ancho-panel)), 320px), calc(100vw - 32px));",
            "  width: min(560px, calc(100vw - 32px));"),
      (os.path.join(FRONTEND, "src", "config.js"),
       "export const ANCHO_PANEL = MAX_PANEL", "export const ANCHO_PANEL = 320")]),

    ("V-57c · una tabla del reporte se queda sin filas",
     sonda_reporte,
     [(os.path.join(JSX, "Reporte.jsx"),
       "filas={[...resumen.coberturas]",
       "filas={[] || [...resumen.coberturas]")]),

    # --- el radio recortado y el panel limpio --------------------------------
    ("D26 · el ETL deja de recortar el radio por el vecino",
     sonda_datos,
     [(os.path.join(RAIZ, "ETL", "build_bin.py"),
       "    radio = np.floor(np.minimum(r_area, dist[:, 1] / 2.0)).astype(np.uint16)",
       "    radio = np.floor(r_area).astype(np.uint16)")],
     True),

    # El reverso: recortar de mas cumple D26 de forma perfecta y deja el mapa en
    # blanco. Sin D26b, «que no se superpongan» se satisface borrandolos.
    ("D26b · el recorte se come los discos (al 5 % en vez de a la mitad)",
     sonda_datos,
     [(os.path.join(RAIZ, "ETL", "build_bin.py"),
       "    radio = np.floor(np.minimum(r_area, dist[:, 1] / 2.0)).astype(np.uint16)",
       "    radio = np.floor(np.minimum(r_area, dist[:, 1] / 2.0) * 0.05).astype(np.uint16)")],
     True),

    ("V-50 · vuelve una nota suelta al panel",
     sonda_panel_limpio,
     [(os.path.join(JSX, "PanelLateral.jsx"),
       "      <section>\n        <h2>Mapa base</h2>",
       "      <section>\n        <h2>Mapa base</h2>\n"
       "        <p className=\"nota\">Una nota que no deberia estar aqui.</p>")]),

    ("V-65 · Informacion se queda sin la Metodologia",
     sonda_informacion,
     [(os.path.join(JSX, "ModalesPanel.jsx"),
       '      <div className="met-cuerpo">{metodologia}</div>', "")]),

    ("V-66 · Compartir deja de ensenar el enlace",
     sonda_compartir,
     [(os.path.join(JSX, "ModalesPanel.jsx"),
       '        <input type="text" readOnly value={url} onFocus={(e) => e.target.select()} />',
       '        <input type="text" readOnly value="" />')]),

    # --- las cuatro del arreglo de datos -------------------------------------
    # La primera rompe el DATO y no el codigo: hay que regenerar el .bin, y por
    # eso lleva el cuarto elemento en True. Sin esto no se podria ver roja la
    # asercion que mas importa de todo el arnes.
    ("D22 · el ETL vuelve a leer solo CODCOM (Los Rios sin comunas)",
     sonda_datos,
     [(os.path.join(RAIZ, "ETL", "build_bin.py"),
       "ID_TIFO AS c_tif, COALESCE(CODCOM, Codcomun) AS c_com",
       "ID_TIFO AS c_tif, CODCOM AS c_com"),
      (os.path.join(RAIZ, "ETL", "build_bin.py"),
       "        WHERE COALESCE(CODCOM, Codcomun) IS NOT NULL AND centroide_lon IS NOT NULL",
       "        WHERE CODCOM IS NOT NULL AND centroide_lon IS NOT NULL")],
     True),

    # V-59 protege que el VISOR no se separe del manifest. Su defecto propio no
    # es de datos sino de codigo: que el ambito deje de entrar en el filtro.
    ("V-59 · el ambito regional deja de aplicarse",
     sonda_regiones,
     [(os.path.join(FRONTEND, "src", "App.jsx"),
       "    if (filtroAmbito) Object.assign(f, filtroAmbito)",
       "    if (filtroAmbito?.comuna?.size) Object.assign(f, filtroAmbito)")]),

    ("V-60 · un conjunto vacio vuelve a significar «todas»",
     sonda_ambito_vacio,
     [(os.path.join(FRONTEND, "src", "indicadores.js"),
       "    if (!d.columna || !sel) continue",
       "    if (!d.columna || !sel || sel.size === 0) continue")]),

    ("V-61 · se deshace una fusion de subtipo forestal",
     sonda_homologacion,
     [(os.path.join(RAIZ, "ETL", "homologacion", "05_subtipo_forestal.csv"),
       "Roble - Hualo,Roble-Hualo,fusion", "Roble - Hualo,Roble - Hualo,sin_cambio")],
     True),

    ("V-62 · filtrosDesdeURL deja de consultar el mapa de alias",
     sonda_alias,
     [(os.path.join(FRONTEND, "src", "filtros.js"),
       "      const buscado = alias[cod] ?? cod", "      const buscado = cod")]),

    # Las tres nuevas. La primera rompe el DATO --el reparto deja de cubrir todas
    # las filas-- y por eso regenera el .bin.
    # Esta mutacion paso en VERDE la primera vez, y el hallazgo fue del ETL: las
    # filas fuera de todo tramo caian en silencio en la primera clase. Ahora el
    # ETL revienta al construir --que es enterarse, y antes-- y D27 comprueba
    # ademas que las hectareas de cada tramo quepan entre sus cortes.
    ("D27 · el tramo de superficie deja fuera los poligonos grandes",
     sonda_datos,
     [(os.path.join(RAIZ, "ETL", "build_bin.py"),
       '    (500.0, float("inf"), "500 ha o más"),',
       '    (500.0, 10000.0, "500 ha o más"),')],
     True),

    ("V-63 · proteccion mira el centinela al reves",
     sonda_tres_nuevas,
     [(os.path.join(FRONTEND, "src", "datos", "derivadas.js"),
       "for (let i = 0; i < n; i++) col[i] = datos.snaspe[i] === centinela ? fuera : dentro",
       "for (let i = 0; i < n; i++) col[i] = dentro")]),

    ("V-57d · el lienzo de deck deja de conservar su bufer",
     sonda_mapa_del_reporte,
     [(os.path.join(FRONTEND, "src", "mapa", "CapaPuntos.jsx"),
       "deviceProps: { webgl: { preserveDrawingBuffer: true } },",
       "deviceProps: { webgl: { preserveDrawingBuffer: false } },")]),

    ("V-57 · el reporte deja de nombrar el ambito que imprime",
     sonda_reporte,
     [(os.path.join(JSX, "Reporte.jsx"),
       "  const ambitoTxt = ambitoTexto(ambito, manifest)",
       "  const ambitoTxt = 'Chile'")]),

    ("V-57b · al imprimir sale tambien el mapa",
     sonda_impresion,
     [(CSS, "  .app > *:not(.reporte-vista) { display: none !important; }", "")]),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--solo", default=None, help="corre solo las mutaciones cuyo nombre contenga esto")
    args = ap.parse_args()

    casos = [m for m in MUTACIONES if not args.solo or args.solo.lower() in m[0].lower()]
    if not casos:
        sys.exit("ninguna mutacion coincide con --solo")

    archivos = sorted({a for c in casos for a, _, _ in c[2]})
    respaldo = {a: tempfile.mktemp(suffix=".bak") for a in archivos}
    for a, b in respaldo.items():
        shutil.copy2(a, b)

    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Manejador, directory=DIST))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_address[1]}{BASE}"

    fallos = []
    try:
        # CONTROL POSITIVO: en limpio, cada sonda tiene que salir VERDE. Si una
        # ya sale roja sin mutar nada, lo que esta mal es la sonda y todo lo que
        # venga detras seria un falso «la mutacion se caza».
        print("=== control positivo: sin mutar, todas las sondas en verde\n")
        compilar()
        proc, perfil, cdp = abrir(url)
        try:
            for caso in casos:
                nombre, sonda = caso[0], caso[1]
                pasa, det = sonda(cdp, url)
                print(f"  {'OK   ' if pasa else 'FALLA'}  {nombre.split(' · ')[0]:<8} {det}")
                if not pasa:
                    fallos.append(f"control positivo: {nombre}")
        finally:
            proc.kill()
            shutil.rmtree(perfil, ignore_errors=True)

        print("\n=== cada defecto DEBE poner roja su asercion\n")
        for caso in casos:
            nombre, sonda, ediciones = caso[0], caso[1], caso[2]
            toca_datos = len(caso) > 3 and caso[3]
            for archivo, de, a in ediciones:
                if not de.strip():
                    continue
                texto = open(archivo, encoding="utf-8").read()
                if de not in texto:
                    fallos.append(f"no se pudo mutar: {nombre}")
                    print(f"  SIN MUTAR  {nombre}\n             no encaja: {de.strip()[:70]}")
                    break
                open(archivo, "w", encoding="utf-8").write(texto.replace(de, a, 1))
            else:
                try:
                    construir_datos() if toca_datos else compilar()
                    proc, perfil, cdp = abrir(url)
                    try:
                        pasa, det = sonda(cdp, url)
                    finally:
                        proc.kill()
                        shutil.rmtree(perfil, ignore_errors=True)
                    print(f"  {'ROJA, correcto' if not pasa else 'VERDE - LA PRUEBA NO PROTEGE'}"
                          f"   {nombre}\n             {det}")
                    if pasa:
                        fallos.append(nombre)
                except RuntimeError as e:
                    # Que no compile TAMBIEN es enterarse: el defecto no llega a
                    # publicarse. Se dice cual, para no confundirlo con la sonda.
                    print(f"  ROJA (no compila)   {nombre}\n             {str(e)[:120]}")
            for archivo, _, _ in ediciones:
                shutil.copy2(respaldo[archivo], archivo)
            if toca_datos:
                construir_datos()
    finally:
        for a, b in respaldo.items():
            shutil.copy2(b, a)
            os.unlink(b)
        compilar()

    print("\n" + "=" * 62)
    print(f"  {'TODO EN VERDE' if not fallos else str(len(fallos)) + ' SIN PROTECCION'}")
    print("=" * 62)
    for f in fallos:
        print("   ·", f)
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
