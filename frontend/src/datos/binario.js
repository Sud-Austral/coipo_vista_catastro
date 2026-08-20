import { DATA } from '../config'

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
  const man = await pedir(`${DATA}/manifest.json`, señal).then((r) => r.json())
  if (man.esquema !== 2) {
    // Ruidoso a proposito: un manifest de otra version abriria vistas tipadas
    // perfectamente validas sobre offsets equivocados, y el mapa saldria
    // PLAUSIBLE, con los puntos desplazados. Es el peor fallo posible.
    throw new Error(
      `manifest.json declara esquema ${man.esquema} y este visor lee el 2. ` +
        'Vuelve a generar los datos con `python ETL/build_bin.py`.',
    )
  }
  const capa = man.capas?.cbn_puntos
  if (!capa) throw new Error('manifest.json no declara la capa cbn_puntos')

  const buf = await pedir(`${DATA}/${capa.archivo}`, señal).then((r) => r.arrayBuffer())
  const n = capa.filas

  const esperado = Object.values(capa.campos).reduce((a, c) => a + ANCHO[c.tipo] * n, 0)
  if (buf.byteLength !== esperado) {
    throw new Error(
      `${capa.archivo} mide ${buf.byteLength} bytes y el manifest declara ${esperado}. ` +
        'Se prefiere no dibujar: un .bin truncado abre vistas tipadas válidas sobre ' +
        'basura y pondría puntos en medio del Pacífico sin ningún error.',
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

  return { n, ...col, pos, manifest: man, capa }
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
 * Canal de filtro, 1 byte por punto: 1 visible, 0 oculto.
 *
 * `ambito` restringe por territorio y `usos` por clase. Un Set vacio significa
 * "todas", no "ninguna": es la diferencia entre no haber filtrado y haber
 * filtrado a cero, y confundirlas deja el mapa en negro sin explicacion.
 */
export function canalFiltro(datos, { usos, comunas }) {
  const { n, uso, comuna } = datos
  const f = new Uint8Array(n)
  const porUso = usos && usos.size > 0
  const porComuna = comunas && comunas.size > 0
  if (!porUso && !porComuna) return f.fill(1)
  for (let i = 0; i < n; i++) {
    if (porUso && !usos.has(uso[i])) continue
    if (porComuna && !comunas.has(comuna[i])) continue
    f[i] = 1
  }
  return f
}

async function pedir(url, señal) {
  const r = await fetch(url, { signal: señal })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r
}
