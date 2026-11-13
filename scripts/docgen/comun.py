# -*- coding: utf-8 -*-
"""Constantes del paquete y helpers de formato de los DOCX de docs/Documentacion_Sistema2.

Todo lo visual vive acá para que el manual, los casos de uso, el análisis y el QA
salgan iguales entre sí. Modelo: el generador de COIPO_ENTREGA_PLANTA
(scripts/docgen/comun.py), adaptado a un sitio estático sin sesión ni backend (modelo directo: coipo_firms).
"""
import os

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

# Una sola constante para la raíz de salida: la usan el generador, las capturas y el PDF.
RAIZ_DOC = os.path.join("docs", "Documentacion_Sistema2")
SISTEMA = "COIPO — Visor del Catastro de Usos de la Tierra y Recursos Vegetacionales"
VERSION = "1.0"
FECHA = "2026-11-13"          # salida de `date` el día de la generación
# Primera versión del paquete en este repositorio: no hay v1. La carpeta se llama
# Documentacion_Sistema2 por la convención de la flota (prompt v4), no porque exista otra.
CONTROL_CAMBIOS = [
    [VERSION, FECHA, "Generado desde el código fuente (scripts/generar_documentacion.py)",
     "Primera versión del paquete en este repositorio. No existe una versión anterior "
     "(no hay docs/Documentacion_Sistema): todo el contenido es nuevo y se derivó de "
     "frontend/src (App.jsx, componentes, filtros.js, urlState.js) y frontend/scripts/web.mjs."],
]
PV = "[POR VALIDAR]"
VERDE = RGBColor(0x1B, 0x5E, 0x20)
GRIS = RGBColor(0x55, 0x55, 0x55)


def _campo(parrafo, instruccion):
    run = parrafo.add_run()
    ini = OxmlElement("w:fldChar"); ini.set(qn("w:fldCharType"), "begin")
    ins = OxmlElement("w:instrText"); ins.set(qn("xml:space"), "preserve"); ins.text = instruccion
    sep = OxmlElement("w:fldChar"); sep.set(qn("w:fldCharType"), "separate")
    txt = OxmlElement("w:t"); txt.text = "Actualizar campo (F9)"
    fin = OxmlElement("w:fldChar"); fin.set(qn("w:fldCharType"), "end")
    for nodo in (ini, ins, sep, txt, fin):
        run._r.append(nodo)


def nuevo_documento(titulo_doc, rol, tipo_doc, resumen):
    doc = Document()
    estilo = doc.styles["Normal"]
    estilo.font.name = "Calibri"
    estilo.font.size = Pt(10.5)
    sec = doc.sections[0]
    sec.left_margin = sec.right_margin = Cm(2.2)

    enc = sec.header.paragraphs[0]
    enc.text = f"{SISTEMA} · {tipo_doc} · {rol}"
    enc.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    for r in enc.runs:
        r.font.size = Pt(8); r.font.color.rgb = GRIS
    pie = sec.footer.paragraphs[0]
    pie.alignment = WD_ALIGN_PARAGRAPH.CENTER
    pie.add_run(f"v{VERSION} · {FECHA} · Página ")
    _campo(pie, "PAGE")
    pie.add_run(" de ")
    _campo(pie, "NUMPAGES")
    for r in pie.runs:
        r.font.size = Pt(8); r.font.color.rgb = GRIS

    doc.add_paragraph()
    for texto, tam, color, negrita in (("CONAF", 26, VERDE, True), (SISTEMA, 13, None, False)):
        p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(texto); r.bold = negrita; r.font.size = Pt(tam)
        if color:
            r.font.color.rgb = color
    doc.add_paragraph()
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(titulo_doc); r.bold = True; r.font.size = Pt(20)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(f"Rol: {rol}"); r.font.size = Pt(14); r.font.color.rgb = VERDE
    doc.add_paragraph()
    tabla(doc, ["Campo", "Valor"], [
        ["Tipo de documento", tipo_doc], ["Rol documentado", rol], ["Versión", VERSION],
        ["Fecha", FECHA], ["Estado", "Vigente"],
        ["Dirigido a", "Usuarios finales, QA, soporte, analistas funcionales y auditoría"],
    ], anchos=[5, 11])
    p = doc.add_paragraph(); r = p.add_run(resumen); r.italic = True; r.font.color.rgb = GRIS
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    doc.add_heading("Control de cambios", level=1)
    tabla(doc, ["Versión", "Fecha", "Autor", "Descripción"], CONTROL_CAMBIOS, anchos=[2, 2.5, 5, 6.5])
    doc.add_heading("Índice", level=1)
    _campo(doc.add_paragraph(), r'TOC \o "1-3" \h \z \u')
    n = doc.add_paragraph()
    r = n.add_run("Si el índice aparece vacío, seleccionar todo (Ctrl+E) y pulsar F9. "
                  "La copia en PDF de _pdf/ ya lo trae calculado.")
    r.italic = True; r.font.size = Pt(8.5); r.font.color.rgb = GRIS
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    return doc


def tabla(doc, cabecera, filas, anchos=None):
    tb = doc.add_table(rows=1, cols=len(cabecera))
    tb.style = "Table Grid"
    for i, texto in enumerate(cabecera):
        celda = tb.rows[0].cells[i]
        celda.text = ""
        run = celda.paragraphs[0].add_run(str(texto)); run.bold = True; run.font.size = Pt(9)
        sombra = OxmlElement("w:shd"); sombra.set(qn("w:fill"), "E8F0E8")
        celda._tc.get_or_add_tcPr().append(sombra)
    for fila in filas:
        celdas = tb.add_row().cells
        for i, valor in enumerate(fila):
            celdas[i].text = ""
            run = celdas[i].paragraphs[0].add_run("" if valor is None else str(valor))
            run.font.size = Pt(9)
    if anchos:
        for fila in tb.rows:
            for i, ancho in enumerate(anchos):
                fila.cells[i].width = Cm(ancho)
    doc.add_paragraph()
    return tb


def parrafo(doc, texto, negrita=False, cursiva=False):
    p = doc.add_paragraph()
    r = p.add_run(texto); r.bold = negrita; r.italic = cursiva
    return p


def vinetas(doc, items):
    for item in items:
        doc.add_paragraph(str(item), style="List Bullet")


def _num_nuevo(doc):
    """Una instancia w:num nueva sobre la lista abstracta de «List Number», con
    startOverride=1: así cada lista numerada empieza en 1 y no sigue la cuenta del
    documento (una ficha de QA empezaba en el paso 179 en la v2 de otro repo)."""
    estilo = doc.styles["List Number"]
    num_id_estilo = estilo.element.pPr.numPr.numId.val
    numbering = doc.part.numbering_part.element
    abstracto = next(n for n in numbering.findall(qn("w:num"))
                     if n.get(qn("w:numId")) == str(num_id_estilo)).find(qn("w:abstractNumId")).get(qn("w:val"))
    usados = [int(n.get(qn("w:numId"))) for n in numbering.findall(qn("w:num"))]
    nuevo = max(usados) + 1
    num = OxmlElement("w:num"); num.set(qn("w:numId"), str(nuevo))
    a = OxmlElement("w:abstractNumId"); a.set(qn("w:val"), abstracto); num.append(a)
    lvl = OxmlElement("w:lvlOverride"); lvl.set(qn("w:ilvl"), "0")
    so = OxmlElement("w:startOverride"); so.set(qn("w:val"), "1"); lvl.append(so); num.append(lvl)
    numbering.append(num)
    return nuevo


def pasos(doc, items):
    num = _num_nuevo(doc)
    for item in items:
        p = doc.add_paragraph(str(item), style="List Number")
        pPr = p._p.get_or_add_pPr()
        numPr = OxmlElement("w:numPr")
        il = OxmlElement("w:ilvl"); il.set(qn("w:val"), "0")
        ni = OxmlElement("w:numId"); ni.set(qn("w:val"), str(num))
        numPr.append(il); numPr.append(ni); pPr.append(numPr)


def aviso(doc, texto):
    p = doc.add_paragraph()
    r = p.add_run(texto); r.bold = True; r.font.color.rgb = RGBColor(0xB7, 0x4A, 0x00)
    return p


def titulo(doc, texto, level=1):
    return doc.add_heading(texto, level=level)


def imagen(doc, clave, ancho_cm=15.5, con_titulo=True):
    from . import imagenes
    ruta = imagenes.ruta(clave)
    if not ruta:
        p = doc.add_paragraph()
        r = p.add_run("[Falta la captura '%s'. Regenerar con scripts/capturar_pantallas.py]" % clave)
        r.italic = True; r.font.color.rgb = RGBColor(0xB7, 0x4A, 0x00)
        return None
    if con_titulo:
        p = doc.add_paragraph(); r = p.add_run(imagenes.titulo(clave)); r.bold = True; r.font.size = Pt(9.5)
    doc.add_picture(ruta, width=Cm(ancho_cm))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(imagenes.pie(clave)); r.italic = True; r.font.size = Pt(8.5); r.font.color.rgb = GRIS
    return ruta
