# -*- coding: utf-8 -*-
"""Catálogo de capturas y su asociación a funcionalidades y casos de uso.

Las produce scripts/capturar_pantallas.py contra el visor COMPILADO con los datos
FICTICIOS de scripts/demo_datos.py (40.000 puntos al azar). Nombres:
NN[letra]-<prefijo>-<pantalla>.png; prefijo «vis» (Usuario del visor).
"""
import os

from .comun import RAIZ_DOC

DIR = os.path.join(RAIZ_DOC, "_imagenes")
_FICT = " Datos ficticios generados al azar (40.000 puntos): ninguna cifra es del Catastro."
_OFI = (" La «cifra oficial de CONAF» sí es la publicada (oficiales.json se dejó tal cual), por eso no "
        "cuadra con la ficticia.")

# clave -> (archivo, título, pie)
CATALOGO = {
    "visor": ("01-vis-visor.png", "Visor del Catastro (pantalla de llegada)",
              "Panel de control a la izquierda (Ámbito, Filtros, Mapa base, Información, Descargar, Compartir), "
              "mapa al centro con el aviso del centroide e Indicadores a la derecha. El fondo es una tesela lisa "
              "de la demo." + _FICT + _OFI),
    "territorio": ("01b-vis-territorio.png", "Modal Territorio",
                   "Región con su año de catastro y superficie; la lista se desplaza dentro de 240 px (H-02)." + _FICT),
    "filtro": ("01c-vis-filtro-uso.png", "Modal de un filtro: Uso",
               "Las clases de uso con su color y su superficie en el ámbito; se marcan varias." + _FICT),
    "base": ("01d-vis-mapa-base.png", "Modal Imagen de fondo",
             "Las siete capas de fondo. En la demo no hay red: las teselas se reemplazan por una lisa."),
    "ficha": ("01e-vis-ficha.png", "Ficha de un polígono",
              "Abierta al pulsar un punto con el ámbito Metropolitana › Santiago." + _FICT),
    "indicadores": ("02-vis-indicadores-region.png", "Indicadores de una región",
                    "Con ?reg=13: superficie, polígonos y composición del ámbito." + _FICT),
    "informacion": ("03-vis-informacion.png", "Modal Información",
                    "Cómo leer el visor: filtros, tamaño de los puntos, colores, origen de los datos y Metodología."),
    "descargar": ("04-vis-descargar.png", "Modal Descargar",
                  "Reporte del ámbito (PDF), Cifras del ámbito (CSV), Polígonos en CSV y GeoJSON y el enlace al "
                  "manifest.json." + _FICT),
    "reporte": ("04b-vis-reporte.png", "Reporte del ámbito",
                "Vista del reporte con «← Cerrar» y «Exportar PDF». Los controles del mapa que se ven encima son "
                "probablemente un artefacto de la captura (H-08)." + _FICT),
    "compartir": ("05-vis-compartir.png", "Modal Compartir",
                  "Enlace de la vista con ámbito comunal y, debajo, el enlace a la página de esa comuna."),
    "regiones": ("06-vis-cifras-regiones.png", "Cifras del Catastro por región y comuna",
                 "Índice de las páginas estáticas, generado con build:web sobre los datos ficticios."),
    "region": ("06b-vis-cifras-region.png", "Página de una región",
               "Región Metropolitana de Santiago: frase citable y tablas." + _FICT + _OFI),
    "comuna": ("06c-vis-cifras-comuna.png", "Página de una comuna", "Comuna de Santiago." + _FICT),
    "oscuro": ("07-vis-visor-oscuro.png", "Visor en tema oscuro",
               "El tema sigue la preferencia del sistema operativo (RN-13)." + _FICT),
}

POR_ROL = {"usuario_visor": list(CATALOGO)}

POR_FUNCIONALIDAD = {
    ("usuario_visor", "Ingresar al visor"): "visor",
    ("usuario_visor", "Consultar el mapa del Catastro"): "territorio",
    ("usuario_visor", "Consultar los indicadores"): "indicadores",
    ("usuario_visor", "Consultar la información"): "informacion",
    ("usuario_visor", "Descargar el reporte del ámbito"): "reporte",
    ("usuario_visor", "Descargar las cifras del ámbito"): "descargar",
    ("usuario_visor", "Compartir"): "compartir",
    ("usuario_visor", "Consultar las cifras por región y comuna"): "regiones",
}

POR_CASO = {
    "UC-04": "filtro",
    "UC-05": "base",
    "UC-06": "ficha",
    "UC-16": "region",
    "UC-17": "comuna",
}


def ruta(clave):
    if clave not in CATALOGO:
        return None
    r = os.path.join(DIR, CATALOGO[clave][0])
    return r if os.path.exists(r) else None


def titulo(clave):
    return CATALOGO[clave][1]


def pie(clave):
    return CATALOGO[clave][2]
