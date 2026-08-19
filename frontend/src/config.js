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

export const BASEMAPS = {
  // Fondo neutro y claro: es el unico que deja leer 1,83 millones de puntos
  // superpuestos sin que el mapa base compita con el dato.
  //
  // Host SIN {s}: el reparto por subdominios (a/b/c/d) era una tecnica de
  // HTTP/1.1 para saltarse el limite de 6 conexiones por host. Sobre HTTP/2 una
  // sola conexion multiplexa todas las teselas, asi que los tres apretones de
  // mano extra son perdida pura.
  //
  // ACOPLADO a dos sitios: al <link rel="preconnect"> de index.html (que
  // precalienta este host exacto) y al patron con comodin que bloquea la red en
  // los scripts de verificacion. No lo reescribas con hosts literales.
  Claro: {
    url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &middot; &copy; CARTO',
    maxZoom: 19,
  },
  Calles: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
  },
  // Permite contrastar la clase catastral con lo que se ve en la imagen: es la
  // forma mas directa de auditar un poligono sin salir del visor.
  //
  // `fecha` declara COMO se sabe de cuando es la imagen, para que la etiqueta
  // del mapa no tenga que conocer cada proveedor: 'esri' se consulta al vuelo
  // por punto y zoom (ver src/hooks/useFechaImagen.js), 'fijo' es una fecha
  // conocida de antemano, y sin `fecha` no se muestra nada.
  Satelital: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri, Maxar, Earthstar Geographics',
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
   Por eso el color NUNCA es la unica codificacion aqui:
     - la leyenda esta siempre visible,
     - al pulsar una clase el mapa la AISLA (una sola serie: trivialmente
       distinguible),
     - el tooltip nombra la clase al pasar por encima,
     - y existe la tabla de superficie por uso con las mismas cifras.
   Quitar cualquiera de esas cuatro cosas rompe la accesibilidad del mapa, no
   solo su comodidad.
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
