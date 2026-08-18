"""Fase 0 - mide el spike MIRANDO el resultado, no el codigo.

Levanta un servidor local en puerto 0, lanza Chrome headless con su propio
perfil, lo pilota por CDP, espera a que la pagina declare que pinto, captura
la pantalla y CUENTA LOS PIXELES pintados dentro del lienzo.

Por que asi y no de otra forma (trampas ya pagadas en este ecosistema):
  - Puerto 0, nunca uno fijo: un servidor ajeno en el puerto esperado responde
    200 igual de bien y se acaba midiendo otro sitio.
  - --user-data-dir propio y ABSOLUTO: sin el, Chrome se engancha a la sesion
    abierta del usuario y no genera captura.
  - Nada de --virtual-time-budget: puede leerse el DOM antes del evento load.
  - Contar pixeles no-fondo, no comprobar que el <canvas> existe: un
    ScatterplotLayer con data:[] deja el canvas ahi, intacto y vacio.
  - Se cierra solo el Chrome que lanzamos nosotros.

Uso:
    python spike/medir.py                 # spike.html
    python spike/medir.py --pagina spike_roto.html --etiqueta roto
    python spike/medir.py --ver           # con ventana, para mirarlo en vivo
"""

import argparse
import functools
import http.server
import json
import os
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time

import numpy as np
import requests
import websocket
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")

AQUI = os.path.dirname(os.path.abspath(__file__))
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
FONDO = (0x0D, 0x11, 0x17)          # el mismo del CSS del spike
ANCHO, ALTO = 1400, 1100
# El HUD tapa la esquina superior izquierda; se excluye del conteo para no
# contar como "mapa" los pixeles del propio panel de medicion.
HUD = (0, 0, 320, 150)              # x0, y0, x1, y1


def servir(directorio):
    manejador = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directorio)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", 0), manejador)   # puerto 0, a proposito
    srv.RequestHandlerClass.log_message = lambda *a, **k: None
    hilo = threading.Thread(target=srv.serve_forever, daemon=True)
    hilo.start()
    return srv, srv.server_address[1]


class Cdp:
    """Cliente CDP minimo sobre websocket-client."""

    def __init__(self, ws_url):
        # suppress_origin es obligatorio: websocket-client manda cabecera Origin
        # y Chrome rechaza el handshake con 403 salvo que se le pase
        # --remote-allow-origins. Suprimirla es mas limpio que abrir el debugger.
        self.ws = websocket.create_connection(
            ws_url, timeout=90, max_size=200 * 1024 * 1024, suppress_origin=True
        )
        self.n = 0
        self.eventos = []

    def enviar(self, metodo, **params):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": metodo, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.n:
                if "error" in msg:
                    raise RuntimeError(f"{metodo}: {msg['error']}")
                return msg.get("result", {})
            self.eventos.append(msg)

    def evaluar(self, expr):
        r = self.enviar("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        res = r.get("result", {})
        if r.get("exceptionDetails"):
            raise RuntimeError(f"JS lanzo: {r['exceptionDetails'].get('text')} {res.get('description','')}")
        return res.get("value")

    def cerrar(self):
        try:
            self.ws.close()
        except Exception:
            pass


def lanzar_chrome(url, ver=False, swiftshader=True):
    perfil = tempfile.mkdtemp(prefix="spike-chrome-")     # absoluto, propio
    args = [
        CHROME,
        f"--user-data-dir={perfil}",
        "--remote-debugging-port=0",
        "--no-first-run", "--no-default-browser-check", "--disable-extensions",
        "--disable-background-networking", "--disable-sync",
        f"--window-size={ANCHO},{ALTO}",
        "--hide-scrollbars",
    ]
    if not ver:
        args.append("--headless=new")
    if swiftshader:
        # En headless sin GPU, Chrome 120+ exige este flag para dar WebGL por
        # software; sin el, el contexto WebGL simplemente no se crea.
        args += ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"]
    args.append(url)

    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    puerto_file = os.path.join(perfil, "DevToolsActivePort")
    for _ in range(200):
        if os.path.exists(puerto_file):
            try:
                puerto = int(open(puerto_file).read().split("\n")[0])
                return proc, perfil, puerto
            except Exception:
                pass
        if proc.poll() is not None:
            raise RuntimeError(f"Chrome murio con codigo {proc.returncode}")
        time.sleep(0.1)
    raise RuntimeError("Chrome no publico DevToolsActivePort en 20 s")


def contar_pixeles(png_bytes, ruta_png):
    with open(ruta_png, "wb") as fh:
        fh.write(png_bytes)
    img = np.array(Image.open(ruta_png).convert("RGB")).astype(np.int16)
    fondo = np.array(FONDO, dtype=np.int16)
    dif = np.abs(img - fondo).sum(axis=2)
    mascara = dif > 24                       # tolerancia al antialias del fondo
    mascara[HUD[1]:HUD[3], HUD[0]:HUD[2]] = False
    total = int(mascara.sum())

    bandas = np.array_split(mascara, 16, axis=0)
    con_pixeles = sum(1 for b in bandas if b.sum() > 50)

    # Diversidad cromatica. Existe porque el spike salio TODO BLANCO en la
    # primera corrida (normalized:false) y las dos aserciones de entonces
    # -pixeles y bandas- pasaron en verde igual. Un mapa tematico con un solo
    # color esta roto aunque tenga la silueta correcta.
    px = img[mascara]
    if px.size:
        quant = (px >> 5).astype(np.uint8)               # 8 niveles por canal
        colores = len(np.unique(quant.reshape(-1, 3), axis=0))
        casi_blanco = float((px > 220).all(axis=1).mean())
    else:
        colores, casi_blanco = 0, 0.0
    return total, con_pixeles, mascara.shape, colores, casi_blanco


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pagina", default="spike.html")
    ap.add_argument("--etiqueta", default=None)
    ap.add_argument("--ver", action="store_true", help="con ventana visible")
    ap.add_argument("--gpu", action="store_true", help="sin swiftshader, usa la GPU real")
    ap.add_argument("--espera", type=float, default=90.0)
    args = ap.parse_args()
    etiqueta = args.etiqueta or args.pagina.replace(".html", "")

    if not os.path.exists(CHROME):
        sys.exit(f"No encuentro Chrome en {CHROME}")

    srv, puerto = servir(AQUI)
    url = f"http://127.0.0.1:{puerto}/{args.pagina}"
    print(f"servidor local  : {url}")

    proc = perfil = None
    try:
        proc, perfil, dp = lanzar_chrome(url, ver=args.ver, swiftshader=not args.gpu)
        print(f"chrome devtools : puerto {dp}  (perfil {perfil})")

        destino = None
        for _ in range(100):
            try:
                for t in requests.get(f"http://127.0.0.1:{dp}/json", timeout=5).json():
                    if t.get("type") == "page" and args.pagina in t.get("url", ""):
                        destino = t
                        break
            except Exception:
                pass
            if destino:
                break
            time.sleep(0.2)
        if not destino:
            raise RuntimeError("no aparecio la pestana del spike")

        cdp = Cdp(destino["webSocketDebuggerUrl"])
        cdp.enviar("Runtime.enable")
        cdp.enviar("Log.enable")

        t0 = time.time()
        e = {}
        ultimo = ""
        while time.time() - t0 < args.espera:
            crudo = cdp.evaluar("JSON.stringify(window.__spike || null)")
            # JSON.stringify(null) devuelve la CADENA "null", que en Python es
            # truthy: hay que decodificar antes de decidir, no despues.
            actual = json.loads(crudo) if crudo else None
            if isinstance(actual, dict):
                e = actual
                traza = f"{e.get('estado','')}{e.get('filas')}{e.get('tPintado')}{e.get('fps')}"
                if traza != ultimo:
                    ultimo = traza
                    print(f"  … filas={e.get('filas')} pintado={e.get('tPintado')} "
                          f"fps={e.get('fps')} filtro={e.get('tFiltro')}")
                if e.get("error"):
                    print(f"\n!! ERROR EN LA PAGINA: {e['error']}")
                    break
                if e.get("listoFiltro"):
                    break
            time.sleep(0.25)
        else:
            print(f"\n!! TIEMPO AGOTADO tras {args.espera:.0f}s — se mide lo que haya")
        webgl = cdp.evaluar(
            "(()=>{const c=document.createElement('canvas');"
            "const g=c.getContext('webgl2')||c.getContext('webgl');"
            "return g? g.getParameter(g.VERSION)+' | '+g.getParameter(g.RENDERER):'SIN WEBGL';})()"
        )

        png = cdp.enviar("Page.captureScreenshot", format="png")["data"]
        import base64
        ruta_png = os.path.join(AQUI, f"captura-{etiqueta}.png")
        total, bandas, forma, colores, casi_blanco = contar_pixeles(
            base64.b64decode(png), ruta_png)

        print()
        print("=" * 64)
        print(f"  RESULTADO DEL SPIKE  [{etiqueta}]")
        print("=" * 64)
        print(f"  webgl            : {webgl}")
        print(f"  filas cargadas   : {e.get('filas', 0):,}")
        print(f"  descarga         : {_ms(e.get('tDescarga'))}")
        print(f"  1er pintado      : {_ms(e.get('tPintado'))}")
        print(f"  fps en paneo     : {_f(e.get('fps'))}")
        print(f"  pasada de filtro : {_ms(e.get('tFiltro'))}")
        print(f"  captura          : {forma[1]}x{forma[0]} -> {ruta_png}")
        print(f"  PIXELES PINTADOS : {total:,}")
        print(f"  bandas con datos : {bandas}/16")
        print(f"  colores distintos: {colores}   casi-blanco: {casi_blanco:.1%}")
        avisos = e.get("avisos") or []
        print(f"  avisos de deck.gl: {len(avisos)}")
        for a in avisos[:10]:
            print(f"     · {a[:160]}")
        print("-" * 64)
        # Umbrales DERIVADOS de la linea base medida (39.209 px / 15 bandas /
        # 27 colores con GPU real), no inventados. Un umbral adivinado que nace
        # rojo sobre un render correcto entrena a ignorar el verificador.
        pruebas = [
            ("A1 pixeles > 25.000",        total > 25000,                        f"{total:,}"),
            ("A2 bandas >= 12 de 16",      bandas >= 12,                         f"{bandas}"),
            ("A3 >= 8 colores distintos",  colores >= 8,                         f"{colores}"),
            ("A4 casi-blanco < 50%",       casi_blanco < 0.50,                   f"{casi_blanco:.1%}"),
            ("A5 sin avisos de deck.gl",   not avisos,                           f"{len(avisos)}"),
            ("A6 1er pintado < 3.000 ms",  (e.get("tPintado") or 9e9) < 3000,    _ms(e.get("tPintado"))),
            ("A7 filtro < 120 ms",         (e.get("tFiltro") or 9e9) < 120,      _ms(e.get("tFiltro"))),
        ]
        fallos = 0
        for nombre, ok, valor in pruebas:
            fallos += 0 if ok else 1
            print(f"  {nombre:<28}: {'OK  ' if ok else 'FALLA'}  ({valor})")
        print("-" * 64)
        print(f"  {'TODO EN VERDE' if not fallos else f'{fallos} ASERCION(ES) EN ROJO'}")
        print("=" * 64)
        cdp.cerrar()
        return 0 if not fallos else 1

    finally:
        srv.shutdown()
        if proc and proc.poll() is None:
            proc.terminate()          # solo el que lanzamos nosotros
            try:
                proc.wait(timeout=10)
            except Exception:
                proc.kill()
        if perfil and os.path.isdir(perfil):
            shutil.rmtree(perfil, ignore_errors=True)


def _ms(v):
    return "–" if v is None else f"{v:,.0f} ms"


def _f(v):
    return "–" if v is None else f"{v:.1f}"


if __name__ == "__main__":
    sys.exit(main())
