# Solucion, leida del codigo

## Que hace el sistema

[INFERIDO] Permite explorar en el navegador un conjunto grande de puntos
territoriales: ubicarlos sobre un mapa [frontend/src/mapa/CapaPuntos.jsx],
acotarlos por una serie de filtros encadenados [frontend/src/filtros.js],
abrir la ficha de un punto seleccionado
[frontend/src/components/ModalFicha.jsx] y leer indicadores agregados que se
recalculan con el filtro puesto [frontend/src/indicadores.js]. El calculo de
esos agregados ocurre en el navegador, no en un servidor, porque el bloque de
endpoints de servidor de la evidencia esta vacio y los datos se leen como
archivos [frontend/src/App.jsx:129].

[INFERIDO] Permite ademas sacar el resultado de la pantalla en cuatro formas
distintas: descargar los datos filtrados en formato separado por comas, con
separador y marca de codificacion declarados explicitamente
[frontend/src/descargas.js]; descargar geometria con un tope de registros
[frontend/src/components/SeccionDescargas.jsx]; generar un reporte imprimible
[frontend/src/components/Reporte.jsx], que incluye una captura del mapa
[frontend/src/mapa/capturaMapa.js]; y compartir la vista tal como quedo,
porque el estado de los filtros se serializa a la direccion web
[frontend/src/urlState.js].

[INFERIDO] Y permite consultar como se construyo el dato que se esta mirando,
porque hay una pagina de metodologia dentro de la propia aplicacion
[frontend/src/components/PaginaMetodologia.jsx] y un cartel de contexto
[frontend/src/components/CartelContexto.jsx].

## La cadena de preparacion del dato

[INFERIDO] Antes de que el visor exista hay un proceso de preparacion en seis
pasos, todos con codigo propio en el repositorio:

1. Homologar codigos entre fuentes contra dieciseis tablas de equivalencia numeradas,
   con una funcion que exige la correspondencia en vez de asumirla
   [ETL/homologacion/__init__.py].
2. Construir el binario de puntos que consume el visor, calculando ademas
   agregados, etiqueta mayoritaria y orden de altura
   [ETL/build_bin.py].
3. Construir el conjunto de la serie temporal derivando el ano desde una sigla
   [ETL/build_simef.py].
4. Construir las cifras de referencia, incluida la desagregacion por especie
   [ETL/cifras_oficiales.py].
5. Verificar el resultado contra esas cifras con una tolerancia declarada, y
   contra un catalogo de deformaciones deliberadas del dato: permutacion de
   cobertura, especie en cero, altura desordenada, clase quitada, tramo
   imposible [ETL/verificar_datos.py].
6. Releer el binario ya construido para comprobar que se puede volver a leer
   [ETL/leer_bin.py].

[INFERIDO] Cada uno de esos pasos calcula una huella criptografica del
resultado [ETL/build_bin.py], lo que indica que la trazabilidad entre version
del dato y version del visor es un requisito del diseno y no un accesorio. Que
esa huella se compare con algo externo al repositorio: [PENDIENTE].

## Reglas de negocio que estan escritas en el codigo

[INFERIDO] La clasificacion no es libre: hay una tabla de equivalencia por
cada dimension, y sus nombres numerados dan el orden de la jerarquia, desde
uso [ETL/homologacion/01_uso.csv] hasta genero
[ETL/homologacion/16_genero.csv], pasando por estructura, tipo forestal,
cobertura, altura y division politico-administrativa.

[INFERIDO] Hay decisiones de homologacion que quedaron congeladas como dato y
no como codigo: una lista de lo que no se debe fusionar
[ETL/homologacion/13_NO_FUSIONAR.csv], una lista de lo que quedo pendiente de
revision [ETL/homologacion/14_REVISAR.csv] y dos archivos de adiciones
manuales [ETL/homologacion/adiciones.csv] y
[ETL/homologacion/adiciones_12_especie.csv]. Quien aprobo cada decision de
esas listas: [PENDIENTE].

[INFERIDO] Del lado del visor tambien hay reglas fijadas en codigo: los cortes
de pantalla a partir de los cuales cambia el diseno, la vista inicial, los
limites del encuadre y la paleta por uso, todos declarados como constantes
[frontend/src/config.js]; el conjunto de dimensiones de los indicadores y el
tratamiento de la columna sin dato [frontend/src/indicadores.js]; y un tope de
elementos en las listas de filtro [frontend/src/filtros.js].

## Roles: quien ve que

No hay roles, y esto es afirmable porque el analizador recorrio las categorias
completas:

- [INFERIDO] El bloque de endpoints de servidor esta vacio: las tres unicas
  entradas del bloque de API son lecturas hechas desde el navegador
  [frontend/src/App.jsx:129], [frontend/src/App.jsx:133] y
  [frontend/src/hooks/useFechaImagen.js:80].
- [INFERIDO] El bloque de variables de entorno contiene una sola entrada, y es
  la ruta base de publicacion [frontend/vite.config.js:7]. No hay ninguna
  variable de credencial ni de proveedor de identidad.
- [INFERIDO] El bloque de tablas de base de datos esta vacio.

[INFERIDO] En consecuencia, quien alcanza la direccion publicada ve todo:
el binario de puntos se sirve como recurso publico junto a la aplicacion
[frontend/public/datos/cbn_puntos.bin].

[VERIFICAR] Ese archivo contiene ubicaciones a nivel de punto. Si alguna de
esas ubicaciones permite identificar un predio o a su propietario, publicarlo
sin control de acceso es una decision que no cierra el analizador. La
evidencia entrega la ruta y el peso del archivo, no su contenido. Esto lo
cierra Fiscalia o Auditoria.

## De donde salen los datos

[INFERIDO] La aplicacion lee tres recursos: el binario de puntos
[frontend/public/datos/cbn_puntos.bin] con su manifiesto
[frontend/public/datos/manifest.json], la serie
[frontend/public/datos/simef.json] cargada desde
[frontend/src/App.jsx:129], y las cifras de referencia
[frontend/public/datos/oficiales.json] cargadas desde
[frontend/src/App.jsx:133].

[INFERIDO] Hay ademas una consulta a un servicio externo declarado como
constante para obtener la fecha de la imagen de fondo
[frontend/src/hooks/useFechaImagen.js:80]. Es la unica dependencia en linea
del sistema.

[INFERIDO] Aguas arriba, las tablas de homologacion se generan desde un libro
de calculo [ETL/homologacion/desde_xlsx.py], y en el repositorio hay dos
libros candidatos a ser ese origen
[data/Catalogo_Datalake_GEF_singeometria.xlsx] e
[INSUMO/homologacion_catastro_1.xlsx]. Cual de los dos, o si son ambos:
[PENDIENTE].

Quien es dueno del catastro de origen, quien opera el servicio externo de
imagenes y con que periodicidad se rehace el binario: [PENDIENTE].

## Que NO hace

Solo ausencias que el analizador comprobo de forma exhaustiva:

- [INFERIDO] No existe ningun endpoint de servidor: el bloque de rutas de
  servidor de la evidencia esta vacio. El sistema no recibe nada, solo
  entrega.
- [INFERIDO] No existe ninguna tabla de base de datos: el bloque
  correspondiente esta vacio. Nada de lo que hace el usuario se guarda del
  lado del servidor.
- [INFERIDO] Los seis scripts de preparacion estan pensados para invocarse a
  mano: todos declaran su propio analizador de argumentos de linea de comandos
  [ETL/build_bin.py]. Que ademas se ejecuten dentro del flujo de publicacion
  no queda descartado, porque ese flujo menciona el proceso de preparacion
  [.github/workflows/deploy.yml:3] y su contenido no se leyo: [PENDIENTE].

Estas ausencias describen este repositorio. No permiten afirmar que esas
funciones no existan en otro lugar del proceso.

## Como se verifica y como se publica

[INFERIDO] La verificacion no es solo de codigo sino de lo que se ve: hay una
bateria que levanta un servidor local, abre la aplicacion, hace clic, mide
metros por pixel y comprueba el diametro del disco dibujado, los puntos bajo
el clic y las coordenadas de la ficha [frontend/verificacion/verificar.py]. Y
hay una segunda bateria que introduce mutaciones en el codigo para comprobar
que la primera las detecta [frontend/verificacion/mutaciones.py] y
[frontend/verificacion/mutaciones-visor.py]. Diecisiete capturas de pantalla
quedan versionadas como referencia, entre ellas
[frontend/verificacion/captura-cascada.png] y
[frontend/verificacion/captura-ficha.png].

[INFERIDO] Uno de los dos comandos de verificacion declarados en el manifiesto
de la interfaz [frontend/package.json] apunta a un archivo bajo el directorio
de scripts que no aparece en la lista de archivos del repositorio: el unico
archivo que la evidencia lista en ese directorio es el actualizador del README
[scripts/update_readme.py]. Puede ser un comando obsoleto o un archivo no
versionado; la evidencia no lo distingue. [PENDIENTE] cual de las dos.

[INFERIDO] La publicacion la hace un flujo de integracion continua
[.github/workflows/deploy.yml], que ademas es el archivo mas grande de los dos
flujos y el unico que la evidencia asocia con el proceso de preparacion del
dato [.github/workflows/deploy.yml:3]. Donde publica y quien administra ese
destino: [PENDIENTE].

## Iteraciones

[INFERIDO] Hay al menos tres registros de evolucion escritos a mano: un
documento de decisiones de 26 KB [DECISIONES.md], uno de mejoras de 38 KB
[mejoras.md] y notas de una exploracion tecnica previa [spike/NOTAS.md]. Esa
exploracion previa dejo tres prototipos de mapa comparables entre si
[spike/spike.html], [spike/spike_leaflet.html] y [spike/spike_hibrido.html],
mas un medidor de rendimiento [spike/medir.py], lo que indica que la eleccion
de la tecnologia de mapa se probo antes de decidirla.

No hay etiquetas, CHANGELOG ni migraciones numeradas en la evidencia con las
que fechar esas iteraciones: [PENDIENTE].

## Donde el analizador quedo ciego

- El contenido de los tres archivos de datos que consume el visor: no se sabe
  que columnas trae el binario, cuantos registros tiene ni que periodo cubre.
- El contenido de las dieciseis tablas de homologacion numeradas: se conoce su nombre y
  su tamano, no sus filas.
- Los tres documentos de la carpeta de insumos, incluido un PDF de 2,4 MB, no
  se leyeron.
- El cuaderno de analisis [notebooks/analisis_catastro.ipynb], de 987 KB, no
  se incorporo.
- Los dos documentos de evolucion [DECISIONES.md] y [mejoras.md] suman 64 KB
  de texto que este documento no leyo, y que muy probablemente contienen las
  respuestas a varios de los [PENDIENTE] de mas arriba.
