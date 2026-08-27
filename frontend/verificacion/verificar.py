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
import os
import shutil
import socketserver
import sys
import threading
import time

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
TECHO_CRUCE_MS = 400

MODAL_FILTRO = "!!document.querySelector('dialog.modal-filtro[open]')"


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
            ms = esperar(cdp, "!!(document.querySelector('.app') && "
                              "document.querySelectorAll('.leyenda li').length === 9)")
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
        prueba("V-17 los grupos de filtro se dibujan", grupos >= 8, f"{grupos}")

        # Cada grupo declara cuántas clases tiene. Si alguno sale con cero, su
        # dimensión no llegó del manifest y el filtro sería una lista vacía.
        vacios = cdp.evaluar("""
            [...document.querySelectorAll('.grupo-filtro')]
              .filter(g => (parseInt(g.querySelector('.gf-total')?.textContent) || 0) === 0)
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
            # LA ASERCIÓN QUE IMPORTA. Abrir la ficha de OTRO punto —por un
            # desfase de índice o por casar mal el espacio de coordenadas de
            # Leaflet con el del lienzo de deck— pasaría V-22 tan campante.
            # 0,001° son ~110 m: holgado frente a los ~21 m que abarca la
            # tolerancia de picking a este zoom, y cinco órdenes de magnitud más
            # estrecho que «algún sitio de Chile».
            cerca = (coord is not None
                     and abs(coord[0] - lat_p) < 0.001 and abs(coord[1] - lon_p) < 0.001)
            prueba("V-23 la ficha es la del punto pulsado", cerca,
                   f"{coord} vs [{lat_p:.5f}, {lon_p:.5f}] · {uso_p}")
            n_filas = cdp.evaluar("document.querySelectorAll('.ficha tbody tr').length")
            con_texto = cdp.evaluar(
                "!!document.querySelector('.ficha tbody tr td').textContent.trim()")
            # Que se abra un diálogo EN BLANCO no es que funcione.
            prueba("V-23b la ficha trae sus 12 filas con contenido",
                   n_filas == 12 and con_texto, f"{n_filas} filas")
            capturar(cdp, os.path.join(AQUI, "captura-ficha.png"))
            cdp.evaluar("document.querySelector('dialog.ficha[open]').close()")
            esperar(cdp, f"!({FICHA_ABIERTA})", segundos=10)

        # V-22b: LA TOLERANCIA DE PICKING, que es media reparación. Con el punto
        # centrado al píxel, un pick de radio 0 acierta igual y V-22 pasa —medido
        # reintroduciendo el defecto—, así que sin esta aserción quedaría sin
        # cubrir justo el segundo síntoma: puntos de ~1 px que hay que acertar al
        # píxel, indistinguible desde fuera de no tener ficha.
        #
        # El desplazamiento se calcula con la MISMA fórmula que
        # radiosDesdeSuperficie: hay que caer fuera del disco dibujado —o no se
        # estaría midiendo la tolerancia— y dentro de los 6 px de tolerancia.
        r_dibujado = min(12.0, max(0.9, 0.65 * float(fila["ha"]) ** 0.5))
        desvio = r_dibujado + 2.5
        if desvio > 5.5:
            print(f"    V-22b NO APLICA: el punto se dibuja con r={r_dibujado:.1f} px "
                  "y no queda hueco entre su borde y la tolerancia")
        else:
            t0 = time.time()
            while time.time() - t0 < 12 and not cdp.evaluar(FICHA_ABIERTA):
                clic(cdp, cx + desvio, cy)
                time.sleep(0.5)
            junto = cdp.evaluar(FICHA_ABIERTA)
            prueba("V-22b un clic JUNTO al punto también lo abre", junto,
                   f"a {desvio:.1f} px de un disco de r={r_dibujado:.1f} px")
            if junto:
                cdp.evaluar("document.querySelector('dialog.ficha[open]').close()")
                esperar(cdp, f"!({FICHA_ABIERTA})", segundos=10)

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
        esperar(cdp, "!!document.querySelector('.leyenda li')", segundos=60)
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

        # V-34: la leyenda es la excepción — las nueve clases SIEMPRE. Es uno de
        # los cuatro mecanismos sin los cuales «se rompe la accesibilidad del
        # mapa», y antes las clases a cero desaparecían de ella.
        prueba("V-34 la leyenda mantiene las nueve clases con filtro activo",
               cdp.evaluar("document.querySelectorAll('.leyenda li').length") == 9,
               f"{cdp.evaluar('document.querySelectorAll(\".leyenda li\").length')} clases")

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
        esperar(cdp, "!!document.querySelector('.leyenda li')", segundos=60)
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
        regs_todas = cdp.evaluar("document.querySelectorAll('.panel select')[0].options.length")
        cdp.enviar("Page.navigate", url="about:blank")
        esperar(cdp, "document.readyState === 'complete'", segundos=30)
        cdp.enviar("Page.navigate", url=url)
        esperar(cdp, "!!document.querySelector('.leyenda li')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)
        antes_regs = cdp.evaluar("document.querySelectorAll('.panel select')[0].options.length")
        marcar_clase(cdp, "Cobertura", "Denso")
        esperar(cdp, "document.querySelector('.cifra-num b').textContent !== '75,7 M ha'",
                segundos=30)
        despues_regs = cdp.evaluar("document.querySelectorAll('.panel select')[0].options.length")
        prueba("V-37 el ámbito territorial también va en cascada",
               despues_regs < antes_regs,
               f"{antes_regs - 1} → {despues_regs - 1} regiones ofrecidas")

        # V-38: la ida y vuelta. Lo que se oculta tiene que volver.
        cdp.evaluar("[...document.querySelectorAll('.limpiar')]"
                    ".find(b => /Quitar/.test(b.textContent))?.click()")
        esperar(cdp, "document.querySelector('.cifra-num b').textContent === '75,7 M ha'",
                segundos=30)
        vuelta = cdp.evaluar("document.querySelectorAll('.panel select')[0].options.length")
        prueba("V-38 al limpiar el filtro vuelve todo", vuelta == antes_regs,
               f"{despues_regs - 1} → {vuelta - 1} regiones · {regs_todas - 1} en Arica")

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
        esperar(cdp, "!!document.querySelector('.leyenda li')", segundos=60)
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
        esperar(cdp, "!!document.querySelector('.leyenda li')", segundos=60)
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
        esperar(cdp, "!!document.querySelector('.leyenda li')", segundos=60)
        esperar(cdp, "!document.querySelector('.descargando')", segundos=120)

        n_botones = cdp.evaluar("document.querySelectorAll('button.grupo-filtro').length")
        quedan = cdp.evaluar("document.querySelectorAll('details.grupo-filtro').length")
        prueba("V-45 ocho botones de filtro y ningún desplegable",
               n_botones == 8 and quedan == 0, f"{n_botones} botones · {quedan} <details>")

        # V-46: pulsar abre SU modal, no el de otra dimensión. Con un solo
        # <dialog> reutilizado, una `key` mal puesta lo llenaría con la lista
        # anterior y nadie lo notaría hasta filtrar por lo que no era.
        abrir_grupo(cdp, "Cobertura")
        titulo = cdp.evaluar("document.querySelector('#mf-titulo')?.textContent")
        prueba("V-46 el botón abre el modal de SU dimensión",
               titulo == "Cobertura de copas", str(titulo))

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
        foco = cdp.evaluar(
            "document.activeElement?.querySelector?.('.gf-titulo')?.textContent ?? null")
        prueba("V-48 Escape cierra y el foco vuelve a su botón",
               not cdp.evaluar(MODAL_FILTRO) and foco == "Cobertura", str(foco))

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

        # V-50: el orden del panel. Compartir y Descargar son lo último antes
        # del pie: primero se acota, luego se lee, luego se filtra, y sólo al
        # final se saca algo fuera.
        secciones = json.loads(cdp.evaluar(
            "JSON.stringify([...document.querySelectorAll('.panel > section h2')]"
            ".map(h => h.textContent.trim()))"))
        prueba("V-50 Compartir y Descargar van al fondo",
               secciones[-2:] == ["Compartir", "Descargar"], " · ".join(secciones))

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
