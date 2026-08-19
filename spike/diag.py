"""Diagnostico puntual de una pagina del spike: evalua expresiones por CDP.

Reutiliza el arnes de medir.py (servidor en puerto 0, Chrome con perfil propio).

Uso:  python spike/diag.py spike_hibrido.html
"""

import json
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import requests
from medir import Cdp, lanzar_chrome, servir  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
AQUI = os.path.dirname(os.path.abspath(__file__))

SONDAS = [
    ("error de la pagina", "window.__spike && window.__spike.error"),
    ("listo", "!!(window.__spike && window.__spike.listo)"),
    ("canvas de deck: existe", "!!document.querySelector('.deck-overlay canvas')"),
    ("canvas w/h atributo", "(()=>{const c=document.querySelector('.deck-overlay canvas');"
                            "return c? c.width+'x'+c.height : null})()"),
    ("canvas w/h css", "(()=>{const c=document.querySelector('.deck-overlay canvas');"
                       "return c? c.style.width+' x '+c.style.height : null})()"),
    ("canvas rect", "(()=>{const c=document.querySelector('.deck-overlay canvas');"
                    "if(!c) return null;const r=c.getBoundingClientRect();"
                    "return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()"),
    ("contenedor transform", "(()=>{const d=document.querySelector('.deck-overlay');"
                             "return d? getComputedStyle(d).transform : null})()"),
    ("pane del overlay", "(()=>{const d=document.querySelector('.deck-overlay');"
                         "return d? d.parentElement.className : null})()"),
    ("deck viewports", "(()=>{try{const v=window.__deck.getViewports();"
                       "return JSON.stringify(v.map(x=>({w:x.width,h:x.height,z:x.zoom,"
                       "lon:x.longitude,lat:x.latitude})))}catch(e){return 'LANZA: '+e.message}})()"),
    ("desfase Santiago", "(()=>{try{return JSON.stringify(window.__desfase())}"
                         "catch(e){return 'LANZA: '+e.message}})()"),
    ("capas y conteo", "(()=>{try{const l=window.__deck.props.layers[0];"
                       "return l.id+' n='+(l.props.data&&l.props.data.length)}"
                       "catch(e){return 'LANZA: '+e.message}})()"),
    ("leaflet zoom/centro", "(()=>{const m=window.__map;const c=m.getCenter();"
                            "return m.getZoom()+' @ '+c.lat.toFixed(3)+','+c.lng.toFixed(3)})()"),
    ("pixeles no transparentes del canvas de deck",
     "(()=>{const c=document.querySelector('.deck-overlay canvas');if(!c)return null;"
     "const g=c.getContext('webgl2')||c.getContext('webgl');if(!g)return 'sin contexto webgl';"
     "const w=c.width,h=c.height;const px=new Uint8Array(w*h*4);"
     "g.readPixels(0,0,w,h,g.RGBA,g.UNSIGNED_BYTE,px);let n=0;"
     "for(let i=3;i<px.length;i+=4) if(px[i]!==0) n++;return n})()"),
]


def main():
    pagina = sys.argv[1] if len(sys.argv) > 1 else "spike_hibrido.html"
    srv, puerto = servir(AQUI)
    url = f"http://127.0.0.1:{puerto}/{pagina}"
    print(f"url: {url}\n")
    proc = perfil = None
    try:
        proc, perfil, dp = lanzar_chrome(url, ver=False, swiftshader=False)
        destino = None
        for _ in range(100):
            try:
                for t in requests.get(f"http://127.0.0.1:{dp}/json", timeout=5).json():
                    if t.get("type") == "page" and pagina.split("?")[0] in t.get("url", ""):
                        destino = t
                        break
            except Exception:
                pass
            if destino:
                break
            time.sleep(0.2)
        cdp = Cdp(destino["webSocketDebuggerUrl"])
        cdp.enviar("Runtime.enable")
        cdp.enviar("Log.enable")
        cdp.enviar("Console.enable")

        # Esperar a que la pagina se declare lista, pero sin bloquear el diagnostico.
        for _ in range(80):
            if cdp.evaluar("!!(window.__spike && window.__spike.listo)"):
                break
            time.sleep(0.25)
        time.sleep(1.5)

        for nombre, expr in SONDAS:
            try:
                v = cdp.evaluar(expr)
            except Exception as e:
                v = f"<<error al evaluar: {e}>>"
            print(f"  {nombre:<44} = {v}")

        print("\n  --- mensajes de consola capturados ---")
        vistos = 0
        for ev in cdp.eventos:
            m = ev.get("method", "")
            if m in ("Log.entryAdded", "Runtime.consoleAPICalled", "Runtime.exceptionThrown"):
                p = json.dumps(ev.get("params", {}))[:300]
                print(f"    [{m}] {p}")
                vistos += 1
        if not vistos:
            print("    (ninguno)")
        cdp.cerrar()
    finally:
        srv.shutdown()
        if proc and proc.poll() is None:
            proc.terminate()
        if perfil and os.path.isdir(perfil):
            shutil.rmtree(perfil, ignore_errors=True)


if __name__ == "__main__":
    main()
