# -*- coding: utf-8 -*-
"""Capturas de docs/Documentacion_Sistema2/_imagenes por CDP, contra una demo local.

La demo es el visor COMPILADO (vite build + prerender + build:web) con los datos
FICTICIOS de scripts/demo_datos.py, servido por un servidor estático local bajo
/coipo_vista_catastro/. La app no tiene backend ni base de datos.

Sin red: Chrome no resuelve ningún nombre externo (--host-resolver-rules) y además
cada petición que no va a 127.0.0.1 se intercepta por CDP (Fetch): las imágenes
(teselas del mapa base) se responden con una tesela lisa y el resto se corta.

    python scripts/capturar_pantallas.py --url http://127.0.0.1:8847/coipo_vista_catastro --chrome <chrome.exe>

Imprime el PID de Chrome que lanza y sólo cierra ese.
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

import websocket

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from docgen.comun import RAIZ_DOC  # noqa: E402

DIR = os.path.join(RAIZ_DOC, "_imagenes")
# PNG 1x1 gris claro: la tesela lisa (Leaflet la estira a 256 px).
TESELA = base64.b64encode(base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPo6OgAAAMEAYHFHsJQAAAAAElFTkSuQmCC")).decode()


class Pestana:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=60, suppress_origin=True)
        self.n = 0
        self.externas = set()

    def _evento(self, m):
        if m.get("method") != "Fetch.requestPaused":
            return
        p = m["params"]
        url = p["request"]["url"]
        rid = p["requestId"]
        if url.startswith("http://127.0.0.1"):
            self._enviar("Fetch.continueRequest", requestId=rid)
        elif p.get("resourceType") == "Image":
            self.externas.add(url.split("/")[2])
            self._enviar("Fetch.fulfillRequest", requestId=rid, responseCode=200,
                         responseHeaders=[{"name": "Content-Type", "value": "image/png"}], body=TESELA)
        else:
            self.externas.add(url.split("/")[2])
            self._enviar("Fetch.failRequest", requestId=rid, errorReason="BlockedByClient")

    def _enviar(self, metodo, **params):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": metodo, "params": params}))
        return self.n

    def cmd(self, metodo, **params):
        mi = self._enviar(metodo, **params)
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == mi:
                if "error" in m:
                    raise RuntimeError(m["error"])
                return m.get("result", {})
            self._evento(m)

    def esperar(self, s):
        fin = time.time() + s
        self.ws.settimeout(0.2)
        while time.time() < fin:
            try:
                self._evento(json.loads(self.ws.recv()))
            except websocket.WebSocketTimeoutException:
                pass
        self.ws.settimeout(60)

    def js(self, codigo):
        r = self.cmd("Runtime.evaluate", expression=codigo, awaitPromise=True, returnByValue=True)
        return r.get("result", {}).get("value")

    def ir(self, url, espera=6):
        self.cmd("Page.navigate", url=url)
        self.esperar(espera)

    def foto(self, nombre):
        self.esperar(1)
        datos = self.cmd("Page.captureScreenshot", format="png")["data"]
        ruta = os.path.join(DIR, nombre)
        with open(ruta, "wb") as f:
            f.write(base64.b64decode(datos))
        print("  ", ruta)

    def clic(self, x, y):
        for t in ("mousePressed", "mouseReleased"):
            self.cmd("Input.dispatchMouseEvent", type=t, x=x, y=y, button="left", clickCount=1)
        self.esperar(1.5)


def abrir(p, col):
    ok = p.js("(() => { const b=document.querySelector('[data-col=%s]'); if(!b) return false; b.click(); return true })()"
              % json.dumps(col))
    if not ok:
        raise RuntimeError("no encontré el control %s" % col)
    p.esperar(1.5)


def clic_texto(p, texto, selector="button"):
    ok = p.js("""(() => { const b=[...document.querySelectorAll(%s)].find(e=>e.textContent.trim().startsWith(%s));
      if(!b) return false; b.click(); return true })()""" % (json.dumps(selector), json.dumps(texto)))
    if not ok:
        raise RuntimeError("no encontré «%s»" % texto)
    p.esperar(2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8847/coipo_vista_catastro")
    ap.add_argument("--chrome", default=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    ap.add_argument("--puerto", type=int, default=9461)
    ap.add_argument("--perfil", default=None)
    a = ap.parse_args()
    os.makedirs(DIR, exist_ok=True)
    perfil = a.perfil or tempfile.mkdtemp(prefix="cdp-docs-")
    chrome = subprocess.Popen([a.chrome, "--headless=new", "--remote-debugging-port=%d" % a.puerto,
                               "--user-data-dir=" + perfil, "--window-size=1440,900",
                               "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "about:blank"])
    print("PID de Chrome lanzado:", chrome.pid)
    try:
        ws = None
        for _ in range(60):
            try:
                lista = json.load(urllib.request.urlopen("http://127.0.0.1:%d/json" % a.puerto))
                ws = next(x["webSocketDebuggerUrl"] for x in lista if x["type"] == "page")
                break
            except Exception:
                time.sleep(0.5)
        p = Pestana(ws)
        p.cmd("Page.enable")
        p.cmd("Fetch.enable", patterns=[{"urlPattern": "*"}])
        p.cmd("Emulation.setDeviceMetricsOverride", width=1440, height=900, deviceScaleFactor=1, mobile=False)
        p.cmd("Emulation.setEmulatedMedia", features=[{"name": "prefers-color-scheme", "value": "light"}])
        u = a.url

        p.ir(u + "/", 10)
        p.foto("01-vis-visor.png")

        abrir(p, "territorio")
        p.foto("01b-vis-territorio.png")

        p.ir(u + "/", 8)
        abrir(p, "uso")
        p.foto("01c-vis-filtro-uso.png")

        p.ir(u + "/", 8)
        abrir(p, "base")
        p.foto("01d-vis-mapa-base.png")

        # Ficha: un ámbito comunal (la ficticia tiene ~120 puntos por comuna) y clics
        # en una rejilla alrededor del centro del mapa hasta que se abra la ficha.
        p.ir(u + "/?reg=13&com=13101", 10)
        caja = p.js("(() => { const r=document.querySelector('main.mapa').getBoundingClientRect(); "
                    "return [r.left, r.top, r.width, r.height] })()")
        abierta = False
        for fy in (0.5, 0.4, 0.6, 0.3, 0.7):
            for fx in (0.5, 0.4, 0.6, 0.3, 0.7):
                p.clic(caja[0] + caja[2] * fx, caja[1] + caja[3] * fy)
                if p.js("!!document.getElementById('ficha-titulo')"):
                    abierta = True
                    break
            if abierta:
                break
        print("   ficha abierta:", abierta)
        p.foto("01e-vis-ficha.png")

        p.ir(u + "/?reg=13", 10)
        p.foto("02-vis-indicadores-region.png")

        p.ir(u + "/", 8)
        abrir(p, "info")
        p.foto("03-vis-informacion.png")

        p.ir(u + "/", 8)
        abrir(p, "descargas")
        p.foto("04-vis-descargar.png")
        clic_texto(p, "Reporte del ámbito")
        p.esperar(3)
        p.foto("04b-vis-reporte.png")

        p.ir(u + "/?reg=13&com=13101", 8)
        abrir(p, "compartir")
        p.foto("05-vis-compartir.png")

        p.ir(u + "/regiones/", 4)
        p.foto("06-vis-cifras-regiones.png")
        p.ir(u + "/region/metropolitana/", 4)
        p.foto("06b-vis-cifras-region.png")
        p.ir(u + "/comuna/santiago/", 4)
        p.foto("06c-vis-cifras-comuna.png")

        p.cmd("Emulation.setEmulatedMedia", features=[{"name": "prefers-color-scheme", "value": "dark"}])
        p.ir(u + "/", 10)
        p.foto("07-vis-visor-oscuro.png")
        print("Hosts externos interceptados (ninguno salió a la red):", sorted(p.externas))
    finally:
        chrome.terminate()
        try:
            chrome.wait(10)
        except Exception:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(chrome.pid)], check=False)
        print("Chrome %d cerrado" % chrome.pid)


if __name__ == "__main__":
    main()
