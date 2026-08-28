// Configuracion del visor: rutas de datos, vista inicial, basemaps y simbologia.

// NUNCA '/datos': el repo se publica en Pages bajo /coipo_vista_catastro/, y una
// ruta absoluta pediria los datos a la raiz del dominio.
export const DATA = import.meta.env.BASE_URL + 'datos'

// Chile entero. El catastro va de -17,50 a -56,52 de latitud, asi que la vista
// inicial tiene que caber todo o el visor abre mintiendo sobre su cobertura.
export const VISTA_INICIAL = { center: [-38.0, -71.5], zoom: 4 }
export const LIMITES = [
  [-57, -78],
  [-17, -64],
]

// ---------------------------------------------------------------------------
// Geometria de los paneles.
//
// ACOPLADO a las media queries de App.css: los cortes viven en los dos sitios
// porque una media query no puede leer una constante de JS y JS necesita saber
// en que regimen esta para decidir si la X pliega una pista o cierra un cajon.
// La duplicacion es inevitable; lo que NO es inevitable es que se desincronicen,
// y por eso .app publica data-regimen y la verificacion comprueba que coincida
// con el numero de pistas que resuelve el CSS.
// ---------------------------------------------------------------------------

/** Por encima: los dos paneles anclados. Por debajo, el derecho pasa a cajon. */
export const CORTE_KPI = 1200
/** Por encima: el panel izquierdo anclado. Por debajo, pasa a cajon. */
export const CORTE_PANEL = 900

export const MIN_PANEL = 280
export const MAX_PANEL = 560
export const ANCHO_PANEL = 320
export const ANCHO_KPI = 320
export const MAX_KPI = 560

/**
 * Suelo de ancho del mapa. No es estetico: Chile continental mide 4.300 km de
 * norte a sur y a menos de ~520 px de ancho util la franja deja de distinguirse
 * de una linea. Ademas ACOTA EL TIRADOR, de modo que arrastrar no pueda violar
 * lo que la asercion comprueba.
 */
export const MIN_MAPA = 520

/**
 * Marcas diacriticas combinantes (U+0300..U+036F), las que deja sueltas
 * normalize('NFD'). Se construye desde una CADENA y no como literal de regex
 * para que el rango viaje en ASCII puro: escrito como literal, el archivo acaba
 * guardando los combinantes de verdad, que son invisibles al revisar el diff y
 * los destruye cualquier herramienta que normalice el fuente.
 */
export const DIACRITICOS = new RegExp('[̀-ͯ]', 'g')

/* ---------------------------------------------------------------------------
   MAPAS BASE

   Cinco de los siete fondos salen de server.arcgisonline.com, el mismo host que
   ya servia Satelital. Se migraron desde basemaps.cartocdn.com en agosto de
   2026, cuando CARTO cerro el acceso anonimo y empezo a estampar
   "API KEY REQUIRED" DENTRO del PNG. El CDN seguia devolviendo 200 image/png,
   asi que ningun control por codigo HTTP lo habria detectado: el fallo estaba en
   los pixeles. Si algun dia Esri hace lo mismo el sintoma sera identico, y la
   comprobacion tambien -- descargar una tesela con curl y MIRARLA.

   PATRON DE URL: ArcGIS pide {z}/{y}/{x}, o sea FILA antes que COLUMNA, al reves
   del {z}/{x}/{y} de OSM. Copiar la plantilla de Calles a una capa de Esri
   devuelve teselas de otro sitio, con 200 y sin ningun error visible.

   EL maxZoom DECLARADO MIENTE. El tileInfo de cada servicio publica LODs que
   Esri no tiene cacheados; medido sobre once puntos de Chile, mintio en CINCO de
   los siete servicios probados. Pasado el cache real el servidor responde 200
   con una tesela gris que dice "Map data not yet available" -- la misma, byte a
   byte, en Arica, Valdivia, Patagonia y Nueva York. Por eso cada capa declara su
   maxNativeZoom MEDIDO y no el que anuncia el servicio. La autoridad es el
   endpoint /tilemap, nunca el tileInfo.

   NINGUN HOST LLEVA {s}, pero por razones distintas segun el host. El reparto
   por subdominios (a/b/c/d) era una tecnica de HTTP/1.1 para saltarse el limite
   de ~6 conexiones por host, irrelevante cuando el host habla HTTP/2. En Esri no
   se puede aplicar de todos modos: no publica subdominios repartidos, asi que no
   hay {s} que poner. NO se afirma aqui que arcgisonline sirva sobre HTTP/2 --no
   se pudo verificar con las herramientas de este entorno-- y si resultara ser
   HTTP/1.1 habria una regresion de concurrencia frente a CARTO que conviene
   medir antes de darla por inexistente.

   LICENCIA. Las capas de arcgisonline.com estan bajo el Esri Master License
   Agreement (https://www.esri.com/en-us/legal/terms/master-agreement). El
   resumen oficial de condiciones (tou_summary.pdf, abr-2025) PROHIBE de forma
   expresa cosechar teselas de forma sistematica, redistribuirlas y auto-alojar
   contenido de Esri: eso cierra de antemano la salida que alguien propondra en
   cuanto Esri anuncie un apagon ("nos espejamos las teselas y ya"). Tiene ademas
   una clausula de sabor no comercial, de la misma familia que la CC BY-NC-SA de
   EOX que se documenta mas abajo. El encaje es el mismo que ya se declaro para
   EOX --CONAF es un organismo del Estado sin fines de lucro y este visor entrega
   informacion publica de forma gratuita-- y lo decide CONAF, no este codigo.

   Y EL ACCESO SIN CLAVE ES TOLERADO, NO DECLARADO. Hoy funciona (200, CORS
   abierto, sin token), pero no existe ningun documento de Esri que lo reconozca
   como derecho: su resumen de condiciones encabeza los permisos con "IF YOU HAVE
   AN ARCGIS ONLINE SUBSCRIPTION YOU MAY", y Esri ha pedido explicitamente a los
   proyectos de codigo abierto que migren al servicio nuevo de basemaps, que si
   exige clave. O sea, la misma situacion que acaba de estallar con CARTO. La
   diferencia es que aqui las fechas ya estan publicadas, y estan anotadas capa
   por capa mas abajo.

   ATRIBUCION: Esri exige DOS, la suya y la de los proveedores de datos, y pide
   "Powered by Esri" en toda aplicacion que use sus servicios. Por eso todas las
   cadenas de abajo la llevan delante.

   CONCENTRACION DE PROVEEDOR: cinco capas dependen ahora de un solo host. Es lo
   que abarata el preconnect, y tambien lo que haria caer cinco fondos a la vez.
   Calles (OSM) se queda justamente por eso: es la unica reserva que no es Esri.
   --------------------------------------------------------------------------- */
export const BASEMAPS = {
  // Fondo neutro y claro: es el unico que deja leer 1,83 millones de puntos
  // superpuestos sin que el mapa base compita con el dato. Medido sobre las
  // teselas de Valdivia, la saturacion va entre 0 y 5 sobre 255 y no hay un solo
  // pixel verde, que es lo que importa en un catastro vegetacional donde las dos
  // clases mas abundantes son verdes.
  //
  // NO TRAE TOPONIMOS, y es una decision tomada, no un descuido: Esri los sirve
  // en una capa aparte (Canvas/World_Light_Gray_Reference) y superponerla
  // costaria dos peticiones de tesela por celda. El CARTO que habia antes si los
  // traia incrustados, asi que esto es una perdida asumida; quien necesite
  // nombres tiene Calles y Topografico a un clic. Los nombres de calle si
  // aparecen, pero recien en z16.
  //
  // LA CLAVE 'Claro' NO SE RENOMBRA: urlState.js la usa como centinela del valor
  // por defecto (linea 83), de modo que cambiarla invalidaria en silencio todos
  // los enlaces ya compartidos. Si alguna vez hay que mostrar otro texto en el
  // desplegable, se anade un campo de etiqueta; no se toca la clave.
  //
  // ACOPLADO a dos sitios: al <link rel="preconnect"> de index.html (que
  // precalienta este host exacto) y al patron con comodin que bloquea la red en
  // los scripts de verificacion. No lo reescribas con hosts literales.
  //
  // VENCE EN DICIEMBRE DE 2029, y no es una suposicion: el item publica
  // contentStatus 'deprecated', la categoria /Status/Retiring y la etiqueta
  // 'retiring-2029-12', y su descripcion abre con un Retirement Notice que dice
  // que esta en mature support desde julio de 2021 --o sea que sus datos no se
  // actualizan desde entonces. Se anota aqui porque el fallo que trajo hasta
  // aqui fue exactamente no tener escrito en ningun sitio que un servicio
  // gratuito puede acabarse. AGRAVANTE: el reemplazo que Esri recomienda es la
  // version VECTORIAL en basemaps.arcgis.com, que EXIGE token, asi que la via de
  // migracion oficial esta cerrada para un sitio estatico sin secretos.
  Claro: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Powered by Esri &middot; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community',
    maxZoom: 19,
    // 16 y no los 23 que declara el servicio. El corte es MUNDIAL, no un hueco
    // chileno: se verifico con /tilemap y comparando md5 de teselas z17 en siete
    // ciudades, incluida Nueva York. Sin esta linea el visor habria cambiado la
    // marca de agua de CARTO por un cartel gris en ingles, que es peor.
    maxNativeZoom: 16,
  },
  // El unico fondo oscuro y sin croma: gris plano #474749 en tierra y #232227 en
  // mar, con R=G y B solo +2. Cubre un hueco real del producto, porque el visor
  // ya sirve tema oscuro (COLOR_USO.oscuro) y los demas fondos son claros o
  // texturados.
  //
  // ENTRA COMO OPCION Y JAMAS COMO FONDO POR DEFECTO, y la razon esta medida: la
  // paleta se elige hoy por el TEMA y no por el mapa base, asi que esta capa
  // abre combinaciones que el validador nunca vio. Contra #474749, con la paleta
  // oscura, quedan bajo 3:1 cinco clases -- 04 Bosques 1,87:1 (la mas numerosa
  // del Catastro), 08 Cuerpos de Agua 2,10:1, 01 Urbanas 2,35:1, 05 Humedales
  // 2,77:1 y 06 Desprovistas 2,90:1-- y en tema claro sobre fondo oscuro el
  // violeta #4a3aa7 cae a ~1,09:1, o sea practicamente invisible.
  //
  // Se sostiene SOLO por la razon que ya explica el bloque de SIMBOLOGIA: el
  // color nunca es aqui la unica codificacion. Aislar la clase al marcarla,
  // tabla de superficie, la ficha del punto y los nombres en el modal de Uso.
  // ESA LISTA ENCOGIO --eran cuatro mecanismos con la leyenda siempre visible,
  // y la leyenda ya no esta en el panel--, asi que esta capa queda apoyada en
  // un margen mas estrecho que cuando se admitio. Si cae otro de los que
  // quedan, sale con el o se revalida la paleta contra este gris concreto.
  //
  // VENCE EN DICIEMBRE DE 2029, igual que Claro y por lo mismo: el item publica
  // contentStatus 'deprecated' y la etiqueta 'retiring-2029-12'. Las dos capas
  // Canvas caen el mismo mes, asi que la revision de esa fecha se hace una vez
  // para las dos.
  Oscuro: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Powered by Esri &middot; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community',
    maxZoom: 19,
    // Mismo servicio Canvas que Claro y por tanto el mismo techo real de z16.
    maxNativeZoom: 16,
    nota:
      'Fondo oscuro para contrastar las clases claras. Con la paleta oscura, cinco de las nueve ' +
      'clases quedan bajo 3:1 sobre este gris: guíate por la leyenda, el aislado por clase y la ' +
      'tabla de superficie, no sólo por el color.',
  },
  // Relieve, sin etiquetas, sin calles y sin rellenos politicos. Responde lo
  // unico que ninguna otra linea del menu responde: que FORMA tiene el terreno
  // bajo los puntos --cordillera, valle central, fiordos--, que en un catastro
  // de usos de la tierra es contexto y no adorno. Satelital y Sentinel-2
  // muestran cobertura, pero el relieve les queda enmascarado por la vegetacion
  // y por la sombra de la escena.
  //
  // ES Elevation/World_Hillshade Y NO World_Shaded_Relief, que es lo que uno
  // encuentra primero buscando "relieve" y seria la eleccion equivocada por dos
  // razones medidas. (1) SOPORTE: World_Shaded_Relief devuelve contentStatus
  // 'deprecated' con la etiqueta retiring-2028-03 y su aviso dice ademas "A
  // replacement item has not been identified at this time"; World_Hillshade
  // devuelve 'public_authoritative' y General Availability, sin aviso de retiro.
  // (2) CROMA: sobre la misma tesela de Valdivia z11, Shaded_Relief mide
  // saturacion media 25,9 y su color dominante es un azul de agua #9ebcd8 --que
  // es justo el que compite con 07 Nieves y 08 Cuerpos de Agua--, mientras que
  // Hillshade mide 3,3 y su dominante es un blanco #fafafa. Es el fondo mas
  // neutro de todos los medidos, incluido el CARTO que se sustituye.
  //
  // COSTES ASUMIDOS, para que nadie los redescubra. (1) NO DIBUJA LA COSTA: al
  // ser relieve puro, mar y tierra llana salen del mismo blanco, asi que se
  // pierde la silueta de Chile. Quien la necesite tiene Claro, que si la trae.
  // (2) El cache real se agota en z13 en zona rural --Valdivia, Patagonia y
  // Altiplano dan el cartel gris desde z14-- aunque en ciudad llega a z16 o mas.
  // Se fija 13 porque el dato del Catastro vive sobre todo en zona rural, que es
  // donde el techo es mas bajo.
  Relieve: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Powered by Esri &middot; Esri, Vantor, Airbus DS, USGS, NGA, NASA, CGIAR, NCEAS, NLS, OS, NMA',
    maxZoom: 19,
    maxNativeZoom: 13,
    nota:
      'Relieve puro, sin nombres, sin caminos y sin costa: mar y llanura salen del mismo blanco. ' +
      'El detalle se agota en el zoom 13 fuera de las ciudades. Para auditar un polígono, usa Satelital.',
  },
  // La unica reserva que no es Esri. Se queda por eso tanto como por lo que
  // muestra: si arcgisonline cambiara de politica, las otras cinco caen juntas.
  Calles: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
  },
  // Capa de CONSULTA, elegida a proposito, nunca fondo por defecto. Aporta lo
  // unico que no da ninguna otra: ALTITUD. Curvas de nivel con la cota rotulada
  // --se leyo "4300 m" sobre el Altiplano a z16-- mas hidrografia con nombre.
  // En un catastro de usos de la tierra la altura es el discriminante de las
  // Nieves y Glaciares, del limite arboreo y de las praderas altoandinas.
  //
  // EL CARGO EN SU CONTRA, medido y aceptado: dibuja la vegetacion como RELLENO
  // verde de superficie, y las dos clases mas abundantes del Catastro son
  // verdes. El 41,7 % de los pixeles de la tesela z11 de Valdivia queda a menos
  // de 0,25 en OKLab de alguna clase. Por eso es capa de consulta y no telon, y
  // por eso vale aqui la misma salvedad que en Oscuro: se sostiene porque el
  // color no es la unica codificacion del visor.
  //
  // Segundo coste: sobre campo abierto la capa se queda EN BLANCO LISO mucho
  // antes de agotarse el cache -- 5 de 8 teselas forestales del centro-sur ya
  // estan en blanco a z17. No lo arregla bajar maxNativeZoom, porque ese blanco
  // es un render legitimo y no una tesela que falte: estirar la de z16 daria
  // blanco borroso, y ademas emborronaria Santiago, Valdivia, Iquique y Punta
  // Arenas, donde SI hay pixel nativo verificado hasta z19.
  'Topográfico': {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    // ACORTADA: el copyrightText literal lista diecisiete proveedores en 268
    // caracteres, inviable en la barra de Leaflet. Se conservan los que aportan
    // a Chile y se quitan los regionales de otros continentes (Esri Japan, METI,
    // Kadaster NL, Ordnance Survey, Esri China...). Si CONAF exige la cadena
    // integra, va entera y se acepta que ocupe dos lineas.
    attribution:
      'Powered by Esri &middot; Esri, HERE, Garmin, Intermap, USGS, FAO, NPS, NRCAN, IGN &middot; &copy; OpenStreetMap contributors',
    // 19 CLAVADO: el servicio declara 23 y desde z20 devuelve el cartel gris.
    // Sin maxNativeZoom A PROPOSITO -- ver el segundo coste, arriba.
    maxZoom: 19,
    nota:
      'Curvas de nivel con altitud y toponimia, útil para situar un polígono. Dibuja la vegetación ' +
      'en verde, así que compite con las clases Bosques y Praderas: es capa de consulta, no telón.',
  },
  // Permite contrastar la clase catastral con lo que se ve en la imagen: es la
  // forma mas directa de auditar un poligono sin salir del visor.
  //
  // `fecha` declara COMO se sabe de cuando es la imagen, para que la etiqueta
  // del mapa no tenga que conocer cada proveedor: 'esri' se consulta al vuelo
  // por punto y zoom (ver src/hooks/useFechaImagen.js), 'fijo' es una fecha
  // conocida de antemano, y sin `fecha` no se muestra nada.
  //
  // LA UNICA CAPA ESRI QUE NO ESTA DEPRECADA, y conviene que este dicho y no
  // supuesto: World_Imagery publica contentStatus 'public_authoritative' y
  // categoria General Availability, sin aviso de retiro, mientras que las Canvas
  // y las heredadas de topografico y calles retiran en 2029-12. Que el proyecto
  // ya usara este host NO significa que las capas nuevas hereden sus
  // condiciones: heredan el host, no el estado de soporte. (Ojo: 'World Imagery
  // (Clarity)' es otro item y ese si retira en marzo de 2028.)
  //
  // 'Vantor' y no 'Maxar': Maxar Intelligence se renombro Vantor en octubre de
  // 2025 y el propio servicio ya publica 'Source: Esri, Vantor, Earthstar
  // Geographics, and the GIS User Community'. Se comprueba en el copyrightText
  // de MapServer?f=json, que es la fuente y no la memoria de nadie.
  Satelital: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Powered by Esri &middot; Esri, Vantor, Earthstar Geographics',
    maxZoom: 18,
    fecha: { tipo: 'esri' },
  },

  // Sentinel-2 cloudless de EOX: mosaico ANUAL sin nubes a 10 m, no la imagen
  // de la ultima pasada. Sentinel-2 revisita cada ~5 dias, pero acceder a esas
  // escenas sueltas exige credenciales de Copernicus Data Space, y este sitio es
  // estatico y no puede guardar un secreto. Lo que si es gratis y sin clave es
  // este compuesto.
  //
  // LICENCIA: CC BY-NC-SA 4.0, o sea NO COMERCIAL (la version 2016 es la unica
  // CC BY sin esa clausula, pero tiene una decada). CONAF es una institucion sin
  // fines de lucro del Estado de Chile y este visor entrega informacion publica
  // del Catastro de forma gratuita: ese es el encaje con la clausula, y lo
  // decidio CONAF, no este codigo. Si algun dia el visor se usara con fin
  // comercial, hay que revisarlo con EOX (https://cloudless.eox.at). La
  // atribucion de abajo es obligacion de la licencia y no se toca.
  //
  // maxNativeZoom 14: el dato nativo son 10 m/pixel, que a la latitud de Chile
  // se agota cerca de z14. Mas alla el servidor sigue entregando teselas, pero
  // son interpolacion: se deja que Leaflet estire la ultima real en vez de
  // pedir detalle que no existe.
  'Sentinel-2': {
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg',
    attribution:
      'Sentinel-2 cloudless 2025 por <a href="https://cloudless.eox.at">EOX</a> (datos Copernicus Sentinel modificados) &middot; CC BY-NC-SA 4.0',
    maxZoom: 18,
    maxNativeZoom: 14,
    // "sin fecha única" va en la ETIQUETA y no solo en la nota del panel: decir
    // solo "mosaico de 2025" invita a preguntar de que mes es, y la respuesta
    // es que no hay uno. La capa no declara dimension TIME ni trae campo de
    // fecha, asi que no existe forma de saber la fecha de un pixel.
    fecha: { tipo: 'fijo', texto: 'Compuesto de todo 2025 · sin fecha única' },
    // Estaba escrita a mano en PanelLateral.jsx, condicionada por el literal
    // 'Sentinel-2'. Vive aqui, junto a la licencia que la motiva, porque la nota
    // y la clausula que la obliga no pueden acabar en archivos distintos.
    nota:
      'Compuesto anual sin nubes a 10 m, no la última pasada del satélite. Licencia ' +
      'CC BY-NC-SA 4.0 (no comercial).',
  },
}

/* ---------------------------------------------------------------------------
   SIMBOLOGIA DE USO DE SUELO — validada, no elegida a ojo.

   Nueve clases oficiales del Catastro, en ORDEN DE CODIGO (01..09). El indice
   viaja en el .bin y en la URL compartible, asi que reordenarlo por frecuencia
   haria que un enlace guardado apuntase a otro uso tras cualquier reproceso.

   VALIDADA con el validador de paletas (OKLab, ΔE x100), no por gusto. La
   primera version de estos colores, escogida a ojo, fallaba los CINCO chequeos.
   Resultado de la definitiva:

     CLARO   todas las puertas PASAN. Peor par adyacente CVD ΔE 9,1 (protan);
             peor par en vision normal ΔE 15,6. Cuatro tonos quedan bajo 3:1 de
             contraste contra la superficie clara -> aplica la REGLA DE RELIEVE:
             leyenda visible y vista de tabla, que este visor trae.
     OSCURO  croma, separacion CVD (9,1), suelo de vision normal (15,6) y
             contraste (todos >= 3:1) PASAN. Se sale de la banda de luminosidad
             en cuatro tonos, y se acepta a sabiendas: re-escalonarlos para
             entrar en banda hundio la separacion de 15,6 a 8,5 medido, o sea
             empeoraba justo lo que el lector percibe.

   LO QUE NINGUNA PALETA ARREGLA: un mapa de puntos es un caso de TODOS LOS
   PARES -- cualquier clase puede quedar junto a cualquier otra-- y ahi ni
   siquiera las ocho ranuras ya validadas de la guia pasan (CVD ΔE 3,2 medido).
   Con nueve clases simultaneas el color SOLO no basta, y no es opinable.
   Por eso el color NUNCA es la unica codificacion aqui. ESTE BLOQUE DECIA
   CUATRO MECANISMOS Y ERA FALSO: el tooltip al pasar por encima nunca llego a
   implementarse --se prometia una capacidad inexistente-- y la leyenda salio
   del panel al pasar todos los controles a botonera. Lo que hay HOY, contado
   como esta:
     - al marcar una clase el mapa la AISLA (una sola serie: trivialmente
       distinguible). Este es el mecanismo fuerte y el unico que actua sobre el
       propio mapa;
     - la tabla de superficie por uso, con las mismas cifras y siempre a la
       vista en el panel de indicadores;
     - la ficha del punto nombra su clase en texto al pulsarlo;
     - los nombres de los nueve colores, con su superficie, en el modal de Uso.
       ESTE ESTA A UN CLIC, no a la vista: es lo que se perdio al quitar la
       leyenda del panel, y la tira de chips del boton no lo sustituye porque
       ordena los tonos sin nombrarlos.
   El saldo real es que la lectura del mapa SIN interactuar depende mas del
   color que antes. Quitar el aislar-al-marcar o la tabla de superficie si
   rompe la accesibilidad; lo que ya se quito la empeoro.
   --------------------------------------------------------------------------- */
export const COLOR_USO = {
  claro: {
    '01': '#e34948', // Áreas Urbanas e Industriales
    '02': '#eda100', // Terrenos Agrícolas
    '03': '#1baf7a', // Praderas y Matorrales
    '04': '#008300', // Bosques
    '05': '#4a3aa7', // Humedales
    '06': '#eb6834', // Áreas Desprovistas de Vegetación
    '07': '#2fb6dc', // Nieves Eternas y Glaciares
    '08': '#2a78d6', // Cuerpos de Agua
    '09': '#e87ba4', // Áreas no Reconocidas
  },
  // Mismos tonos; solo el violeta sube de paso, que era el unico por debajo de
  // 3:1 contra la superficie oscura.
  oscuro: {
    '01': '#e34948',
    '02': '#eda100',
    '03': '#1baf7a',
    '04': '#008300',
    '05': '#8d7ee8',
    '06': '#eb6834',
    '07': '#2fb6dc',
    '08': '#2a78d6',
    '09': '#e87ba4',
  },
}

/** Los colores como [r,g,b] para el atributo binario de deck.gl. */
export function paletaRGB(modo = 'claro') {
  const tabla = COLOR_USO[modo] ?? COLOR_USO.claro
  return Object.keys(tabla)
    .sort()
    .map((k) => {
      const h = tabla[k]
      return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
    })
}

export const fmt = new Intl.NumberFormat('es-CL')
export const fmt1 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 })

const fechaES = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * Toma los componentes de la fecha tal cual vienen y arma una fecha LOCAL.
 * Con `new Date(iso)` la cadena se interpreta en UTC y se muestra en hora local,
 * y en Chile (UTC-4/-3) todo lo anterior a las 03:00/04:00 UTC retrocede un dia.
 */
export function fechaLarga(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? fechaES.format(new Date(+m[1], +m[2] - 1, +m[3])) : null
}

/* ---------------------------------------------------------------------------
   COPIA CANONICA — lo que este visor NO es.

   El patron del programa es que la interfaz declare explicitamente que NO esta
   viendo el usuario. Aqui el malentendido caro es distinto al del visor de
   incendios: un punto por poligono invita a leer "un arbol", "una parcela" o
   "un predio", y no es nada de eso. Vive aqui, en una sola redaccion, porque
   dos textos paralelos divergen a la primera edicion.
   --------------------------------------------------------------------------- */
export const AVISO_PUNTOS =
  'Cada punto es el centroide de un polígono del Catastro, no una parcela ni un predio. ' +
  'Su posición representa al polígono completo; la superficie real está en el atributo.'

export const AVISO_SERIE =
  'El Catastro no es una serie temporal: cada región se actualizó en un año distinto, ' +
  'entre 2014 y 2024. Comparar regiones entre sí compara fotos de años distintos.'
