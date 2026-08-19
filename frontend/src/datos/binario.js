import { DATA } from '../config'

/**
 * Carga la capa de render: manifest.json (el contrato) + cbn_puntos.bin.
 *
 * El .bin es columnar puro, sin cabecera: los offsets los declara el manifest y
 * aqui solo se abren vistas tipadas sobre el mismo ArrayBuffer. Cero parseo y
 * cero copia -- salvo las dos que son obligatorias, el interleavado de
 * posiciones y la tabla de color, que se explican abajo.
 *
 * El frontend NO hardcodea ningun dominio: los nueve usos, sus etiquetas y sus
 * cifras salen del manifest. Si el ETL cambia el vocabulario, la leyenda cambia
 * sola.
 */
export async function cargarPuntos(paletaRGB, señal) {
  const man = await pedir(`${DATA}/manifest.json`, señal).then((r) => r.json())
  const capa = man.capas?.cbn_puntos
  if (!capa) throw new Error('manifest.json no declara la capa cbn_puntos')

  const buf = await pedir(`${DATA}/${capa.archivo}`, señal).then((r) => r.arrayBuffer())
  const n = capa.filas

  const esperado = n * 4 * 3 + n
  if (buf.byteLength !== esperado) {
    // Ruidoso a proposito: un .bin truncado abriria vistas tipadas validas sobre
    // basura y el mapa saldria con puntos en medio del Pacifico.
    throw new Error(`cbn_puntos.bin mide ${buf.byteLength} y el manifest declara ${esperado}`)
  }

  const c = capa.campos
  const lon = new Float32Array(buf, c.lon.offset, n)
  const lat = new Float32Array(buf, c.lat.offset, n)
  const ha = new Float32Array(buf, c.ha.offset, n)
  const uso = new Uint8Array(buf, c.uso.offset, n)

  // Interleavado a [x, y, z]. Es la unica copia inevitable: deck.gl quiere las
  // posiciones juntas y el .bin las guarda por columna, que es lo que permite
  // que lon/lat/ha/uso se lean sin tocar el resto.
  const pos = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    pos[i * 3] = lon[i]
    pos[i * 3 + 1] = lat[i]
  }

  return { n, lon, lat, ha, uso, pos, manifest: man, capa, color: tablaColor(uso, n, paletaRGB) }
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

/** Canal de filtro, 1 byte por punto: 1 visible, 0 oculto. */
export function canalFiltro(uso, n, usosActivos) {
  const f = new Uint8Array(n)
  if (!usosActivos || usosActivos.size === 0) return f.fill(1)
  for (let i = 0; i < n; i++) f[i] = usosActivos.has(uso[i]) ? 1 : 0
  return f
}

async function pedir(url, señal) {
  const r = await fetch(url, { signal: señal })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r
}
