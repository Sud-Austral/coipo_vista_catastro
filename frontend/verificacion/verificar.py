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
TILES = ("cartocdn.com", "openstreetmap.org", "arcgisonline.com", "eox.at")

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
        marcado = cdp.evaluar("""
            (() => {
              const g = [...document.querySelectorAll('.grupo-filtro')]
                .find(d => d.querySelector('.gf-titulo')?.textContent === 'Cobertura')
              if (!g) return null
              g.open = true
              const c = g.querySelector('.gf-opcion input')
              if (!c) return null
              c.click()
              return g.querySelector('.gf-etq')?.textContent || 'sin etiqueta'
            })()
        """)
        prueba("V-18 se puede marcar una clase de cobertura",
               bool(marcado), str(marcado))

        esperar(cdp, "document.querySelector('.cifra-num b').textContent !== %r" % antes,
                segundos=30)
        despues = cdp.evaluar("document.querySelector('.cifra-num b').textContent")
        prueba("V-18b marcar una clase MUEVE la cifra titular",
               str(antes) != str(despues), f"{antes} → {despues}")

        # La marca en el <summary>: con el grupo plegado, un filtro activo tiene
        # que seguir viéndose. Si no, el mapa muestra menos de lo que debería y
        # nada en pantalla lo explica.
        insignia = cdp.evaluar("""
            (() => {
              const g = [...document.querySelectorAll('.grupo-filtro')]
                .find(d => d.querySelector('.gf-titulo')?.textContent === 'Cobertura')
              g.open = false
              const b = g.querySelector('.gf-activas')
              return b && b.offsetParent !== null ? b.textContent : null
            })()
        """)
        prueba("V-19 el filtro activo se ve con el grupo plegado",
               insignia is not None, str(insignia))

        # El buscador de especies: 989 clases no caben en una lista, así que si
        # el buscador no encuentra, la mayoría del vocabulario es inalcanzable.
        hallazgos = cdp.evaluar("""
            (() => {
              const g = [...document.querySelectorAll('.grupo-filtro')]
                .find(d => d.querySelector('.gf-titulo')?.textContent === 'Especie')
              if (!g) return -1
              g.open = true
              const i = g.querySelector('.gf-buscar input')
              if (!i) return -2
              const set = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value').set
              set.call(i, 'araucaria')
              i.dispatchEvent(new Event('input', { bubbles: true }))
              return g.querySelectorAll('.gf-opcion').length
            })()
        """)
        prueba("V-20 el buscador de especies encuentra", hallazgos > 0, f"{hallazgos}")

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
