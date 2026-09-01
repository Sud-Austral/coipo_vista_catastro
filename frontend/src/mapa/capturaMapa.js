/**
 * Copia el mapa TAL COMO SE ESTÁ VIENDO a una imagen, para el reporte.
 *
 * El mapa son dos capas superpuestas y de naturaleza distinta: las teselas del
 * fondo, que son `<img>` colocadas por Leaflet con transformaciones CSS, y el
 * lienzo WebGL de deck.gl con el 1,8 M de puntos ya filtrado. Aquí se componen
 * las dos en un `<canvas>` 2D y se saca un PNG.
 *
 * LAS TESELAS SE DIBUJAN POR SU RECTÁNGULO EN PANTALLA, no reconstruyendo la
 * proyección. `getBoundingClientRect()` ya trae resueltas todas las
 * transformaciones que Leaflet encadena —la del panel, la del contenedor de
 * teselas y la de cada tesela—, así que el resultado coincide con lo que se ve
 * sin tener que replicar su aritmética. Replicarla sería inventar una segunda
 * fuente de verdad para la misma pregunta.
 *
 * HIZO FALTA `crossOrigin` EN LA CAPA DE TESELAS. Sin él, dibujar una tesela en
 * un canvas lo MANCHA y `toDataURL()` lanza `SecurityError` — medido. Los siete
 * fondos que sirve el visor mandan `Access-Control-Allow-Origin`, comprobado
 * uno a uno y también desde un origen local, así que pedirlas en modo CORS no
 * rompe ninguno.
 *
 * NO DESCARTA LA IMAGEN POR SALIR VACÍA, y esto se pensó dos veces. Un lienzo
 * WebGL sin `preserveDrawingBuffer` devuelve un PNG válido y completamente
 * transparente sin lanzar nada —medido: 18 KB y cero píxeles—, así que la
 * tentación es rechazar toda composición sin contenido. El problema es que
 * «vacía por un fallo» y «vacía porque el filtro no deja nada» se ven igual:
 * con `?uso=09` quedan cinco polígonos en todo Chile, y descartar esa copia
 * sería llamar error a un mapa correcto.
 *
 * Así que devuelve SIEMPRE lo que compuso, con `contenido` medido, y el reporte
 * rotula la lámina en consecuencia. Del fallo sistemático —que dejaría en blanco
 * TODOS los reportes— se encarga la declaración explícita de
 * `preserveDrawingBuffer` en CapaPuntos y la aserción V-57d, que decodifica la
 * imagen y cuenta píxeles en cada verificación.
 */

/**
 * Cuánto de la imagen tiene CONTENIDO, de 0 a 1.
 *
 * Se compara contra el color MÁS REPETIDO de la propia imagen, no contra la
 * transparencia. La primera versión contaba píxeles con alfa > 0 y era
 * inútil: como aquí se rellena el fondo antes de dibujar nada, el alfa vale 1
 * en toda la imagen y la medida daba 100 % incluso sobre un lienzo en blanco.
 * Una guarda que no puede fallar no es una guarda, y ésta existe justo para
 * cazar el caso en que deck.gl devuelve un PNG vacío.
 */
function fraccionConContenido(ctx, ancho, alto) {
  // SE MUESTREAN FILAS, PERO ENTERAS. Muestrear también dentro de la fila
  // —cada 9 px— hacía que la medida no encontrara nada: a escala de región los
  // discos miden 1,2 px y la rejilla pasaba por encima de casi todos. Medido:
  // daba 0,48 % sobre un mapa con puntos de sobra, y la captura se descartaba
  // por vacía. Una malla más gruesa que aquello que busca no mide, sortea.
  const salto = Math.max(1, Math.floor(alto / 80))
  const muestras = []
  for (let y = 0; y < alto; y += salto) {
    const fila = ctx.getImageData(0, y, ancho, 1).data
    for (let x = 0; x < ancho; x += 1) {
      const i = x * 4
      muestras.push(
        fila[i + 3] < 8 ? -1 : (fila[i] << 16) | (fila[i + 1] << 8) | fila[i + 2],
      )
    }
  }
  if (!muestras.length) return 0
  const cuenta = new Map()
  for (const v of muestras) cuenta.set(v, (cuenta.get(v) ?? 0) + 1)
  let fondo = -1
  let mayor = -1
  for (const [v, c] of cuenta) if (c > mayor) { mayor = c; fondo = v }
  return muestras.filter((v) => v !== fondo).length / muestras.length
}

export function capturarMapa(contenedor) {
  if (!contenedor) return null
  const caja = contenedor.getBoundingClientRect()
  const ancho = Math.round(caja.width)
  const alto = Math.round(caja.height)
  if (ancho < 40 || alto < 40) return null

  // El doble de resolución, acotado: el reporte se imprime, y una imagen a
  // tamaño de pantalla se ve pixelada en papel. Acotado porque un data URI
  // entra entero en el DOM y a 3x son varios megabytes de cadena.
  const escala = Math.min(2, window.devicePixelRatio || 1)
  const lienzo = document.createElement('canvas')
  lienzo.width = Math.round(ancho * escala)
  lienzo.height = Math.round(alto * escala)
  const ctx = lienzo.getContext('2d')
  if (!ctx) return null
  ctx.scale(escala, escala)

  // El fondo del contenedor primero: con las teselas bloqueadas o aún cargando,
  // lo que se ve es ese color, y una imagen transparente sobre papel blanco
  // mentiría sobre lo que había en pantalla.
  const fondo = getComputedStyle(contenedor).backgroundColor
  if (fondo && fondo !== 'rgba(0, 0, 0, 0)') {
    ctx.fillStyle = fondo
    ctx.fillRect(0, 0, ancho, alto)
  }

  let teselas = 0
  try {
    for (const im of contenedor.querySelectorAll('img.leaflet-tile')) {
      // Las que están apareciendo llevan opacidad parcial: se saltan las
      // invisibles para no ensuciar con teselas a medio cargar.
      if (!im.complete || im.naturalWidth === 0) continue
      if (parseFloat(getComputedStyle(im).opacity || '1') < 0.5) continue
      const r = im.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) continue
      ctx.drawImage(im, r.left - caja.left, r.top - caja.top, r.width, r.height)
      teselas += 1
    }
  } catch {
    // Una tesela sin CORS mancharía el lienzo y el `toDataURL` de abajo
    // lanzaría. Se sigue sin fondo antes que perder el mapa entero.
    return capturarSoloPuntos(contenedor, caja, escala)
  }

  const gl = contenedor.querySelector('.deck-overlay canvas')
  if (gl && gl.width > 0) {
    ctx.drawImage(gl, 0, 0, ancho, alto)
  }

  try {
    return {
      url: lienzo.toDataURL('image/png'),
      ancho,
      alto,
      teselas,
      contenido: fraccionConContenido(ctx, lienzo.width, lienzo.height),
    }
  } catch {
    // Sólo se llega aquí si el lienzo quedó manchado, y entonces no hay imagen
    // que devolver: `toDataURL` ha lanzado.
    return null
  }
}

/** Plan B: sólo la capa de puntos, cuando el fondo no se deja copiar. */
function capturarSoloPuntos(contenedor, caja, escala) {
  const gl = contenedor.querySelector('.deck-overlay canvas')
  if (!gl || !gl.width) return null
  const ancho = Math.round(caja.width)
  const alto = Math.round(caja.height)
  const lienzo = document.createElement('canvas')
  lienzo.width = Math.round(ancho * escala)
  lienzo.height = Math.round(alto * escala)
  const ctx = lienzo.getContext('2d')
  ctx.scale(escala, escala)
  ctx.drawImage(gl, 0, 0, ancho, alto)
  try {
    return {
      url: lienzo.toDataURL('image/png'),
      ancho,
      alto,
      teselas: 0,
      contenido: fraccionConContenido(ctx, lienzo.width, lienzo.height),
    }
  } catch {
    return null
  }
}
