# -*- coding: utf-8 -*-
"""Datos comunes del análisis: roles, reglas, hallazgos, sondas y pruebas transversales.

Cada afirmación lleva su origen. «Verificado en el código» = se leyó la línea citada;
«observado» = se vio ejecutando el visor compilado con datos ficticios el 2026-11-13;
«leído» = se leyó y no se ejecutó (no lo comprobé).
"""
from .comun import PV

ROL_NOMBRE = "Usuario del visor"

MATRIZ_ROLES = [
    [ROL_NOMBRE,
     "Cualquier persona que abre el visor publicado: público general, personal de CONAF, analistas, "
     "municipios y prensa.",
     "Sin sesión: se abre la dirección pública del visor. No hay login, ni IAM, ni Clave Única.",
     "Mapa del Catastro con 19 filtros y ámbito territorial; indicadores; información y metodología; "
     "reporte PDF; descargas CSV y GeoJSON; compartir la vista; páginas de cifras por región y comuna.",
     "Solo lectura. No existe ninguna acción que escriba datos: el sitio es estático."],
]

ROLES_NO_APLICABLES = [
    ["Operador del ETL", "Quien corre python ETL/build_bin.py con la base data/*.duckdb y commitea "
     "frontend/public/datos", "Tarea de consola sin pantalla; fuera del alcance de los manuales (CLAUDE.md §2-3)."],
    ["GitHub Actions (deploy.yml)", "Proceso que verifica, compila y publica en GitHub Pages en cada push a main",
     "Actor del sistema, no una persona. Aparece como actor secundario en los casos."],
    ["Roles del COIPO IAM", "No existen en este repositorio",
     "La app no tiene backend ni autenticación: no hay constantes de rol, ni rutas protegidas, ni menú por rol. "
     "Verificado: grep de «rol», «auth», «login» en frontend/src sin coincidencias de autorización."],
]

# id, nombre, descripción, dónde vive
REGLAS_NEGOCIO = [
    ["RN-01", "Acceso público sin sesión", "El visor es un sitio estático publicado en GitHub Pages; cualquier "
     "persona lo abre sin credenciales. Riesgo aceptado (H-04).", "CLAUDE.md §1; .github/workflows/deploy.yml"],
    ["RN-02", "Datos del contrato esquema 5", "El visor solo abre un manifest.json con esquema 5 y un "
     "cbn_puntos.bin del tamaño que declara el manifest; si no, muestra «No se pudieron cargar los datos del "
     "mapa.» con el detalle técnico y la portada.", "datos/binario.js:29-73; App.jsx:759-779"],
    ["RN-03", "Un punto es un centroide", "Cada punto es el centroide de un polígono del Catastro, no una parcela "
     "ni un predio; la superficie real está en el atributo. El visor lo avisa al abrir.", "config.js:451-453"],
    ["RN-04", "Filtro vacío = ninguna clase", "Un conjunto de filtro vacío significa «ninguna», no «todas»; "
     "ausente es «todas» (regla de los datos, CLAUDE.md §5). Excepción: en Uso, ninguna clase marcada "
     "equivale a todas (H-11).", "CLAUDE.md §5; App.jsx:509; urlState.js:34-36"],
    ["RN-05", "Ámbito territorial", "Región › Provincia › Comuna, de selección única; todas las cifras, el "
     "reporte y las descargas respetan el ámbito activo.", "ControlesPanel.jsx (ModalTerritorio); SeccionDescargas.jsx:115"],
    ["RN-06", "Año del catastro por región", "Cada región se catastró en un año distinto; el año se muestra junto "
     "a la región y las cifras de dos regiones no son de la misma fecha.", "ControlesPanel.jsx; manifest.regiones[].anio"],
    ["RN-07", "Formato del CSV", "Separador punto y coma, coma decimal y BOM UTF-8 (lo que abre Excel en "
     "español de Chile); guardia contra inyección de fórmulas (= + @ TAB CR).", "descargas.js:1-45"],
    ["RN-08", "Tope del GeoJSON", "Sobre 200.000 polígonos el GeoJSON se recorta a esa cantidad, y se avisa "
     "ANTES de pulsar.", "SeccionDescargas.jsx:5, 143-151"],
    ["RN-09", "Nombre de los archivos", "catastro_<qué>_<ámbito>_<fecha local AAAA-MM-DD>.<ext>; sin ámbito, "
     "«nacional».", "descargas.js:71-73"],
    ["RN-10", "Descargas solo con datos", "Las descargas de cifras y polígonos se habilitan cuando terminó de "
     "bajar el .bin («No disponible: los datos aún se están descargando.»); el reporte, desde el resumen.",
     "SeccionDescargas.jsx:23, 126-133"],
    ["RN-11", "La vista viaja en la dirección", "reg, prov, com, usos, base, lat, lon, z y un parámetro por "
     "dimensión de filtro con el nombre de su columna. Un ?base= que no existe abre el fondo «Claro».",
     "urlState.js:20-60"],
    ["RN-12", "Conservación sin verificar", "El estado de conservación viene de una tabla auxiliar sin validar "
     "contra el Reglamento de Clasificación de Especies; «Sin dato» no es ausencia de amenaza.",
     "filtros.js:155-172; CLAUDE.md §7.5"],
    ["RN-13", "Tema claro u oscuro", "El tema sigue la preferencia del sistema operativo (prefers-color-scheme); "
     "la app no tiene selector propio.", "App.jsx:64, 229"],
    ["RN-14", "Cifras de la interfaz desde el manifest", "Las cifras de la interfaz y de la prosa salen del "
     "manifest y de hechos.js, nunca escritas a mano.", "CLAUDE.md §6; hechos.js"],
    ["RN-15", "Páginas por región y comuna", "Una página estática por región (16) y por comuna (343), más el "
     "índice; sus cifras salen de las mismas funciones que el panel.", "scripts/web.mjs:1-20"],
]

# id, severidad, hallazgo, estado y evidencia, efecto
HALLAZGOS = [
    ["H-01", "Baja",
     "La línea «Cifra oficial de CONAF: … · aquí sale X ha más. No se ajusta.» formatea la diferencia con "
     "toFixed(2): sale con punto decimal y sin separador de miles, a diferencia de toda la interfaz (es-CL), y "
     "si la diferencia es negativa dice «-N ha más».",
     "Verificado en el código: PanelIndicadores.jsx:125-127. Observado en la captura 01 (con datos ficticios la "
     "diferencia sale «-75027638.44 ha más»). Con los datos reales no lo comprobé.",
     "Caso UC-08."],
    ["H-02", "Baja",
     "En el modal Territorio la lista de regiones tiene un techo de 240 px con desplazamiento propio, aunque el "
     "modal ocupa toda la altura: a 1440×900 se ven cinco regiones y media y debajo queda el modal vacío.",
     "Observado en la captura 01b. Verificado en el código: App.css:783.", "Caso UC-03."],
    ["H-03", "Media",
     "El estado de conservación se publica con casi todas las especies «Sin dato - no verificado en RCE» "
     "(976 de 989 según CLAUDE.md, 2026-09-26). El visor lo advierte en el filtro y en la Metodología.",
     "Leído: CLAUDE.md §7.5 y filtros.js:155-172. Pendiente de validación institucional.",
     "No es un defecto de código: es una decisión pendiente."],
    ["H-04", "Riesgo aceptado",
     "Sitio público sin autenticación: cualquiera descarga las cifras y los polígonos del ámbito, y el "
     "manifest.json completo.", "Decisión de diseño: CLAUDE.md §1 («no hay backend, y es deliberado»).",
     "No es un defecto."],
    ["H-05", "Baja",
     "Brechas conocidas abiertas del repositorio: no existe tooltip al pasar el puntero; la nota «Antes de "
     "publicar, CONAF debe validar la redacción contra la Ley 20.283» sigue visible en la Metodología; 14 casos "
     "de homologación esperan decisión institucional.",
     "Leído: CLAUDE.md §7 (puntos 2, 4 y 6). No lo comprobé en pantalla.", "—"],
    ["H-06", "Baja",
     "Visibilidad fuera del código: el robots.txt de la organización no existe y Umami no tiene identificador.",
     "Leído: CLAUDE.md §7.8 y docs/visibilidad.md. No lo comprobé.", "Sin medición de visitas."],
    ["H-07", "Baja",
     "La dirección tarda hasta un segundo en reflejar los usos al cargar un enlace.",
     "Leído: CLAUDE.md §7.9 (mejoras.md §2.17). No lo comprobé.", "—"],
]

HALLAZGOS += [
    ["H-10", "Baja",
     "La región y la provincia de la dirección no se validan contra el vocabulario: ?reg=99 abre el visor con "
     "«Ámbito: 99», 0 ha y 0 polígonos, sin aviso; ?reg=13&prov=Inexistente muestra «Metropolitana › "
     "Inexistente» con 0 ha. En cambio ?com=00000 se ignora y ?base=Inexistente cae a «Claro».",
     "Observado el 2026-11-13 (sonda de la dirección, tabla 7 ter). Verificado en el código: urlState.js:31-33 "
     "copia reg y prov sin validar; base sí se valida (urlState.js:50-51).",
     "Un enlace mal copiado muestra cifras en cero como si fueran reales."],
    ["H-11", "Baja",
     "?usos= (vacío) no significa «ninguna clase» como dice el comentario de urlState.js:35: App.jsx:509 aplica "
     "el filtro de uso solo si hay alguna clase, así que el visor abre con las 9 clases y quita el parámetro.",
     "Observado el 2026-11-13 (sonda ?usos=: «Uso 9», 633.556 ha con datos ficticios). Verificado en el código: "
     "App.jsx:509 y urlState.js:34-36.", "Contrato de la dirección distinto del documentado."],
]

# Sondas de la dirección (valor de lista falso), observadas el 2026-11-13
SONDAS_URL = [
    ["?reg=99", "Ámbito «99», 0 ha, 0 polígonos, sin aviso", "H-10"],
    ["?com=00000", "Se ignora: todo Chile", "Correcto"],
    ["?base=Inexistente", "Abre «Claro» y quita el parámetro", "Correcto (RN-11)"],
    ["?tifo=ZZ", "Se ignora: sin filtro de tipo forestal", "Correcto"],
    ["?usos=", "Abre con las 9 clases (no «ninguna»)", "H-11"],
    ["?reg=13&prov=Inexistente", "«Metropolitana › Inexistente», 0 ha", "H-10"],
]

HALLAZGOS_CAPTURAS = [
    ["H-08", "Por validar",
     "En la captura del Reporte (04b) se ven encima del documento los botones +/− y la atribución del mapa. "
     "La prueba de qué elemento está en esos píxeles (elementFromPoint) devuelve el reporte, no el mapa: lo más "
     "probable es un artefacto de la captura en Chrome sin pantalla. " + PV + " mirar el Reporte en un navegador normal.",
     "Observado en la captura 04b; contrastado con elementFromPoint el 2026-11-13.", "—"],
    ["H-09", "Informativo",
     "El aviso «Cada punto es el centroide de un polígono…» queda abierto sobre el mapa en todas las pantallas "
     "hasta pulsar «Entendido».", "Observado en las capturas 01 a 05.", "Es deliberado (RN-03)."],
]

# Sondas fijas del prompt (6 bis): sonda, qué se intentó, resultado
SONDAS = [
    ["Borrarse a sí mismo", "No hay usuarios, roles ni lista de bloqueo.", "No aplica"],
    ["Datos solapados", "No hay escritura de rangos ni registros.", "No aplica"],
    ["Inicio posterior al fin", "No hay rangos de fechas que el usuario ingrese.", "No aplica"],
    ["Dígito verificador", "No hay RUT ni otro identificador nacional.", "No aplica"],
    ["Fuera de ámbito", "No hay ámbito por usuario: todos ven todo (RN-01).", "No aplica"],
    ["Valor de lista falso", "Dirección con valores fuera de vocabulario: ?reg=99, ?base=Inexistente, "
     "?tifo=ZZ, ?usos= (vacío), ?com=00000, ?prov=Inexistente.", "Observado: sin error en pantalla; dos defectos (H-10, H-11). Detalle en 7 ter"],
    ["Datos personales por la API", "No hay API. Los datos publicados (manifest.json y cbn_puntos.bin) son "
     "polígonos de uso de suelo, sin propietario ni RUT (el Catastro no registra propiedad: Reporte, Anexo C).",
     "No aplica: no hay datos de personas"],
]

# Pruebas negativas transversales, adaptadas a un sitio estático de solo lectura.
NEGATIVAS = [
    "Región inexistente en la dirección (?reg=99).",
    "Comuna inexistente en la dirección (?com=00000).",
    "Fondo inexistente en la dirección (?base=Inexistente): debe abrir «Claro».",
    "Valor fuera de vocabulario en un filtro (?tifo=ZZ).",
    "Lista vacía en la dirección (?usos=): ninguna clase, no todas (RN-04).",
    "manifest.json de otro esquema: aviso «No se pudieron cargar los datos del mapa.».",
    "cbn_puntos.bin truncado o en caché vieja: aviso con el tamaño esperado.",
    "Pérdida de conexión durante la descarga de los datos.",
    "Pulsar las descargas antes de que terminen de bajar los datos.",
    "Ámbito con más de 200.000 polígonos y GeoJSON (recorte avisado).",
    "Portapapeles bloqueado al copiar el enlace.",
    "Imprimir el reporte con el tema oscuro del sistema.",
    "Abrir con ancho de teléfono: paneles como cajón.",
    "Botón Atrás del navegador tras cambiar el ámbito.",
]

ACCESO = [
    ["QA-AC-01", "Abrir la dirección del visor sin sesión", "Carga el visor; no pide credenciales"],
    ["QA-AC-02", "Abrir un enlace con ámbito (?reg=13&com=13101)", "El visor abre con ese ámbito"],
    ["QA-AC-03", "Abrir /regiones/ directamente", "Carga el índice de cifras por región y comuna"],
    ["QA-AC-04", "Descargar manifest.json desde el enlace del modal Descargar", "Se descarga sin autenticación (RN-01)"],
    ["QA-AC-05", "Buscar cualquier pantalla de administración o login", "No existe ninguna"],
]
