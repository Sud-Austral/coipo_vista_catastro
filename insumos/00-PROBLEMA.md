# Problema, reconstruido desde el codigo

Documento escrito hacia atras: se leyo lo que se construyo y desde ahi se
deduce que pudo haberlo motivado. La cadena de inferencia es debil por
definicion y va escrita como tal.

## Que estaba roto

[INFERIDO] Habia un conjunto de datos territoriales demasiado grande para
abrirlo con las herramientas de escritorio habituales. Se deduce de que el
dato que consume la aplicacion no es una planilla ni un archivo de texto sino
un binario de posiciones de casi 50 MB [frontend/public/datos/cbn_puntos.bin],
acompanado de un manifiesto de 636 KB [frontend/public/datos/manifest.json], y
de que existe un modulo dedicado a leer ese binario con un ancho de registro
fijo [frontend/src/datos/binario.js]. Nadie construye un formato binario
propio para un dato que cabe en una planilla.

[INFERIDO] Habia un problema de vocabulario antes que de volumen: los codigos
de un mismo concepto no coincidian entre fuentes. Se deduce de que existe un
paquete completo dedicado exclusivamente a homologar codigos
[ETL/homologacion/__init__.py], con dieciseis tablas de equivalencia numeradas
separadas por dimension, y de que dos de esas tablas se llaman por lo que hay
que hacer con ellas y no por lo que contienen
[ETL/homologacion/13_NO_FUSIONAR.csv] y [ETL/homologacion/14_REVISAR.csv].
Alguien tuvo que decidir, caso a caso, que se fusiona y que no.

[INFERIDO] Habia un problema de confianza en las cifras. Se deduce de que
existe un script cuya funcion es comparar contra cifras publicadas
[ETL/cifras_oficiales.py], otro que compara conjuntos de codigos entre dos
origenes [ETL/analisis_codigos.py], y un verificador con tolerancia declarada
y comprobaciones de sumas [ETL/verificar_datos.py]. Verificar contra un
numero oficial solo tiene sentido si antes hubo discrepancia.

[INFERIDO] Habia un problema de acceso: quien necesitaba mirar estos datos no
podia hacerlo sin herramientas especializadas. Se deduce de que el resultado
es una aplicacion de navegador con mapa [frontend/src/mapa/CapaPuntos.jsx],
filtros [frontend/src/filtros.js], indicadores
[frontend/src/indicadores.js] y descargas [frontend/src/descargas.js], y de
que no hay ningun servidor propio en la evidencia.

Todo lo anterior es hipotesis con respaldo. El codigo dice que se construyo;
no dice quien lo pidio.

## Quien sufre el problema

[PENDIENTE] No hay guard, decorador, middleware de autorizacion ni tabla de
permisos en la evidencia. El bloque de endpoints de servidor viene vacio: solo
hay tres lecturas de datos desde el navegador [frontend/src/App.jsx:129],
[frontend/src/App.jsx:133] y [frontend/src/hooks/useFechaImagen.js:80]. No hay
ningun rol tecnico que nombrar con cita.

[INFERIDO] Hay indicios de mas de un tipo de lector, pero son indicios de
formato y no de cargo: existe una pagina de metodologia
[frontend/src/components/PaginaMetodologia.jsx], separada de un reporte
imprimible [frontend/src/components/Reporte.jsx], separado a su vez del panel
de indicadores de uso diario
[frontend/src/components/PanelIndicadores.jsx]. Quienes son esos lectores:
[PENDIENTE].

[INFERIDO] Existe un banner asociado a fiscalizacion
[frontend/src/assets/banner-conaf-fiscalizacion.jpg] entre un juego de
banners por area [INSUMO_GRAFICO/README.md], lo que sugiere que el visor se
adscribe a un area determinada. Que area es la duena: [PENDIENTE].

Cuantas personas son: [PENDIENTE] siempre.

## Como lo resolvian antes

[INFERIDO] Parte del insumo llegaba en planilla y se convertia a mano al
formato del proyecto. Se deduce de que existe un conversor que lee un libro de
calculo y escribe las tablas de homologacion
[ETL/homologacion/desde_xlsx.py], y de que en el repositorio hay al menos dos
planillas de origen [data/Catalogo_Datalake_GEF_singeometria.xlsx] y
[INSUMO/homologacion_catastro_1.xlsx].

[INFERIDO] Antes de este visor hubo documentos, no un sistema: en la carpeta
de insumos hay un informe [INSUMO/informe_visor_catastro.docx] y, junto a el,
un documento de armonizacion territorial en formato PDF de 2,4 MB cuya ruta
la evidencia registra en la misma carpeta.

Quien mantenia esas planillas, cada cuanto y cuanto tardaba: [PENDIENTE].

## Que pasa si no se hace nada

[PENDIENTE], sin excepcion. El codigo no lo responde y que el visor exista no
es una respuesta.

## Volumen

[INFERIDO] El orden de magnitud es alto para una planilla y bajo para una base
de datos institucional. Los indicios:

- El binario de posiciones pesa 49,4 MB
  [frontend/public/datos/cbn_puntos.bin] y se lee con un ancho de registro
  fijo declarado en el codigo [frontend/src/datos/binario.js]. Un formato de
  ancho fijo se elige cuando el numero de registros es lo bastante grande como
  para que el costo por registro importe.
- Hay un archivo columnar de 31 MB en el repositorio
  [notebooks/cbn.parquet]. El formato columnar tambien se elige por tamano.
- El procesamiento no usa la libreria de tablas habitual para el grueso del
  trabajo sino un motor analitico embebido, importado por cinco de los seis
  scripts de proceso [ETL/build_bin.py], [ETL/build_simef.py],
  [ETL/cifras_oficiales.py] y [ETL/analisis_codigos.py].
- Hay un aviso de puntos declarado como constante de configuracion
  [frontend/src/config.js] y un tope de exportacion geografica
  [frontend/src/components/SeccionDescargas.jsx], lo que indica que se llego a
  un limite practico de cuantos puntos se pueden mostrar o descargar de una
  vez.

La cifra de registros, su cobertura territorial y su fecha de corte:
[PENDIENTE]. Ninguna de las anteriores es un conteo.

## Quien decide que esta terminado

[PENDIENTE], sin excepcion.

[INFERIDO] Lo que si existe es un criterio tecnico de aceptacion escrito:
hay una bateria de verificacion que abre la aplicacion, simula el uso y
comprueba lo que aparece en pantalla [frontend/verificacion/verificar.py], mas
un ejercicio de mutaciones que rompe el codigo a proposito para comprobar que
la verificacion lo detecta [frontend/verificacion/mutaciones.py], mas capturas
de pantalla guardadas como referencia
[frontend/verificacion/captura-app.png]. Eso responde "esta correcto", no
"esta terminado", y son preguntas distintas.
