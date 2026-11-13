# -*- coding: utf-8 -*-
"""Calcula el índice de cada DOCX, exporta una copia PDF y actualiza las cifras del README.

Usa Word por COM (índice y PDF) y PyMuPDF (páginas). Desde la raíz del repositorio:

    python scripts/exportar_pdf.py

Las cifras del README se escriben entre las marcas <!-- cifras --> y <!-- /cifras -->;
si las marcas no están exactamente una vez, se detiene sin tocar el archivo.
"""
import glob
import os
import sys

import fitz
import win32com.client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from docgen import imagenes  # noqa: E402
from docgen.comun import FECHA, RAIZ_DOC, VERSION  # noqa: E402
from docgen.generar import MODULOS, cobertura  # noqa: E402

RAIZ = os.path.abspath(RAIZ_DOC)
SALIDA = os.path.join(RAIZ, "_pdf")


def exportar():
    os.makedirs(SALIDA, exist_ok=True)
    # Instancia NUEVA y propia: el usuario puede tener Word abierto con su trabajo.
    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = False
    try:
        for ruta in sorted(glob.glob(os.path.join(RAIZ, "*", "*.docx"))):
            doc = word.Documents.Open(ruta)
            try:
                for i in range(1, doc.TablesOfContents.Count + 1):
                    doc.TablesOfContents(i).Update()
                doc.Fields.Update()
                doc.Save()
                doc.SaveAs(os.path.join(SALIDA, os.path.basename(ruta)[:-5] + ".pdf"), FileFormat=17)
            finally:
                doc.Close(False)
    finally:
        word.Quit()


def readme():
    paginas = {os.path.basename(p): fitz.open(p).page_count for p in sorted(glob.glob(os.path.join(SALIDA, "*.pdf")))}
    cob = cobertura()
    filas = [
        "| Indicador | Valor |", "|---|---|",
        "| Versión | %s (%s), primera del paquete en este repositorio |" % (VERSION, FECHA),
        "| Roles documentados | %d |" % len(MODULOS),
        "| Funcionalidades | %d |" % len(cob),
        "| Casos de uso (y fichas QA) | %d |" % sum(len(m.CASOS) for m in MODULOS),
        "| Funcionalidades con caso | %d de %d |" % (sum(1 for f in cob if f[3]), len(cob)),
        "| Capturas | %d |" % len(imagenes.CATALOGO),
        "| Páginas en PDF | %d |" % sum(paginas.values()),
    ] + ["| &nbsp;&nbsp;%s | %d páginas |" % (k, v) for k, v in paginas.items()]
    ruta = os.path.join(RAIZ, "README.md")
    texto = open(ruta, encoding="utf-8").read()
    a, b = "<!-- cifras -->", "<!-- /cifras -->"
    if texto.count(a) != 1 or texto.count(b) != 1:
        sys.exit("README: las marcas de cifras no están exactamente una vez; no se toca.")
    ini, fin = texto.index(a) + len(a), texto.index(b)
    open(ruta, "w", encoding="utf-8").write(texto[:ini] + "\n" + "\n".join(filas) + "\n" + texto[fin:])
    print("\n".join(filas))


if __name__ == "__main__":
    if "--solo-readme" not in sys.argv:
        exportar()
    readme()
