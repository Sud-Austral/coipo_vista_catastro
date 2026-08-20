/**
 * El estado que se puede compartir, en la query string.
 *
 * Existe porque el panel dice «el enlace guarda el ámbito, las clases activas y
 * el mapa base», y una interfaz que promete eso y no lo cumple es peor que una
 * que no lo promete.
 *
 * Esquema: ?reg=&prov=&com=&usos=&base=&lat=&lon=&z=
 * `usos` va como lista de códigos separados por coma —«04,03»— y no de índices:
 * un índice depende del orden del manifest, y un enlace guardado en un correo
 * tiene que sobrevivir a un reproceso del ETL.
 */

const RESERVADAS = ['reg', 'prov', 'com', 'usos', 'base', 'lat', 'lon', 'z']

export function leerURL() {
  const q = new URLSearchParams(window.location.search)
  const estado = { ambito: { region: null, provincia: null, comuna: null } }
  if (q.get('reg')) estado.ambito.region = q.get('reg')
  if (q.get('prov')) estado.ambito.provincia = q.get('prov')
  if (q.get('com')) estado.ambito.comuna = q.get('com')
  const usos = q.get('usos')
  // '' significa «ninguna clase», que no es lo mismo que ausente («todas»).
  if (usos !== null) estado.usos = usos ? usos.split(',') : []
  if (q.get('base')) estado.base = q.get('base')
  const lat = parseFloat(q.get('lat'))
  const lon = parseFloat(q.get('lon'))
  const z = parseInt(q.get('z'), 10)
  if (Number.isFinite(lat) && Number.isFinite(lon)) estado.centro = [lat, lon]
  if (Number.isFinite(z)) estado.zoom = z
  return estado
}

let pendiente = null
let ultimo = null
// Acumulado y NO un parámetro del setTimeout: hay UN SOLO temporizador
// compartido, así que un moveend que caiga dentro de los 250 ms siguientes a un
// cambio de ámbito cancelaría la escritura de ese ámbito y se quedaría con la
// suya. Sin acumular, elegir una región y mover el mapa a la vez perdía la
// entrada de historial de la región en silencio.
let empujar = false

export function escribirURL(estado, { push = false } = {}) {
  ultimo = estado
  empujar ||= push
  clearTimeout(pendiente)
  // Se agrupa: moveend dispara muchas veces durante un paneo, y cada una sería
  // una entrada de historial.
  pendiente = setTimeout(aplicar, 250)
}

function aplicar() {
  clearTimeout(pendiente)
  pendiente = null
  if (!ultimo) return
  const { ambito, usos, base, centro, zoom } = ultimo
  const q = new URLSearchParams()
  if (ambito?.region) q.set('reg', ambito.region)
  if (ambito?.provincia) q.set('prov', ambito.provincia)
  if (ambito?.comuna) q.set('com', ambito.comuna)
  if (usos && usos.length) q.set('usos', usos.join(','))
  if (base && base !== 'Claro') q.set('base', base)
  if (centro) {
    // 4 decimales ≈ 11 m. Más precisión sólo alarga el enlace.
    q.set('lat', centro[0].toFixed(4))
    q.set('lon', centro[1].toFixed(4))
  }
  if (zoom != null) q.set('z', String(zoom))
  const cadena = q.toString()
  const url = cadena ? `${window.location.pathname}?${cadena}` : window.location.pathname
  // pushState sólo para lo que el usuario reconoce como «hice algo» —ámbito,
  // clases, mapa base—; el paneo va con replaceState, o cada arrastre del mapa
  // llenaría el historial de basura.
  if (empujar) window.history.pushState(null, '', url)
  else window.history.replaceState(null, '', url)
  empujar = false
}

/**
 * Vuelca lo pendiente AHORA. Obligatorio antes de copiar el enlace: la URL se
 * escribe con 250 ms de retraso, así que sin esto pulsar «Compartir» justo
 * después de mover el mapa copia el encuadre ANTERIOR.
 */
export function flush() {
  if (pendiente) aplicar()
}

export { RESERVADAS }
