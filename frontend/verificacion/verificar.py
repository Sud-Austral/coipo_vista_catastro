"""Verifica el sitio COMPILADO, sirviendolo bajo el mismo subpath que Pages.

Sirve frontend/dist en /coipo_vista_catastro/ -- no en la raiz-- porque servirlo
en la raiz enmascara justo el defecto mas caro de este stack: un `base` mal
resuelto funciona en la raiz y rompe publicado.

Bloquea la red hacia los proveedores de teselas: la verificacion no debe
depender de un tercero ni salir a internet, y ademas un mapa base claro
falsearia el conteo de pixeles del dato.

Uso:  python frontend/verificacion/verificar.py [--ver]
"""

import argparse
import base64
import functools
import http.server
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
# Hosts de teselas y del servicio de metadatos de Esri. Con comodin a proposito:
# escritos literales, un cambio de host en config.js dejaria la verificacion
# saliendo a la red sin que nadie se entere.
TILES = ("cartocdn.com", "openstreetmap.org", "arcgisonline.com", "eox.at")
FONDO = (0xF2, 0xF3, 0xF0)   # --superficie-2, el fondo del contenedor Leaflet


class Manejador(http.server.SimpleHTTPRequestHandler):
    """Sirve dist bajo BASE, como hace Pages con un repo de proyecto."""

    def translate_path(self, path):
        p = path.split("?", 1)[0].split("#", 1)[0]
        if not p.startswith(BASE):
            self.ruta_fuera = True
            return os.path.join(DIST, "__404__")
        return super().translate_path(p[len(BASE) - 1:])

    def log_message(self, *a):
        pass


def servir():
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Manejador, directory=DIST))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


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
            sys.exit("no aparecio la pestana")

        cdp = Cdp(destino["webSocketDebuggerUrl"])
        cdp.enviar("Runtime.enable")
        cdp.enviar("Log.enable")
        cdp.enviar("Network.enable")
        cdp.enviar("Network.setBlockedURLs", urls=[f"*{h}*" for h in TILES])
        cdp.enviar("Page.enable")
        cdp.enviar("Page.reload", ignoreCache=True)

        # Se espera una CONDICION, no un reloj: dormir un tiempo fijo parece de
        # sobra hasta el dia que la maquina va cargada y la captura sale vacia.
        t0 = time.time()
        listo = False
        while time.time() - t0 < 120:
            listo = cdp.evaluar(
                "!!(document.querySelector('.deck-overlay canvas') && "
                "document.querySelectorAll('.leyenda li').length === 9)"
            )
            if listo:
                break
            time.sleep(0.25)
        ms_listo = (time.time() - t0) * 1000

        cifra = cdp.evaluar("document.querySelector('.cifra-grande')?.textContent")
        clases = cdp.evaluar(
            "Array.from(document.querySelectorAll('.leyenda .nombre')).map(e=>e.textContent)"
        )
        canvas = cdp.evaluar(
            "(()=>{const c=document.querySelector('.deck-overlay canvas');if(!c)return null;"
            "const r=c.getBoundingClientRect();return JSON.stringify({w:r.width,h:r.height})})()"
        )
        errores = cdp.evaluar(
            "(window.__errores||[]).length"
        )

        png = cdp.enviar("Page.captureScreenshot", format="png")["data"]
        ruta = os.path.join(AQUI, "captura-app.png")
        with open(ruta, "wb") as fh:
            fh.write(base64.b64decode(png))
        img = np.array(Image.open(ruta).convert("RGB")).astype(np.int16)
        # Solo la mitad derecha: el panel izquierdo tiene su propio color y no
        # es "el mapa".
        mapa = img[:, img.shape[1] // 4:]
        # El fondo se DEDUCE de la imagen (color modal), no se da por supuesto.
        # Escrito a mano fallaba: con las teselas bloqueadas el hueco del mapa es
        # casi blanco, asi que el propio fondo contaba como "pintado" y como
        # "casi-blanco", y la asercion salia roja sobre un render correcto. Un
        # gate con falso positivo acaba desactivado, que es el peor final.
        plano = mapa.reshape(-1, 3)
        vals, cuentas = np.unique(plano, axis=0, return_counts=True)
        fondo = vals[cuentas.argmax()]
        dif = np.abs(mapa - fondo.astype(np.int16)).sum(axis=2)
        pintados = int((dif > 30).sum())
        bandas = sum(1 for b in np.array_split(dif > 30, 16, axis=0) if b.sum() > 50)
        px = mapa[dif > 30]
        colores = len(np.unique((px >> 5).astype(np.uint8).reshape(-1, 3), axis=0)) if px.size else 0
        casi_blanco = float((px > 220).all(axis=1).mean()) if px.size else 0.0

        pruebas = [
            ("V1 la app monta y pinta la leyenda de 9 clases", listo, f"{ms_listo:.0f} ms"),
            ("V2 lienzo de deck con caja real", canvas and '"w":0' not in canvas, str(canvas)),
            ("V3 mapa pintado (> 25.000 px)", pintados > 25000, f"{pintados:,}"),
            ("V4 repartido en >= 12 de 16 bandas", bandas >= 12, str(bandas)),
            ("V5 >= 8 colores distintos", colores >= 8, str(colores)),
            ("V6 casi-blanco < 50%", casi_blanco < 0.50, f"{casi_blanco:.1%}"),
            ("V7 cifra nacional visible", bool(cifra and "75" in cifra), str(cifra)),
            ("V8 sin errores de consola", not errores, str(errores)),
        ]
        print("=" * 66)
        for nombre, ok, valor in pruebas:
            if not ok:
                fallos.append(nombre)
            print(f"  {nombre:<48} {'OK  ' if ok else 'FALLA'}  ({valor})")
        print("=" * 66)
        print(f"  clases en la leyenda: {clases}")
        print(f"  captura: {ruta}")
        print(f"  {'TODO EN VERDE' if not fallos else str(len(fallos)) + ' EN ROJO'}")
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
