/**
 * Qué página estática corresponde a la vista que se está por compartir.
 *
 * Compartir entrega la URL de la vista exacta (`?reg=14&com=14101&lat=…`), y esa URL
 * muestra en WhatsApp la vista previa de la PORTADA: GitHub Pages no mira la query,
 * así que no hay forma de que la tarjeta diga «Valdivia». La página
 * /comuna/valdivia/ sí la tiene, y además lleva la frase citable. Se ofrece sólo
 * cuando la vista ES exactamente ese territorio: con un uso o un filtro marcado, las
 * cifras de la página serían otras que las de la pantalla, y ofrecerla engañaría.
 *
 * Puro, con pruebas en Node. El índice (web/indice.json) lo escribe el generador; el
 * slug NUNCA se recalcula aquí.
 */
import { BASE, ESQUEMA_INDICE } from './sitio.js'

// Lo único que puede traer la URL para que la vista sea «el territorio a secas».
// `usos` no está a propósito: incluso vacío significa «ninguna clase» (§G).
const DEL_TERRITORIO = new Set(['reg', 'prov', 'com', 'base', 'lat', 'lon', 'z'])

/** La ruta de la página (`/coipo_vista_catastro/comuna/valdivia/`) o null. */
export function paginaDelEnlace(search, indice, manifest) {
  if (indice?.esquema !== ESQUEMA_INDICE) return null
  const q = new URLSearchParams(search)
  for (const k of q.keys()) if (!DEL_TERRITORIO.has(k)) return null
  const reg = q.get('reg')
  if (!reg) return null
  const com = q.get('com')
  const prov = q.get('prov')
  if (com) {
    const c = manifest?.comunas?.find((x) => x.cod === com)
    if (!c || c.region !== reg) return null
    // Región → Provincia → Comuna deja la provincia en la URL: vale si es la suya.
    if (prov && c.provincia !== prov) return null
    const slug = indice.comunas?.[com]
    return slug ? `${BASE}comuna/${slug}/` : null
  }
  // Una provincia sola no tiene página (sólo existen como nombre, sin código).
  if (prov) return null
  const slug = indice.regiones?.[reg]
  return slug ? `${BASE}region/${slug}/` : null
}

/**
 * Lee web/indice.json. Devuelve null ante cualquier cosa rara: un 404 (en `npm run
 * dev` no existe), HTML en vez de JSON (el servidor de desarrollo responde con
 * index.html a cualquier ruta) o un esquema que este código no entiende.
 */
export async function cargarIndiceWeb(base, pedir = fetch) {
  try {
    const r = await pedir(`${base}web/indice.json`, { cache: 'no-cache' })
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null
    const indice = await r.json()
    return indice?.esquema === ESQUEMA_INDICE ? indice : null
  } catch {
    return null
  }
}
