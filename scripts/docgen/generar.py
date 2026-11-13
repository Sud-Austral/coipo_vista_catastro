# -*- coding: utf-8 -*-
"""Genera los DOCX y el XLSX de docs/Documentacion_Sistema2 desde los módulos de datos."""
import os
import re
import unicodedata

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

from . import imagenes, rol_usuario_visor
from .comun import (FECHA, PV, RAIZ_DOC, VERSION, aviso, imagen, nuevo_documento, parrafo, pasos,
                    tabla, titulo, vinetas)
from .datos_base import (ACCESO, HALLAZGOS, HALLAZGOS_CAPTURAS, MATRIZ_ROLES, NEGATIVAS, REGLAS_NEGOCIO,
                         ROLES_NO_APLICABLES, SONDAS, SONDAS_URL)

MODULOS = [rol_usuario_visor]
DIR = {k: os.path.join(RAIZ_DOC, v) for k, v in (("analisis", "00_Analisis"), ("manuales", "01_Manuales"),
                                                ("casos", "02_Casos_de_Uso"), ("qa", "03_QA"),
                                                ("traz", "04_Trazabilidad"))}

GLOSARIO = [
    ["Catastro", "Catastro de Usos de la Tierra y Recursos Vegetacionales de CONAF: polígonos clasificados por uso, con sus atributos de vegetación."],
    ["Polígono / punto", "Cada polígono del Catastro se dibuja como un punto en su centroide (RN-03)."],
    ["Ámbito", "El territorio activo: todo Chile, una región, una provincia o una comuna."],
    ["Uso / Subclase", "Clase y subclase de uso de la tierra (9 clases)."],
    ["Tipo y subtipo forestal", "Clasificación del bosque nativo."],
    ["SNASPE", "Sistema Nacional de Áreas Silvestres Protegidas del Estado."],
    ["SIMEF", "Sistema Integrado de Monitoreo de Ecosistemas Forestales: fuente distinta del Catastro."],
    ["Manifest", "manifest.json: índice de los datos publicados, con vocabularios y cifras."],
    ["CSV / GeoJSON", "Formatos de descarga: planilla y capa geográfica."],
    [PV, "Información que no pudo determinarse leyendo el sistema y requiere confirmación."],
]

def _d(k):
    os.makedirs(DIR[k], exist_ok=True)
    return DIR[k]


def sin_tildes(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


def categoria(c):
    t = sin_tildes(c["nombre"] + " " + c["descripcion"])
    if "seguridad" in t or "intentar" in t or "inexistente" in t:
        return "Seguridad"
    if "ingresar" in t:
        return "Acceso"
    if "descargar" in t or "reporte" in t:
        return "Descargas"
    if "compartir" in t or "pagina" in t:
        return "Difusión"
    return "Consulta"

# ------------------------------------------------------------------ cobertura
def cobertura():
    """Por funcionalidad: casos que la declaran, casos cuyo flujo nombra su rótulo y si todos son de error."""
    filas = []
    for mod in MODULOS:
        for f in mod.ROL["funcionalidades"]:
            casos = [c for c in mod.CASOS if c["traz"][1] == f["nombre"]]
            rot = sin_tildes(mod.ROTULOS[f["nombre"]])
            nombran = [c["id"] for c in casos if rot in sin_tildes(" ".join(c["flujo"]))]
            solo_error = bool(casos) and all(categoria(c) == "Seguridad" for c in casos)
            filas.append([mod.ROL["nombre"], f["nombre"], mod.ROTULOS[f["nombre"]], len(casos),
                          ", ".join(c["id"] for c in casos), ", ".join(nombran) or "NINGUNO",
                          "Sí" if solo_error else "No"])
    return filas


def validar():
    """Validaciones por script (sección 8.3 del prompt). Devuelve la lista de errores."""
    err = []
    archivos = {v[0] for v in imagenes.CATALOGO.values()}
    en_disco = set(os.listdir(imagenes.DIR)) if os.path.isdir(imagenes.DIR) else set()
    err += ["captura sin archivo: %s" % a for a in sorted(archivos - en_disco)]
    err += ["archivo sin clave: %s" % a for a in sorted(en_disco - archivos)]
    ids_rn = [r[0] for r in REGLAS_NEGOCIO]
    if len(ids_rn) != len(set(ids_rn)):
        err.append("ids de regla duplicados")
    for mod in MODULOS:
        nombres = {f["nombre"] for f in mod.ROL["funcionalidades"]}
        ids = [c["id"] for c in mod.CASOS]
        if len(ids) != len(set(ids)):
            err.append("ids de caso duplicados")
        err += ["CAMPOS huérfano: %s" % k for k in mod.CAMPOS if k not in nombres]
        err += ["ROTULOS huérfano: %s" % k for k in mod.ROTULOS if k not in nombres]
        err += ["%s: funcionalidad inexistente %s" % (c["id"], c["traz"][1]) for c in mod.CASOS if c["traz"][1] not in nombres]
        err += ["%s cita regla indefinida %s" % (c["id"], r) for c in mod.CASOS for r in c["rn"] if r not in ids_rn]
        for (rol, fn), clave in imagenes.POR_FUNCIONALIDAD.items():
            if fn not in nombres or clave not in imagenes.CATALOGO:
                err.append("mapeo de imagen roto: %s" % fn)
        err += ["POR_CASO con caso inexistente: %s" % k for k in imagenes.POR_CASO if k not in ids]
        claves = ["id", "nombre", "objetivo", "descripcion", "permisos", "precondiciones", "entradas", "flujo",
                  "resultado", "fa", "fe", "rn", "validaciones", "datos", "traz", "verifica"]
        err += ["%s sin clave %s" % (c["id"], k) for c in mod.CASOS for k in claves if k not in c]
    return err


# ------------------------------------------------------------------ análisis
def generar_analisis():
    doc = nuevo_documento("Análisis del sistema y matriz de roles", "Todos los roles", "Análisis funcional",
                          "Roles, permisos, reglas, hallazgos y cobertura. Es el documento de partida: el manual "
                          "y los casos de uso derivan de aquí.")
    titulo(doc, "1. El sistema", 1)
    parrafo(doc, "Visor público del Catastro de Usos de la Tierra y Recursos Vegetacionales de CONAF, publicado en "
                 "GitHub Pages. Es un sitio estático: no tiene backend, ni base de datos, ni sesión. Un ETL fuera del "
                 "sitio genera un binario columnar con los 1.827.933 polígonos (sus centroides) y un manifest; el "
                 "navegador los descarga y hace todo el cálculo (filtros, cifras, reporte y descargas).")
    tabla(doc, ["Aspecto", "Detalle"], [
        ["Pantallas", "Visor (panel de control, mapa, indicadores, ficha, modales), reporte imprimible y páginas "
                      "estáticas por región y comuna"],
        ["Autenticación", "Ninguna: sitio público (RN-01)"],
        ["Datos", "frontend/public/datos (manifest.json, cbn_puntos.bin, oficiales.json, simef.json), generados por "
                  "ETL/build_bin.py y commiteados"],
        ["Integraciones", "Teselas de mapa base de terceros; enlaces a Google Maps y Google Earth; Umami (sin identificador, H-06)"],
        ["Escritura", "Ninguna desde la interfaz"],
        ["Publicación", ".github/workflows/deploy.yml: datos → build → deploy → humo"],
    ], anchos=[4, 12])
    imagen(doc, "visor", ancho_cm=15)

    titulo(doc, "1 bis. Qué cambió desde la versión anterior", 1)
    parrafo(doc, "No hay versión anterior: esta es la primera versión del paquete documental en este repositorio "
                 "(no existía docs/Documentacion_Sistema). Se generó el %s desde el código de la rama manueales2, "
                 "creada desde origin/main (commit 351a4ae). El árbol estaba limpio (git status sin cambios)." % FECHA)
    tabla(doc, ["Fecha", "Cambio", "Dónde está el detalle"], [
        [FECHA, "Primera versión: manual, casos de uso, checklist QA, trazabilidad, capturas y PDF", "README.md del paquete"],
    ], anchos=[2.5, 9, 4.5])

    titulo(doc, "2. Matriz de roles", 1)
    tabla(doc, ["Rol", "Descripción", "Acceso", "Funcionalidades principales", "Restricciones"], MATRIZ_ROLES,
          anchos=[2.6, 3, 3, 4, 3.4])
    titulo(doc, "3. Roles que NO se documentan como perfiles de uso", 1)
    tabla(doc, ["Nombre", "Qué es", "Por qué no aplica"], ROLES_NO_APLICABLES, anchos=[3.5, 4.5, 8])

    titulo(doc, "4. Matriz de permisos por acción", 1)
    parrafo(doc, "Con un solo rol y sin sesión, la matriz se reduce a qué puede hacer cualquiera que abra el visor:")
    tabla(doc, ["Acción", "Usuario del visor", "Dónde se decide"], [
        ["Ver el mapa, filtrar, leer indicadores y fichas", "Sí", "Sitio estático: no hay control de acceso"],
        ["Emitir el reporte y descargar CSV, GeoJSON y manifest.json", "Sí", "SeccionDescargas.jsx"],
        ["Leer las páginas por región y comuna", "Sí", "scripts/web.mjs (generadas al publicar)"],
        ["Escribir, editar o borrar cualquier dato", "No existe la acción", "No hay backend"],
        ["Regenerar o publicar los datos", "No (fuera del sitio)", "ETL/build_bin.py; deploy.yml"],
    ], anchos=[6, 3.5, 6.5])

    titulo(doc, "5. Estados", 1)
    parrafo(doc, "Los polígonos no tienen estados de trámite. Lo que tiene estado es la carga del visor:")
    tabla(doc, ["Estado", "Cuándo", "Qué muestra el visor"], [
        ["Descargando", "Llegó el manifest y baja el .bin", "Portada con cifras nacionales y «Descargando el Catastro nacional…»"],
        ["Listo", "El .bin llegó y cuadra con el manifest", "Panel, mapa e Indicadores"],
        ["Error de datos", "Manifest de otro esquema, .bin de otro tamaño o falla de red (RN-02)",
         "«No se pudieron cargar los datos del mapa.» con «Detalle técnico» y la portada"],
    ], anchos=[3.5, 5.5, 7])

    titulo(doc, "6. Reglas de negocio", 1)
    tabla(doc, ["ID", "Regla", "Descripción", "Dónde vive"], REGLAS_NEGOCIO, anchos=[1.5, 3, 7.5, 4])

    titulo(doc, "7. Hallazgos y puntos por validar", 1)
    aviso(doc, "Leerlos ANTES de ejecutar el checklist: condicionan qué pruebas son concluyentes.")
    tabla(doc, ["ID", "Severidad", "Hallazgo", "Estado y evidencia", "Efecto"], HALLAZGOS, anchos=[1.3, 1.8, 6, 4.4, 2.5])
    titulo(doc, "7 bis. Hallazgos encontrados al capturar las pantallas", 1)
    parrafo(doc, "Salen de mirar la aplicación funcionando con la demo, no de leer el código.")
    tabla(doc, ["ID", "Severidad", "Hallazgo", "Estado y evidencia", "Efecto"], HALLAZGOS_CAPTURAS, anchos=[1.3, 1.8, 6, 4.4, 2.5])
    imagen(doc, "ficha", ancho_cm=14)

    titulo(doc, "7 ter. Sondas fijas ejecutadas", 1)
    parrafo(doc, "Corridas el %s contra el visor compilado con datos ficticios (scripts/demo_datos.py), servido "
                 "por un servidor estático local y Chrome sin red. Nunca contra el sitio publicado." % FECHA)
    tabla(doc, ["Sonda", "Qué se intentó", "Resultado"], SONDAS, anchos=[3.5, 6.5, 6])
    parrafo(doc, "Resultado observado de cada valor fuera de vocabulario en la dirección:")
    tabla(doc, ["Dirección", "Qué mostró el visor", "Juicio"], SONDAS_URL, anchos=[4.5, 7.5, 4])

    titulo(doc, "8. Cobertura", 1)
    filas = cobertura()
    total_f = len(filas)
    con_caso = sum(1 for f in filas if f[3] > 0)
    nombran = sum(1 for f in filas if f[5] != "NINGUNO")
    tabla(doc, ["Indicador", "Valor"], [
        ["Roles documentados", len(MODULOS)],
        ["Funcionalidades", total_f],
        ["Casos de uso", sum(len(m.CASOS) for m in MODULOS)],
        ["Funcionalidades con al menos un caso", "%d de %d" % (con_caso, total_f)],
        ["Funcionalidades cuyo rótulo aparece en el flujo de algún caso", "%d de %d" % (nombran, total_f)],
        ["Funcionalidades cuyo único caso es de seguridad o error", sum(1 for f in filas if f[6] == "Sí")],
        ["Capturas", len(imagenes.CATALOGO)],
    ], anchos=[10, 6])
    parrafo(doc, "La cobertura se calcula: cruce por la funcionalidad que declara cada caso y, para que no sea "
                 "tautológica, búsqueda del rótulo de la app en el flujo del caso (sin tildes).")
    tabla(doc, ["Rol", "Funcionalidad", "Rótulo", "Casos", "IDs", "Flujo nombra el rótulo", "Solo error"], filas,
          anchos=[2.2, 3.8, 2.2, 1.2, 2.6, 2.4, 1.6])
    ruta = os.path.join(_d("analisis"), "Analisis_y_Matriz_de_Roles.docx")
    doc.save(ruta)
    return ruta


# ------------------------------------------------------------------ manual
def generar_manual(mod):
    rol = mod.ROL
    doc = nuevo_documento("Manual de Usuario", rol["nombre"], "Manual de Usuario", rol["resumen"])
    titulo(doc, "1. Objetivo del manual", 1)
    parrafo(doc, rol["objetivo"])
    titulo(doc, "2. Alcance", 1)
    parrafo(doc, "Este manual cubre:")
    vinetas(doc, rol["alcance"])
    parrafo(doc, "Queda fuera:")
    vinetas(doc, rol["fuera_alcance"])
    titulo(doc, "Novedades de la versión %s (%s)" % (VERSION, FECHA), 2)
    tabla(doc, ["Qué cambió", "Qué significa para este rol"], [
        ["Primera versión del manual", "No hay versión anterior: todo lo descrito es el comportamiento vigente."]],
        anchos=[6, 10])
    titulo(doc, "3. Requisitos de acceso", 1)
    parrafo(doc, "Forma de acceso: " + rol["acceso"])
    vinetas(doc, rol["requisitos"])
    titulo(doc, "4. Inicio de sesión", 1)
    parrafo(doc, "El visor no tiene inicio de sesión ni cierre de sesión. Se ingresa así:")
    primera = rol["funcionalidades"][0]
    pasos(doc, primera["pasos"])
    parrafo(doc, "Resultado esperado: " + primera["resultado"])
    titulo(doc, "5. Problemas de acceso", 1)
    parrafo(doc, "Como no hay credenciales, un problema de acceso es de red o de publicación: si la página no carga, "
                 "avisar a soporte. Si carga pero dice «No se pudieron cargar los datos del mapa.», abrir «Detalle "
                 "técnico» y recargar con Ctrl+Shift+R.")
    titulo(doc, "6. Interfaz principal", 1)
    tabla(doc, ["Elemento", "Descripción"], rol["interfaz"], anchos=[4, 12])
    titulo(doc, "7. Recorrido de pantallas", 1)
    parrafo(doc, "Capturas del visor compilado con datos FICTICIOS: 40.000 puntos generados al azar dentro del "
                 "recuadro de cada comuna, con los vocabularios reales. Ninguna cifra de superficie ni de polígonos "
                 "es del Catastro.")
    for clave in imagenes.POR_ROL.get(rol["clave"], []):
        imagen(doc, clave)
    titulo(doc, "8. Funcionalidades", 1)
    for i, f in enumerate(rol["funcionalidades"], start=1):
        titulo(doc, "8.%d %s" % (i, f["nombre"]), 2)
        parrafo(doc, "Objetivo: " + f["objetivo"])
        parrafo(doc, "Quién puede utilizarla: " + f["quien"])
        if f["precondiciones"]:
            parrafo(doc, "Precondiciones:", negrita=True); vinetas(doc, f["precondiciones"])
        clave = imagenes.POR_FUNCIONALIDAD.get((rol["clave"], f["nombre"]))
        if clave:
            imagen(doc, clave, ancho_cm=14, con_titulo=False)
        parrafo(doc, "Pasos:", negrita=True); pasos(doc, f["pasos"])
        parrafo(doc, "Resultado esperado:", negrita=True); parrafo(doc, f["resultado"])
        campos = mod.CAMPOS.get(f["nombre"])
        if campos:
            parrafo(doc, "Campos de la pantalla:", negrita=True)
            tabla(doc, ["Campo", "¿Obligatorio?", "Regla", "Notas"], campos, anchos=[3.6, 2.2, 5.2, 5])
        for etiqueta, k in (("Validaciones:", "validaciones"), ("Consideraciones:", "consideraciones"),
                            ("Restricciones:", "restricciones"), ("Flujos alternativos:", "alternativos")):
            if f[k]:
                parrafo(doc, etiqueta, negrita=True); vinetas(doc, f[k])
        if f["errores"]:
            parrafo(doc, "Mensajes:", negrita=True)
            tabla(doc, ["Mensaje", "Cuándo aparece"], f["errores"], anchos=[7, 9])
    titulo(doc, "9. Archivos que usa este rol", 1)
    parrafo(doc, "No hay API: el navegador pide archivos estáticos, relativos a la dirección del visor.")
    tabla(doc, ["Método", "Archivo", "Para qué", "Quién puede"], mod.ENDPOINTS, anchos=[1.8, 6, 5.5, 2.7])
    titulo(doc, "10. Mensajes de carga", 1)
    tabla(doc, ["Mensaje", "Significado", "Qué hacer"], [
        ["Descargando el Catastro nacional…", "Bajan los datos del mapa", "Esperar"],
        ["No se pudieron cargar los datos del mapa.", "Los datos no llegaron o no cuadran (RN-02)", "Ver «Detalle técnico»; recargar con Ctrl+Shift+R"],
        ["No disponible: los datos aún se están descargando.", "Descarga pedida antes de tiempo (RN-10)", "Esperar"],
    ], anchos=[6, 5, 5])
    titulo(doc, "11. Errores frecuentes", 1)
    tabla(doc, ["Problema", "Causa probable", "Solución"], rol["errores_frecuentes"], anchos=[5, 5.5, 5.5])
    titulo(doc, "12. Buenas prácticas", 1)
    vinetas(doc, rol["buenas_practicas"])
    titulo(doc, "13. Preguntas frecuentes", 1)
    tabla(doc, ["Pregunta", "Respuesta"], rol["faq"], anchos=[6, 10])
    titulo(doc, "14. Glosario", 1)
    tabla(doc, ["Término", "Significado"], GLOSARIO, anchos=[4, 12])
    ruta = os.path.join(_d("manuales"), "Manual_%s.docx" % rol["archivo"])
    doc.save(ruta)
    return ruta


# ------------------------------------------------------------------ casos
def generar_casos(mod):
    rol = mod.ROL
    doc = nuevo_documento("Casos de Uso", rol["nombre"], "Casos de Uso",
                          "Casos de uso derivados de las funcionalidades reales. Total: %d casos." % len(mod.CASOS))
    titulo(doc, "1. Resumen de casos de uso", 1)
    tabla(doc, ["ID", "Nombre", "Funcionalidad", "Categoría"],
          [[c["id"], c["nombre"], c["traz"][1], categoria(c)] for c in mod.CASOS], anchos=[1.6, 6.4, 5, 3])
    titulo(doc, "2. Reglas de negocio referenciadas", 1)
    usadas = {r for c in mod.CASOS for r in c["rn"]}
    tabla(doc, ["ID", "Regla", "Descripción", "Dónde vive"], [r for r in REGLAS_NEGOCIO if r[0] in usadas],
          anchos=[1.5, 3, 7.5, 4])
    titulo(doc, "3. Casos de uso", 1)
    for c in mod.CASOS:
        titulo(doc, "%s - %s" % (c["id"], c["nombre"]), 2)
        tabla(doc, ["Campo", "Valor"], [["Actor principal", rol["nombre"]], ["Actores secundarios", c["secundarios"]],
                                        ["Categoría", categoria(c)], ["Permisos requeridos", c["permisos"]]], anchos=[4, 12])
        parrafo(doc, "Objetivo: " + c["objetivo"])
        clave = imagenes.POR_CASO.get(c["id"])
        if clave:
            imagen(doc, clave, ancho_cm=13, con_titulo=False)
        parrafo(doc, "Precondiciones:", negrita=True); vinetas(doc, c["precondiciones"])
        parrafo(doc, "Datos de entrada:", negrita=True); vinetas(doc, c["entradas"] or ["Ninguno"])
        parrafo(doc, "Flujo principal:", negrita=True); pasos(doc, c["flujo"])
        parrafo(doc, "Resultado esperado:", negrita=True); parrafo(doc, c["resultado"])
        if c["fa"]:
            parrafo(doc, "Flujos alternativos:", negrita=True); tabla(doc, ["ID", "Descripción"], c["fa"], anchos=[2, 14])
        if c["fe"]:
            parrafo(doc, "Flujos de excepción:", negrita=True); tabla(doc, ["ID", "Descripción"], c["fe"], anchos=[2, 14])
        if c["rn"]:
            parrafo(doc, "Reglas de negocio involucradas: " + ", ".join(c["rn"]))
        if c["verifica"]:
            parrafo(doc, "Verificación: " + c["verifica"], cursiva=True)
        parrafo(doc, "Datos generados o modificados: " + c["datos"])
        parrafo(doc, "Trazabilidad:", negrita=True)
        tabla(doc, ["Módulo", "Funcionalidad", "Pantalla", "Servicio", "Tablas"], [c["traz"]], anchos=[2.4, 3.6, 3, 4.4, 2.6])
    ruta = os.path.join(_d("casos"), "Casos_Uso_%s.docx" % rol["archivo"])
    doc.save(ruta)
    return ruta


# ------------------------------------------------------------------ QA
def generar_qa():
    doc = nuevo_documento("Checklist de QA", "Todos los roles", "Checklist QA",
                          "Una ficha por caso de uso, más pruebas negativas y de acceso. Todas parten en NOT TESTED.")
    titulo(doc, "1. Cómo se usa este documento", 1)
    parrafo(doc, "Ejecutar cada ficha en un ambiente de pruebas (nunca en producción), anotar el resultado obtenido "
                 "y el estado. Leer antes los hallazgos de la sección 7 del análisis.")
    titulo(doc, "2. Estados permitidos", 1)
    tabla(doc, ["Estado", "Cuándo se usa"], [["OK", "El resultado coincide con el esperado"],
                                              ["FALLA", "No coincide; registrar evidencia"],
                                              ["BLOQUEADO", "No se pudo ejecutar por una precondición"],
                                              ["NOT TESTED", "Aún no se ejecuta (estado inicial)"]], anchos=[4, 12])
    titulo(doc, "3. Identificación de la ejecución", 1)
    tabla(doc, ["Campo", "Valor"], [["Probador", ""], ["Fecha", ""], ["Ambiente y URL", ""], ["Commit o versión", ""],
                                    ["Navegador", ""]], anchos=[5, 11])
    casos = [(m.ROL["nombre"], c) for m in MODULOS for c in m.CASOS]
    titulo(doc, "4. Matriz de ejecución", 1)
    tabla(doc, ["ID", "Caso de uso", "Resultado esperado", "Estado"],
          [[c["id"], c["nombre"], c["resultado"], "NOT TESTED"] for _r, c in casos], anchos=[1.6, 5, 7, 2.4])
    titulo(doc, "5. Fichas de prueba", 1)
    for rol, c in casos:
        titulo(doc, "QA-%s - %s" % (c["id"], c["nombre"]), 2)
        tabla(doc, ["Campo", "Valor"], [["Rol", rol], ["Funcionalidad", c["traz"][1]],
                                        ["Reglas", ", ".join(c["rn"]) or "—"], ["Estado inicial", "NOT TESTED"]], anchos=[4, 12])
        parrafo(doc, "Precondiciones:", negrita=True); vinetas(doc, c["precondiciones"])
        parrafo(doc, "Pasos:", negrita=True); pasos(doc, c["flujo"])
        parrafo(doc, "Resultado esperado: " + c["resultado"])
        tabla(doc, ["Campo", "A completar por el probador"], [["Resultado obtenido", ""], ["Estado", ""],
                                                              ["Evidencia", ""], ["Observaciones", ""]], anchos=[4, 12])
    titulo(doc, "6. Pruebas negativas transversales", 1)
    tabla(doc, ["N", "Prueba negativa", "Estado", "Observación"],
          [[i, n, "NOT TESTED", ""] for i, n in enumerate(NEGATIVAS, 1)], anchos=[1, 9, 2.5, 3.5])
    titulo(doc, "7. Pruebas de acceso sin sesión", 1)
    parrafo(doc, "No hay proveedor de identidad (ni IAM ni Clave Única): en su lugar se prueba que el acceso abierto "
                 "es el que se decidió y que no hay pantallas ocultas.")
    tabla(doc, ["ID", "Prueba", "Resultado esperado", "Estado"], [a + ["NOT TESTED"] for a in ACCESO], anchos=[2, 6, 6, 2])
    titulo(doc, "8. Pruebas de concurrencia", 1)
    tabla(doc, ["ID", "Escenario", "Resultado esperado", "Estado"], [
        ["QA-CC-01", "Abrir el visor durante un despliegue nuevo", "Se ve la versión anterior o la nueva completa; nunca un manifest nuevo con un .bin viejo (RN-02)", "NOT TESTED"],
        ["QA-CC-02", "Dos pestañas con ámbitos distintos", "Cada una conserva su ámbito y su dirección", "NOT TESTED"],
    ], anchos=[2, 6, 6, 2])
    titulo(doc, "9. Resumen de la ejecución", 1)
    tabla(doc, ["Indicador", "Valor"], [["Fichas", len(casos)], ["OK", ""], ["FALLA", ""], ["BLOQUEADO", ""],
                                        ["NOT TESTED", len(casos)]], anchos=[8, 8])
    ruta = os.path.join(_d("qa"), "Checklist_QA_Casos_de_Uso.docx")
    doc.save(ruta)
    return ruta


# ------------------------------------------------------------------ XLSX
def _hoja(wb, nombre, cab, filas, anchos):
    ws = wb.create_sheet(nombre)
    ws.append(cab)
    for f in filas:
        ws.append([("" if v is None else v) for v in f])
    for i, a in enumerate(anchos, 1):
        ws.column_dimensions[get_column_letter(i)].width = a
    for c in ws[1]:
        c.font = Font(bold=True); c.fill = PatternFill("solid", fgColor="E8F0E8")
    for fila in ws.iter_rows(min_row=2):
        for c in fila:
            c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    return ws


def generar_trazabilidad():
    wb = Workbook(); wb.remove(wb.active)
    casos = [(m, c) for m in MODULOS for c in m.CASOS]
    _hoja(wb, "Trazabilidad", ["ID", "Rol", "Caso", "Módulo", "Funcionalidad", "Pantalla", "Servicio", "Tablas", "Reglas"],
          [[c["id"], m.ROL["nombre"], c["nombre"], *c["traz"], ", ".join(c["rn"])] for m, c in casos],
          [8, 16, 40, 12, 30, 20, 40, 18, 18])
    ws = _hoja(wb, "Checklist", ["ID", "Caso", "Resultado esperado", "Estado", "Probador", "Fecha", "Observación"],
               [[c["id"], c["nombre"], c["resultado"], "NOT TESTED", "", "", ""] for _m, c in casos],
               [8, 40, 50, 14, 16, 12, 30])
    dv = DataValidation(type="list", formula1='"OK,FALLA,BLOQUEADO,NOT TESTED"', allow_blank=False)
    ws.add_data_validation(dv); dv.add("D2:D%d" % (len(casos) + 1))
    _hoja(wb, "Funcionalidades", ["Rol", "Funcionalidad", "Rótulo", "Casos", "IDs", "Flujo nombra el rótulo", "Solo error"],
          cobertura(), [16, 38, 22, 8, 24, 22, 10])
    _hoja(wb, "Archivos", ["Método", "Archivo", "Para qué", "Quién puede"], rol_usuario_visor.ENDPOINTS, [8, 44, 44, 14])
    _hoja(wb, "Reglas", ["ID", "Regla", "Descripción", "Dónde vive"], REGLAS_NEGOCIO, [8, 26, 70, 36])
    _hoja(wb, "Hallazgos", ["ID", "Severidad", "Hallazgo", "Estado y evidencia", "Efecto"],
          HALLAZGOS + HALLAZGOS_CAPTURAS, [7, 14, 70, 50, 30])
    _hoja(wb, "Sondas", ["Sonda", "Qué se intentó", "Resultado"], SONDAS + [["Dirección " + a, b, c] for a, b, c in SONDAS_URL], [24, 60, 60])
    _hoja(wb, "Roles", ["Rol", "Descripción", "Acceso", "Funcionalidades", "Restricciones"], MATRIZ_ROLES, [18, 40, 40, 40, 40])
    ruta = os.path.join(_d("traz"), "Matriz_Trazabilidad.xlsx")
    wb.save(ruta)
    return ruta
