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
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time

import numpy as np
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
    pasa = n == 11 and sel == 0 and {"Territorio", "Uso", "Imagen de fondo"} <= set(tit)
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
    lat, lon, hah = aislado
    r_m = (hah * 10000 / math.pi) ** 0.5
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
    lat, lon, hah, (nombre, sx, sy) = hueco
    r_dib = max(1.2, min(120.0, ((hah * 10000 / math.pi) ** 0.5) / V.metros_por_pixel(lat, 10)))
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


def sonda_reporte(cdp, url):
    ir(cdp, url + "?reg=10")
    titular = cdp.evaluar("document.querySelector('.cifra-num b').textContent")
    cdp.evaluar("[...document.querySelectorAll('.panel button')]"
                ".find(b => /Reporte del/.test(b.textContent))?.click()")
    abrio = V.esperar(cdp, "!!document.querySelector('.reporte-doc')", segundos=20)
    texto = str(cdp.evaluar("document.querySelector('.reporte-doc')?.innerText") or "")
    secciones = json.loads(cdp.evaluar(
        "JSON.stringify([...document.querySelectorAll('.reporte-doc h2')].map(h => h.textContent))"))
    pasa = (abrio is not None and len(texto) > 1500 and len(secciones) >= 4
            and "Los Lagos" in texto and str(titular) in texto)
    return pasa, f"{len(texto)} caracteres · {len(secciones)} secciones"


def sonda_impresion(cdp, url):
    ir(cdp, url + "?reg=10")
    cdp.evaluar("[...document.querySelectorAll('.panel button')]"
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

    archivos = sorted({a for _, _, ed in casos for a, _, _ in ed})
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
            for nombre, sonda, _ in casos:
                pasa, det = sonda(cdp, url)
                print(f"  {'OK   ' if pasa else 'FALLA'}  {nombre.split(' · ')[0]:<8} {det}")
                if not pasa:
                    fallos.append(f"control positivo: {nombre}")
        finally:
            proc.kill()
            shutil.rmtree(perfil, ignore_errors=True)

        print("\n=== cada defecto DEBE poner roja su asercion\n")
        for nombre, sonda, ediciones in casos:
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
                    compilar()
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
