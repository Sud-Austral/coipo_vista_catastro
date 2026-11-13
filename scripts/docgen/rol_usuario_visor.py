# -*- coding: utf-8 -*-
"""Usuario del visor: el único rol con pantalla (sitio estático sin sesión ni roles).

Nombre del rol (prompt v4, 5 bis): no hay v1 y la app no muestra etiqueta de rol, porque
no tiene roles; se usa «Usuario del visor», el mismo nombre que la flota usa para el otro
visor público sin sesión (coipo_firms).
Funcionalidades: verbo + rótulo de la app (el rótulo va en ROTULOS y se comprueba en la
cobertura buscándolo, sin tildes, en el flujo de los casos).
"""
from .datos_base import ROL_NOMBRE

M = "Visor del Catastro"

# funcionalidad -> rótulo tal como lo muestra la app (dónde se leyó)
ROTULOS = {
    "Ingresar al visor": "Catastro de Usos de la Tierra",            # PanelLateral.jsx h1
    "Consultar el mapa del Catastro": "Mapa del Catastro",             # App.jsx:870 aria-label
    "Consultar los indicadores": "Indicadores",                        # PanelIndicadores.jsx h2
    "Consultar la información": "Información",                         # PanelLateral.jsx BotonControl info
    "Descargar el reporte del ámbito": "Reporte del ámbito (PDF)",     # SeccionDescargas.jsx:127
    "Descargar las cifras del ámbito": "Cifras del ámbito (CSV)",      # SeccionDescargas.jsx:131
    "Descargar los polígonos en CSV": "Polígonos",                     # SeccionDescargas.jsx:136-139
    "Descargar los polígonos en GeoJSON": "GeoJSON",                   # SeccionDescargas.jsx:141
    "Descargar el manifest.json": "manifest.json",                     # SeccionDescargas.jsx:161
    "Compartir": "Compartir",                                          # ModalesPanel.jsx:202
    "Consultar las cifras por región y comuna": "Cifras por región y comuna",  # PanelLateral.jsx enlace
}

_PRE_DESC = ["Visor abierto y datos descargados (los botones dejan de estar deshabilitados).",
             "Ámbito y filtros elegidos: la descarga los respeta (RN-05)."]


def _f(nombre, objetivo, pasos, resultado, pre=None, validaciones=(), errores=(), consideraciones=(),
       restricciones=(), alternativos=()):
    return {"nombre": nombre, "objetivo": objetivo, "quien": ROL_NOMBRE + " (cualquier persona, sin sesión).",
            "precondiciones": pre or ["Visor abierto."], "pasos": pasos, "resultado": resultado,
            "validaciones": list(validaciones), "errores": [list(e) for e in errores],
            "consideraciones": list(consideraciones), "restricciones": list(restricciones),
            "alternativos": list(alternativos)}


ROL = {
    "clave": "usuario_visor",
    "nombre": ROL_NOMBRE,
    "archivo": "Rol_Usuario_Visor",
    "resumen": "Manual de la persona que usa el visor público del Catastro de Usos de la Tierra y Recursos "
               "Vegetacionales: mapa, filtros, indicadores, reporte, descargas y páginas de cifras. El sitio no "
               "tiene sesión ni roles.",
    "acceso": "Abrir la dirección pública del visor (https://sud-austral.github.io/coipo_vista_catastro/). "
              "No hay login (RN-01).",
    "objetivo": "Explicar cómo consultar el Catastro de CONAF en el visor: elegir un territorio, filtrar por "
                "uso de la tierra, vegetación, especie y protección, leer los indicadores, abrir la ficha de un "
                "polígono, emitir el reporte en PDF, descargar los datos y compartir la vista.",
    "alcance": ["El mapa del Catastro con el ámbito territorial, los 19 filtros y el mapa base.",
                "El panel de Indicadores.", "El modal Información (cómo leer el visor y Metodología).",
                "El reporte del ámbito y las descargas CSV, GeoJSON y manifest.json.",
                "Compartir la vista.", "Las páginas de cifras por región y comuna."],
    "fuera_alcance": ["La generación de los datos (ETL) y su publicación (GitHub Actions): tareas sin pantalla.",
                      "La validación institucional de homologaciones y del estado de conservación (H-03, H-05).",
                      "La interpretación técnica del Catastro más allá de lo que explica la Metodología."],
    "requisitos": ["Navegador actualizado con JavaScript y WebGL (el mapa dibuja con deck.gl).",
                   "Conexión suficiente para bajar los datos del mapa (unos 49 MB la primera vez).",
                   "No se necesita cuenta, contraseña ni rol."],
    "interfaz": [
        ["Banda institucional", "Logos de CONAF, la Unidad de Información y Análisis y la Gerencia de fiscalización."],
        ["Panel de control (izquierda)", "Título «Catastro de Usos de la Tierra y Recursos Vegetacionales»; "
         "Ámbito (Territorio); Filtros (19 botones, cada uno con su cuenta de clases); Mapa base (Imagen de fondo); "
         "Información, Descargar y Compartir; enlace «Cifras por región y comuna». Se pliega con ×."],
        ["Mapa (centro)", "Un punto por polígono, coloreado por clase de uso; +/− para acercar; aviso del "
         "centroide con «Entendido»; atribución del fondo."],
        ["Indicadores (derecha)", "Superficie del ámbito, cuántos polígonos, parte bosque y secciones «De qué está "
         "hecho Chile», «Cuánto de Chile es bosque», tipos y subtipos forestales, densidad y altura del dosel, "
         "especies, «Dónde está», SNASPE, SIMEF y «De cuándo es cada dato». Se pliega con ×."],
        ["Ficha", "Al pulsar un punto: clase, subuso, estructura, tipo y subtipo forestal, densidad, altura, especie, "
         "área protegida, comuna, región con año y superficie; enlaces a Google Maps y Google Earth."],
        ["Teléfono", "Bajo 900 px los paneles pasan a cajón: «Abrir panel de control» (☰) e «Abrir indicadores»."],
    ],
    "funcionalidades": [
        _f("Ingresar al visor",
           "Abrir el visor. No hay puerta de ingreso: el sitio es público (RN-01).",
           ["Abrir la dirección del visor en el navegador.",
            "Mientras bajan los datos se lee la portada con las cifras nacionales y «Descargando el Catastro nacional…».",
            "Cuando terminan, aparece el panel «Catastro de Usos de la Tierra y Recursos Vegetacionales», el mapa y los Indicadores.",
            "Leer el aviso del centroide y pulsar «Entendido».",
            "Para salir, cerrar la pestaña: no hay sesión que cerrar."],
           "El visor con todo Chile, sin filtros, o con la vista que traiga la dirección (RN-11).",
           pre=["Conocer la dirección del visor."],
           errores=[["No se pudieron cargar los datos del mapa. El visor no puede dibujarlo sin ellos, así que "
                     "prefiere decirlo a fingir.", "El .bin o el manifest no llegaron o no cuadran (RN-02); "
                     "«Detalle técnico» muestra la causa."]],
           consideraciones=["Si el aviso dice que el archivo mide otro tamaño, recargar forzando la actualización "
                            "(Ctrl+Shift+R): es una copia vieja en caché."],
           alternativos=["Entrar con un enlace compartido que ya trae ámbito y filtros (?reg=…&com=…)."]),
        _f("Consultar el mapa del Catastro",
           "Ver dónde está cada clase de uso de la tierra y acotar el mapa a un territorio y a las clases que interesan.",
           ["En Ámbito, pulsar «Territorio» y elegir una región; luego, si se quiere, una provincia y una comuna. "
            "«Listo» cierra; «Volver a todo Chile» quita el ámbito.",
            "En Filtros, pulsar una dimensión (Uso, Subclase, Estructura, Tipo forestal, Subtipo, Cobertura, Altura, "
            "Especie, Grupo, Hábito, Arbórea, Origen, Invasora, Conservación, Protección, Tamaño, Año, SNASPE) y "
            "marcar las clases; la cifra de cada clase se recalcula con el ámbito y los demás filtros.",
            "«Quitar los N filtros» vuelve a todo.",
            "En Mapa base, pulsar «Imagen de fondo» y elegir Claro, Oscuro, Relieve, Calles, Topográfico, Satelital o Sentinel-2.",
            "Acercar con + o la rueda y pulsar un punto en el Mapa del Catastro: se abre la ficha del polígono.",
            "En la ficha, «Ver en Google Maps» o «Ver en Google Earth»; cerrar con × o Esc."],
           "Mapa, cuentas de los filtros e Indicadores muestran solo los polígonos del ámbito y de las clases marcadas.",
           validaciones=["Selección única en el territorio; múltiple en cada dimensión (RN-05).",
                         "Uso sin ninguna clase marcada equivale a todas (H-11); para las demás dimensiones la regla de los datos es «ninguna» (RN-04; no lo comprobé en pantalla)."],
           errores=[["No hay ninguna figura bajo la mira.", "Con teclado, Enter sobre el mapa sin un punto debajo "
                     "(aviso para lector de pantalla)."]],
           consideraciones=["Un punto es el centroide del polígono, no una parcela (RN-03).",
                            "Las regiones se catastraron en años distintos (RN-06).",
                            "Conservación: casi todas las especies figuran «Sin dato» (RN-12, H-03).",
                            "La lista de regiones se desplaza dentro de una caja de 240 px (H-02)."],
           restricciones=["Solo lectura."],
           alternativos=["Reproducir una vista abriendo su enlace (Compartir)."]),
        _f("Consultar los indicadores",
           "Leer las cifras del ámbito y de los filtros activos.",
           ["Mirar el panel Indicadores: superficie, número de polígonos y ámbito.",
            "Recorrer las secciones: «De qué está hecho Chile», «Cuánto de Chile es bosque», «Cómo es el bosque "
            "nativo por dentro», tipos y subtipos forestales, densidad y altura del dosel, especies dominantes, "
            "«Dónde está», «Qué hay dentro del SNASPE», SIMEF y «De cuándo es cada dato».",
            "Pulsar una clase de uso en «De qué está hecho Chile» para filtrar el mapa por ella.",
            "Cerrar o abrir el panel con × o «Abrir indicadores»."],
           "Cifras del mismo resumen que el mapa y el reporte.",
           consideraciones=["Las cifras de SIMEF son de otra fuente y otro período.",
                            "Con todo Chile y sin filtros se compara con la cifra oficial de CONAF (formato: H-01)."]),
        _f("Consultar la información",
           "Saber cómo leer el visor y de dónde salen los datos.",
           ["En el panel de control, pulsar «Información».",
            "Leer «Los filtros», «El tamaño de los puntos», «Los colores», «De dónde salen estos datos» y la Metodología.",
            "Cerrar con «Listo», × o Esc."],
           "Explicación del visor, metodología y fuentes.",
           consideraciones=["La Metodología imprime la fuente del manifest y las advertencias de conservación y "
                            "de la Ley 20.283 (H-05)."]),
        _f("Descargar el reporte del ámbito",
           "Llevar a una reunión un documento con las cifras del ámbito y de los filtros activos.",
           ["Pulsar «Descargar» en el panel de control.",
            "Pulsar «Reporte del ámbito (PDF)».",
            "Revisar el reporte (mapa, alcance, resumen, composición, protección, dosel, especies, distribución, "
            "cobertura del dato y anexos).",
            "Pulsar «Exportar PDF» y elegir «Guardar como PDF» en el diálogo de impresión.",
            "Volver con «← Cerrar»."],
           "Un reporte imprimible con las mismas cifras del panel.",
           pre=["Visor abierto (el reporte se arma del resumen; no espera al .bin)."],
           consideraciones=["El PDF lo genera el diálogo de impresión del navegador (window.print)."]),
        _f("Descargar las cifras del ámbito",
           "Obtener en CSV las cifras del ámbito para trabajarlas en una planilla.",
           ["Pulsar «Descargar».", "Pulsar «Cifras del ámbito (CSV)».",
            "El navegador guarda catastro_cifras_<ámbito>_<fecha>.csv y avisa «Descargado · N filas · K KB»."],
           "CSV con separador punto y coma y coma decimal (RN-07).", pre=_PRE_DESC,
           errores=[["No disponible: los datos aún se están descargando.", "El .bin no terminó de bajar (RN-10)."],
                    ["No se pudo generar el archivo: <motivo>", "Error del navegador al armar el archivo."]]),
        _f("Descargar los polígonos en CSV",
           "Obtener una fila por polígono filtrado, con sus atributos.",
           ["Pulsar «Descargar».", "En la fila «Polígonos (N)», pulsar «CSV»."],
           "catastro_poligonos_<ámbito>_<fecha>.csv (RN-07, RN-09).", pre=_PRE_DESC,
           errores=[["No disponible: los datos aún se están descargando.", "RN-10."]],
           consideraciones=["En pandas: pd.read_csv(…, sep=\";\", decimal=\",\")."]),
        _f("Descargar los polígonos en GeoJSON",
           "Cargar los centroides filtrados en un SIG.",
           ["Pulsar «Descargar».", "En la fila «Polígonos (N)», pulsar «GeoJSON»."],
           "Archivo GeoJSON de puntos con los atributos de cada polígono.", pre=_PRE_DESC,
           restricciones=["Sobre 200.000 polígonos se recorta a esa cantidad; el aviso aparece antes de pulsar (RN-08)."]),
        _f("Descargar el manifest.json",
           "Obtener el índice completo de los datos publicados, sin filtrar.",
           ["Pulsar «Descargar».", "Pulsar el enlace «manifest.json» al final del modal."],
           "manifest.json con vocabularios, cifras nacionales por clase y la descripción del .bin.",
           consideraciones=["No respeta el ámbito: son los datos completos."]),
        _f("Compartir",
           "Mandar a otra persona exactamente la vista que se está mirando.",
           ["Pulsar «Compartir» en el panel de control.",
            "Pulsar «Copiar enlace» (o seleccionar el texto del campo y copiarlo a mano).",
            "Si el ámbito es una región o comuna entera, pulsar también «Copiar enlace a la página»."],
           "Un enlace que reproduce ámbito, filtros, mapa base y encuadre (RN-11).",
           errores=[["(sin aviso de copiado)", "El portapapeles está bloqueado: copiar a mano desde el campo."]]),
        _f("Consultar las cifras por región y comuna",
           "Leer o citar las cifras de una región o comuna en una página propia, sin cargar el mapa.",
           ["Pulsar el enlace «Cifras por región y comuna» del panel de control.",
            "En «Cifras del Catastro por región y comuna», elegir una región o una comuna.",
            "Leer la frase citable y las tablas; desde la página se puede abrir el visor con ese ámbito."],
           "Página estática de la región (con sus comunas) o de la comuna.", pre=["Ninguna."],
           consideraciones=["Las cifras salen de las mismas funciones que el panel (RN-15)."]),
    ],
    "errores_frecuentes": [
        ["El mapa no aparece y se ve la portada con «No se pudieron cargar los datos del mapa.»",
         "Datos sin descargar, conexión cortada o copia vieja en caché.", "Recargar con Ctrl+Shift+R."],
        ["El mapa o las cifras quedan en 0 ha", "Filtros sin coincidencias, o un enlace con una región que no existe (H-10).", "«Quitar los N filtros» o «Volver a todo Chile»."],
        ["Las descargas están deshabilitadas", "Los datos aún bajan (RN-10).", "Esperar a que desaparezca «Descargando el Catastro nacional…»."],
        ["El GeoJSON trae menos polígonos que el panel", "Tope de 200.000 (RN-08).", "Acotar por región o comuna."],
        ["Dos regiones no suman lo esperado", "Años de catastro distintos (RN-06).", "Leer el año junto a cada región."],
    ],
    "buenas_practicas": ["Elegir el ámbito antes de filtrar: todas las cifras dependen de él.",
                         "Compartir con «Copiar enlace» en vez de describir los filtros.",
                         "Citar el año del catastro de cada región junto a sus cifras.",
                         "No leer «Sin dato» de conservación como ausencia de amenaza (RN-12)."],
    "faq": [["¿Necesito cuenta?", "No. El visor es público (RN-01)."],
            ["¿Un punto es una parcela?", "No: es el centroide de un polígono del Catastro (RN-03)."],
            ["¿El Catastro dice quién es el propietario?", "No: el Catastro no registra propiedad."],
            ["¿Por qué tarda la primera vez?", "Baja el archivo de datos completo; después el navegador lo guarda."],
            ["¿Puedo usar el CSV en Excel?", "Sí: está hecho para abrirse con doble clic en Excel en español (RN-07)."]],
}

# Campos de las pantallas con entrada del usuario (todas de selección; no hay campos de texto libres salvo buscadores)
CAMPOS = {
    "Consultar el mapa del Catastro": [
        ["Territorio: Región", "No", "Selección única entre las regiones del manifest, o «Todo Chile»", "Muestra el año del catastro"],
        ["Territorio: Provincia", "No", "Aparece al elegir región", "«Todas» por defecto"],
        ["Territorio: Comuna", "No", "Aparece al elegir región", "Selección única"],
        ["Cada dimensión de Filtros", "No", "Selección múltiple de clases del manifest", "Ninguna marcada = ninguna (RN-04)"],
        ["Imagen de fondo", "Sí (por defecto Claro)", "Una de 7 capas", "Se guarda en ?base="],
    ],
}

ENDPOINTS = [
    ["GET", "datos/manifest.json", "Índice y vocabularios (sin caché)", "Cualquiera"],
    ["GET", "datos/cbn_puntos.bin?v=<sha256[:12]>", "Columnas de los 1,8 M de puntos", "Cualquiera"],
    ["GET", "datos/oficiales.json", "Cifras oficiales de CONAF por región", "Cualquiera"],
    ["GET", "datos/simef.json", "Cambio de bosque nativo (SIMEF)", "Cualquiera"],
    ["GET", "regiones/  ·  region/<slug>/  ·  comuna/<slug>/", "Páginas estáticas de cifras", "Cualquiera"],
    ["GET", "Teselas del mapa base (proveedores externos)", "Imagen de fondo", "Cualquiera"],
]

_BASE = {"secundarios": "Navegador; GitHub Pages (sirve los archivos)", "permisos": "Ninguno: acceso público (RN-01)."}


def _caso(id_, nombre, func, objetivo, flujo, resultado, fa=(), fe=(), rn=(), pantalla="Visor",
          servicio="datos/manifest.json; datos/cbn_puntos.bin", entradas=(), pre=None, verifica=""):
    return {**_BASE, "id": id_, "nombre": nombre, "objetivo": objetivo, "descripcion": objetivo,
            "precondiciones": pre or ["Visor abierto y datos descargados."], "entradas": list(entradas),
            "flujo": flujo, "resultado": resultado, "fa": [list(x) for x in fa], "fe": [list(x) for x in fe],
            "rn": list(rn), "validaciones": [], "datos": "Ninguno: solo lectura.",
            "traz": [M, func, pantalla, servicio, "frontend/public/datos"], "verifica": verifica}


F = list(ROTULOS)
OBS = "Observado el 2026-11-13 con el visor compilado y datos ficticios"

CASOS = [
    _caso("UC-01", "Ingresar al visor sin sesión", F[0], "Abrir el visor sin credenciales.",
          ["Abrir la dirección del visor.", "El sistema muestra la portada y «Descargando el Catastro nacional…».",
           "Al terminar, muestra «Catastro de Usos de la Tierra y Recursos Vegetacionales», el mapa y los Indicadores."],
          "Visor cargado con todo Chile, sin pedir credenciales.", rn=["RN-01", "RN-03"], pre=["Ninguna."],
          fe=[["FE-1", "Datos que no llegan o no cuadran: «No se pudieron cargar los datos del mapa.» (RN-02)."]],
          verifica=OBS + " (captura 01)."),
    _caso("UC-02", "Ingresar al visor con una vista en la dirección", F[0], "Abrir un enlace compartido.",
          ["Abrir /?reg=13&com=13101.", "El sistema abre el visor «Catastro de Usos de la Tierra» con el ámbito Metropolitana › Santiago."],
          "Ámbito, filtros y fondo del enlace aplicados.", rn=["RN-11"],
          fa=[["FA-1", "?base= con un fondo que no existe: abre «Claro»."]], verifica=OBS + "."),
    _caso("UC-03", "Elegir el territorio", F[1], "Acotar el Mapa del Catastro y las cifras a una región, provincia o comuna.",
          ["En el Mapa del Catastro, pulsar «Territorio» en Ámbito.", "Elegir una región (con su año de catastro).",
           "Elegir provincia y comuna.", "Pulsar «Listo»."],
          "El mapa encuadra el territorio; Indicadores y cuentas son del ámbito.", rn=["RN-05", "RN-06"],
          fa=[["FA-1", "«Volver a todo Chile» quita el ámbito."]],
          fe=[["FE-1", "La lista de regiones se corta a 240 px y hay que desplazarla (H-02)."]],
          verifica=OBS + " (captura 01b)."),
    _caso("UC-04", "Filtrar por una dimensión", F[1], "Ver solo algunas clases de una dimensión.",
          ["En el Mapa del Catastro, pulsar «Uso» en Filtros.", "Marcar «Bosques».", "Cerrar con «Listo»."],
          "Solo polígonos de Bosques; el botón muestra la selección y el contador de filtros.", rn=["RN-04"],
          fa=[["FA-1", "«Quitar los N filtros» vuelve a todo."]],
          fe=[["FE-1", "Desmarcar todas las clases de Uso equivale a todas (H-11)."]],
          verifica=OBS + " (captura 01c)."),
    _caso("UC-05", "Cambiar la imagen de fondo", F[1], "Ver el Mapa del Catastro sobre otra capa.",
          ["En el Mapa del Catastro, pulsar «Imagen de fondo».", "Elegir «Satelital».", "Pulsar «Listo»."],
          "El fondo cambia y la dirección lleva ?base=Satelital.", rn=["RN-11"], verifica=OBS + " (captura 01d)."),
    _caso("UC-06", "Abrir la ficha de un polígono", F[1], "Ver los atributos de un punto.",
          ["Acercar el Mapa del Catastro.", "Pulsar un punto.", "El sistema abre la ficha con la clase de uso como título.",
           "Pulsar «Ver en Google Maps» o cerrar con ×."],
          "Ficha con uso, subuso, estructura, tipo y subtipo forestal, densidad, altura, especie, área protegida, "
          "comuna, región y superficie.", rn=["RN-03"], verifica=OBS + " (captura 01e)."),
    _caso("UC-07", "Filtrar por estado de conservación", F[1], "Revisar especies con estado de conservación.",
          ["En el Mapa del Catastro, pulsar «Conservación».", "Leer la nota sobre el Reglamento de Clasificación de Especies.",
           "Marcar «Vulnerable»."], "Solo polígonos cuya especie principal figura como Vulnerable.", rn=["RN-12"]),
    _caso("UC-08", "Leer los indicadores del ámbito", F[2], "Conocer la superficie y composición del ámbito.",
          ["Elegir un ámbito.", "Leer en Indicadores la superficie, los polígonos y «De qué está hecho Chile».",
           "Pulsar una clase de uso para filtrar."], "Cifras del ámbito, coherentes con el mapa.", rn=["RN-14"],
          fe=[["FE-1", "Con todo Chile, la diferencia con la cifra oficial sale con punto decimal (H-01)."]],
          verifica=OBS + " (capturas 01 y 02)."),
    _caso("UC-09", "Leer la información y la metodología", F[3], "Entender cómo se leen los datos.",
          ["Pulsar «Información».", "Leer las secciones y la Metodología.", "Cerrar con «Listo»."],
          "Explicación visible.", rn=["RN-03", "RN-12"], verifica=OBS + " (captura 03)."),
    _caso("UC-10", "Emitir el reporte del ámbito en PDF", F[4], "Imprimir o guardar el reporte.",
          ["Pulsar «Descargar».", "Pulsar «Reporte del ámbito (PDF)».", "Pulsar «Exportar PDF».",
           "Guardar como PDF en el diálogo de impresión."], "Reporte con las cifras del panel.", rn=["RN-05", "RN-14"],
          fa=[["FA-1", "«← Cerrar» vuelve al visor sin imprimir."]],
          fe=[["FE-1", "En la captura se ven controles del mapa sobre el reporte (H-08, por validar)."]],
          verifica=OBS + " hasta el reporte en pantalla (captura 04b); el diálogo de impresión no lo comprobé."),
    _caso("UC-11", "Descargar las cifras del ámbito", F[5], "Llevar las cifras a Excel.",
          ["Pulsar «Descargar».", "Pulsar «Cifras del ámbito (CSV)»."], "Archivo catastro_cifras_<ámbito>_<fecha>.csv.",
          rn=["RN-07", "RN-09", "RN-10"], fe=[["FE-1", "Antes de bajar los datos: «No disponible: los datos aún se están descargando.»"]]),
    _caso("UC-12", "Descargar los polígonos en CSV", F[6], "Una fila por polígono filtrado.",
          ["Pulsar «Descargar».", "En «Polígonos (N)», pulsar «CSV»."], "Archivo catastro_poligonos_<ámbito>_<fecha>.csv.",
          rn=["RN-07", "RN-09", "RN-10"]),
    _caso("UC-13", "Descargar los polígonos en GeoJSON", F[7], "Llevar los puntos a un SIG.",
          ["Pulsar «Descargar».", "En «Polígonos (N)», pulsar «GeoJSON»."], "Archivo GeoJSON del ámbito.",
          rn=["RN-08", "RN-09"], fe=[["FE-1", "Más de 200.000 polígonos: aviso previo y archivo recortado."]]),
    _caso("UC-14", "Descargar el manifest.json", F[8], "Obtener el índice completo.",
          ["Pulsar «Descargar».", "Pulsar el enlace «manifest.json»."], "manifest.json completo, sin filtrar.", rn=["RN-01"]),
    _caso("UC-15", "Compartir la vista", F[9], "Enviar la vista exacta.",
          ["Elegir ámbito y filtros.", "Pulsar «Compartir».", "Pulsar «Copiar enlace»."],
          "Enlace en el portapapeles que reproduce la vista.", rn=["RN-11"],
          fa=[["FA-1", "Ámbito de región o comuna entera: «Copiar enlace a la página»."]],
          fe=[["FE-1", "Portapapeles bloqueado: copiar a mano desde el campo."]], verifica=OBS + " (captura 05)."),
    _caso("UC-16", "Consultar la página de una región", F[10], "Leer las cifras de una región sin el mapa.",
          ["Pulsar «Cifras por región y comuna».", "Elegir «Metropolitana»."],
          "Página de la región con su frase citable y sus comunas.", rn=["RN-15"], pantalla="Páginas estáticas",
          servicio="regiones/; region/<slug>/", pre=["Ninguna."], verifica=OBS + " (capturas 06 y 06b)."),
    _caso("UC-17", "Consultar la página de una comuna", F[10], "Leer las cifras de una comuna.",
          ["Pulsar «Cifras por región y comuna».", "Elegir la comuna Santiago."],
          "Página «Comuna de Santiago» con sus cifras.", rn=["RN-15"], pantalla="Páginas estáticas",
          servicio="comuna/<slug>/", pre=["Ninguna."], verifica=OBS + " (captura 06c)."),
    _caso("UC-18", "Intentar abrir una región inexistente por la dirección", F[0],
          "Seguridad: comprobar que un parámetro fuera de vocabulario no rompe el visor.",
          ["Abrir /?reg=99.", "Observar el Catastro de Usos de la Tierra y los Indicadores."],
          "Observado: el visor no avisa; muestra «Ámbito: 99» con 0 ha y 0 polígonos (H-10). Esperado: ignorar la región o avisar.",
          rn=["RN-11"], fe=[["FE-1", "?reg=13&prov=Inexistente: «Metropolitana › Inexistente» con 0 ha (H-10)."]],
          verifica=OBS + " (sonda de la dirección)."),
]
