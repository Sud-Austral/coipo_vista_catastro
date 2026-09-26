"""Las tarjetas PNG de la vista previa: la imagen grande que muestran WhatsApp, Facebook,
LinkedIn y X al compartir una página (DECISIONES §M.4).

Una por región y una por comuna. Con la genérica, la vista previa de Valdivia no decía
«Valdivia» en ninguna parte grande, y en WhatsApp la imagen es lo primero que se ve y lo único
que se lee de un vistazo.

PYTHON SÓLO DIBUJA. Los textos llegan YA FORMATEADOS en frontend/.web/tarjetas.json, que
escribe scripts/web.mjs con las mismas funciones que las páginas: no hay una segunda
redacción de las cifras que pueda divergir de la primera.

EL SELLO de la carpeta (dist/tarjetas/<sello>/) sale de los bytes crudos de tarjetas.json, de
este archivo (con saltos LF), de la tipografía y de requirements.txt: cambia exactamente
cuando puede cambiar un píxel, y con él cambian og:image y la versión de og:url, así que
Facebook no se queda con la tarjeta vieja. web.mjs lo calcula igual y lo declara; aquí se
RECALCULA y se exige que coincida, o las páginas citarían una carpeta que no existe.

Determinista con la MISMA versión de Pillow; por eso la versión se exige (requirements.txt)
y no se comparan bytes entre sistemas operativos: el suavizado de la letra puede variar.

Uso (desde frontend/, después de npm run build:web):
    python scripts/tarjetas.py              dibuja dist/tarjetas/<sello>/*.png
    python scripts/tarjetas.py --generica   dibuja public/og.png, la que se versiona
    python scripts/tarjetas.py --negativas  rompe cada comprobación y exige que salte
"""

import hashlib
import io
import json
import os
import struct
import sys
from functools import lru_cache
from pathlib import Path

import PIL
from PIL import Image, ImageDraw, ImageFont

AQUI = Path(__file__).resolve().parent
FRONTEND = AQUI.parent
FUENTE = AQUI / "fuentes" / "AtkinsonHyperlegibleNext-wght.ttf"
CATALOGO = AQUI / "fuentes" / "fuentes.json"
REQUISITOS = AQUI / "requirements.txt"
ENTRADA = FRONTEND / ".web" / "tarjetas.json"
SELLO = FRONTEND / ".web" / "tarjetas.sello"
DIST = FRONTEND / "dist"

ANCHO, ALTO = 1200, 630
TOPE_BYTES = 300_000  # WhatsApp descarta imágenes mayores (guía §8.1)
MARGEN = 72
ANCHO_UTIL = ANCHO - 2 * MARGEN

# Los tokens del tema claro de src/index.css. --superficie sobre --verde-institucional es
# 10,5:1 medido, igual que el blanco del banner.
PAPEL, TINTA, TINTA_2, VERDE = "#FCFCFB", "#14211A", "#4A554E", "#064928"


def version_fijada():
    for linea in REQUISITOS.read_text(encoding="utf-8").splitlines():
        if linea.strip().lower().startswith("pillow=="):
            return linea.split("==", 1)[1].strip()
    raise SystemExit("requirements.txt no fija pillow==")


def exigir_entorno():
    """Otra versión de Pillow dibuja otros píxeles con el mismo sello: la tarjeta cambiaría
    sin que cambie su URL. Y una tipografía distinta de la catalogada, lo mismo."""
    fijada = version_fijada()
    if PIL.__version__ != fijada:
        raise SystemExit(f"Pillow {PIL.__version__} y requirements.txt fija {fijada}: "
                         f"pip install -r frontend/scripts/requirements.txt")
    cat = json.loads(CATALOGO.read_text(encoding="utf-8"))
    sha = hashlib.sha256(FUENTE.read_bytes()).hexdigest()
    if sha != cat["sha256"]:
        raise SystemExit(f"la tipografía no es la catalogada ({sha[:12]} ≠ {cat['sha256'][:12]})")


def sello(bytes_json):
    """sha256[:12] de: tarjetas.json crudo, este archivo en LF, la tipografía y requirements.txt.
    La MISMA receta que selloTarjetas() en scripts/web.mjs."""
    h = hashlib.sha256()
    h.update(bytes_json)
    h.update(Path(__file__).read_bytes().replace(b"\r\n", b"\n"))
    h.update(FUENTE.read_bytes())
    h.update(REQUISITOS.read_bytes().replace(b"\r\n", b"\n"))
    return h.hexdigest()[:12]


@lru_cache(maxsize=None)
def letra(tamano, peso=400):
    f = ImageFont.truetype(str(FUENTE), tamano)
    f.set_variation_by_axes([peso])
    return f


def _que_quepa(texto, tamano, peso, ancho=ANCHO_UTIL, minimo=34):
    """El tamaño más grande (hasta `tamano`) en que `texto` cabe en una línea."""
    while tamano > minimo and letra(tamano, peso).getlength(texto) > ancho:
        tamano -= 2
    return letra(tamano, peso)


def _lienzo(url, franja):
    img = Image.new("RGB", (ANCHO, ALTO), PAPEL)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 14, ALTO], fill=VERDE)
    d.text((MARGEN, 50), "VISOR DEL CATASTRO · CONAF", font=letra(26, 700), fill=TINTA_2)
    # La franja, abajo y en grande: de qué actualización es la cifra, que es lo que tiene que
    # sobrevivir a una captura o a una vista previa guardada semanas.
    d.rectangle([0, ALTO - 84, ANCHO, ALTO], fill=VERDE)
    d.text((MARGEN, ALTO - 62), franja, font=_que_quepa(franja, 30, 700, minimo=20), fill=PAPEL)
    # La dirección va ENCIMA de la franja y no dentro: juntas se montaban (Botón Rojo, trampa 20).
    fu = _que_quepa(url, 24, 500)
    d.text((ANCHO - MARGEN - fu.getlength(url), ALTO - 84 - 40), url, font=fu, fill=TINTA_2)
    return img, d


def _png(img):
    salida = io.BytesIO()
    img.save(salida, format="PNG", optimize=True)
    return salida.getvalue()


def dibujar(t):
    """Una tarjeta: {titulo, subtitulo, renglones[], franja, url} → bytes PNG."""
    img, d = _lienzo(t["url"], t["franja"])
    titulo = _que_quepa(t["titulo"], 84, 800)
    d.text((MARGEN, 98), t["titulo"], font=titulo, fill=TINTA)
    y = 98 + titulo.size + 16
    if t.get("subtitulo"):
        sub = _que_quepa(t["subtitulo"], 36, 500)
        d.text((MARGEN, y), t["subtitulo"], font=sub, fill=TINTA_2)
        y += sub.size + 30
    for renglon in t["renglones"][:4]:
        f = _que_quepa(renglon, 38, 600, ANCHO_UTIL - 34)
        # La viñeta se DIBUJA: la tipografía puede no traer «▪» y saldría un cuadro vacío.
        d.rectangle([MARGEN + 2, y + 15, MARGEN + 16, y + 29], fill=VERDE)
        d.text((MARGEN + 34, y), renglon, font=f, fill=TINTA)
        y += int(f.size * 1.35)
    return _png(img)


def medidas_png(datos):
    """(ancho, alto) leídos de la cabecera IHDR, sin abrir la imagen."""
    if datos[:8] != b"\x89PNG\r\n\x1a\n" or datos[12:16] != b"IHDR":
        raise ValueError("no es un PNG")
    return struct.unpack(">II", datos[16:24])


def revisar(datos, nombre):
    if medidas_png(datos) != (ANCHO, ALTO):
        raise ValueError(f"{nombre}: mide {medidas_png(datos)} y no {ANCHO}×{ALTO}")
    if len(datos) >= TOPE_BYTES:
        raise ValueError(f"{nombre}: pesa {len(datos)} B; WhatsApp descarta desde {TOPE_BYTES}")


def escribir(ruta, datos):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    tmp = ruta.with_name(ruta.name + ".tmp")
    tmp.write_bytes(datos)
    os.replace(tmp, ruta)


GENERICA = {
    "titulo": "Catastro de Usos de la Tierra",
    "subtitulo": "y Recursos Vegetacionales de CONAF",
    "renglones": ["Uso de la tierra y bosques de todo Chile",
                  "Cifras por región y por comuna",
                  "Mapa de los polígonos del Catastro"],
    "franja": "GERENCIA DE FISCALIZACIÓN FORESTAL Y EVALUACIÓN AMBIENTAL",
    "url": "sud-austral.github.io/coipo_vista_catastro",
}


def principal():
    exigir_entorno()
    if "--generica" in sys.argv:
        datos = dibujar(GENERICA)
        revisar(datos, "og.png")
        escribir(FRONTEND / "public" / "og.png", datos)
        peso = f"{len(datos):,}".replace(",", ".")
        print(f"✓ tarjetas: public/og.png; {peso} B")
        return
    crudo = ENTRADA.read_bytes()
    entrada = json.loads(crudo)
    calculado = sello(crudo)
    declarado = SELLO.read_text(encoding="utf-8").strip()
    if declarado != calculado:
        raise SystemExit(f"el sello declarado por web.mjs ({declarado}) no es el de estos "
                         f"insumos ({calculado}): las páginas citarían una carpeta que no existe")
    carpeta = DIST / "tarjetas" / calculado
    total = 0
    for t in entrada["tarjetas"]:
        datos = dibujar(t)
        revisar(datos, t["archivo"])
        escribir(carpeta / t["archivo"], datos)
        total += len(datos)
    n = len(entrada["tarjetas"])
    media = f"{total // max(n, 1):,}".replace(",", ".")
    print(f"✓ tarjetas: {n} PNG de {ANCHO}×{ALTO} en dist/tarjetas/{calculado}/; media {media} B")


def negativas():
    """Cada comprobación, rota a propósito, tiene que saltar."""
    malas = 0
    casos = [
        ("un PNG de 1200×631", lambda: revisar(_png(Image.new("RGB", (ANCHO, ALTO + 1))), "x")),
        ("algo que no es PNG", lambda: revisar(b"GIF89a" + b"\0" * 40, "x")),
        ("un PNG demasiado pesado", lambda: revisar(_png(Image.frombytes("RGB", (ANCHO, ALTO), os.urandom(ANCHO * ALTO * 3))), "x")),
    ]
    for nombre, romper in casos:
        try:
            romper()
            malas += 1
            print(f"  MAL  «{nombre}»: no saltó")
        except ValueError:
            pass
    # El sello cambia si cambia un byte de la entrada.
    if sello(b'{"a":1}') == sello(b'{"a":2}'):
        malas += 1
        print("  MAL  el sello no cambia con la entrada")
    if malas:
        raise SystemExit(f"tarjetas: {malas} comprobación(es) no saltan")
    print(f"✓ tarjetas --negativas: {len(casos) + 1} comprobaciones saltan")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if "--negativas" in sys.argv:
        negativas()
    else:
        principal()
