import { DATA } from '../config'
import { derivarDeEspecie } from './derivadas'

/**
 * Carga la capa de render: manifest.json (el contrato) + cbn_puntos.bin.
 *
 * El .bin es columnar puro, sin cabecera: los offsets los declara el manifest y
 * aqui solo se abren vistas tipadas sobre el mismo ArrayBuffer. Cero parseo y
 * cero copia, salvo las dos obligatorias que se explican abajo.
 *
 * El frontend NO hardcodea ningun dominio: los usos, subusos, estructuras,
 * tipos forestales, unidades del SNASPE, comunas y regiones salen del manifest
 * con sus etiquetas y sus cifras. Si el ETL cambia el vocabulario, la interfaz
 * cambia sola.
 */

const CONSTRUCTOR = { f32: Float32Array, u16: Uint16Array, u8: Uint8Array }
const ANCHO = { f32: 4, u16: 2, u8: 1 }

export async function cargarPuntos(señal) {
  // El manifest se pide SIN caché: es el índice, pesa poco, y si llega viejo
  // arrastra consigo la versión equivocada de todo lo demás.
  const man = await pedir(`${DATA}/manifest.json`, señal, { cache: 'no-cache' })
    .then((r) => r.json())
  if (man.esquema !== 5) {
    // Ruidoso a proposito: un manifest de otra version abriria vistas tipadas
    // perfectamente validas sobre offsets equivocados, y el mapa saldria
    // PLAUSIBLE, con los puntos desplazados. Es el peor fallo posible.
    throw new Error(
      `manifest.json declara esquema ${man.esquema} y este visor lee el 5. ` +
        'Vuelve a generar los datos con `python ETL/build_bin.py`.',
    )
  }
  const capa = man.capas?.cbn_puntos
  if (!capa) throw new Error('manifest.json no declara la capa cbn_puntos')

  // El sha256 va en la URL, y no es adorno: el .bin se llama siempre igual, así
  // que sin esto un navegador que ya lo visitó reutiliza su copia en caché y la
  // contrasta contra un manifest nuevo. El síntoma exacto es el error de abajo,
  // con el tamaño viejo (23.763.129 B = 13 B/fila, el formato de 4 columnas)
  // contra el declarado. Vite pone hash a JS y CSS, pero lo de public/ se copia
  // con el mismo nombre, y GitHub Pages sirve con max-age=600 y no deja
  // configurar cabeceras.
  const buf = await pedir(
    `${DATA}/${capa.archivo}?v=${capa.sha256.slice(0, 12)}`,
    señal,
  ).then((r) => r.arrayBuffer())
  const n = capa.filas

  const esperado = Object.values(capa.campos).reduce((a, c) => a + ANCHO[c.tipo] * n, 0)
  if (buf.byteLength !== esperado) {
    const filasQueCabrian = buf.byteLength / (esperado / n)
    throw new Error(
      `${capa.archivo} mide ${buf.byteLength} bytes y el manifest declara ${esperado}.\n\n` +
        'Se prefiere no dibujar: un .bin de otro tamaño abre vistas tipadas válidas sobre ' +
        'basura y pondría los puntos en medio del Pacífico sin dar ningún error.\n\n' +
        (Number.isInteger(filasQueCabrian)
          ? 'Lo más probable es una copia en caché de una versión anterior de los datos. ' +
            'Recarga forzando la actualización (Ctrl+Shift+R, o Cmd+Shift+R en Mac).'
          : 'El archivo parece truncado o incompleto.'),
    )
  }

  // Vistas sin copia sobre el mismo ArrayBuffer.
  const col = {}
  for (const [nombre, c] of Object.entries(capa.campos)) {
    col[nombre] = new CONSTRUCTOR[c.tipo](buf, c.offset, n)
  }

  // Interleavado a [x, y, z]. Es la unica copia inevitable: deck.gl quiere las
  // posiciones juntas y el .bin las guarda por columna, que es lo que permite
  // leer las demas sin tocar el resto.
  const pos = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    pos[i * 3] = col.lon[i]
    pos[i * 3 + 1] = col.lat[i]
  }

  return { n, ...col, ...derivarDeEspecie(col.especie, n, man), pos, manifest: man, capa }
}

/** RGBA por punto a partir del indice de uso. Se recalcula al cambiar de tema. */
export function tablaColor(uso, n, paletaRGB) {
  const col = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const c = paletaRGB[uso[i]]
    if (!c) continue // fuera de vocabulario: transparente, para que se NOTE
    col[i * 4] = c[0]
    col[i * 4 + 1] = c[1]
    col[i * 4 + 2] = c[2]
    col[i * 4 + 3] = 255
  }
  return col
}

/**
 * La mascara de "todo pasa", para cuando no hay ningun filtro.
 *
 * Un memset, sin recorrer nada. El cruce de verdad vive en `resumenYMarginales`
 * (indicadores.js), que produce la mascara Y las cifras en la MISMA pasada: dos
 * recorridos de 1,8 M de filas por cada clic de casilla era el precio de tener
 * el filtrado y la agregacion en dos sitios distintos.
 *
 * El vocabulario de las dimensiones tambien vive alli, y no aqui: indicadores.js
 * declara en su cabecera que se puede contrastar con `node` sin montar nada, y
 * este modulo importa `config.js`, que usa `import.meta.env`. Importarlo desde
 * la aritmetica romperia esa propiedad en silencio.
 */
export function mascaraTodo(n) {
  return new Uint8Array(n).fill(1)
}

async function pedir(url, señal, opciones = {}) {
  const r = await fetch(url, { signal: señal, ...opciones })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r
}
