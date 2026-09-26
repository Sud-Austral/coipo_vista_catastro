/**
 * El <head> de lo que se hornea: descripción, canonical, vista previa (og:, twitter:)
 * y datos estructurados. Funciones puras que devuelven TEXTO; el render en Node las
 * escribe en el HTML.
 *
 * Reglas que no se ven y cuestan caro:
 *   - canonical y og:url ABSOLUTOS. Una vista previa de WhatsApp o Facebook no
 *     resuelve rutas relativas, y descarta la tarjeta entera.
 *   - og:url = canonical + `?v=<version>`. Facebook y LinkedIn guardan la vista
 *     previa por og:url durante días: si la tarjeta cambia y la URL no, siguen
 *     enseñando la vieja. La versión la calcula quien llama (con crypto de Node) a
 *     partir de título, descripción e imagen, así cambia exactamente cuando cambia lo
 *     que se ve. El canonical va SIN versión: el buscador ve una sola dirección.
 *   - Sin og:image mientras no exista la imagen: una og:image que da 404 hace que
 *     varios lectores descarten la tarjeta ENTERA, y es peor que no tenerla.
 *   - JSON-LD escapado con <, >, & y NUNCA con entidades HTML: el
 *     contenido de <script> no decodifica entidades. Un nombre con «</script>»
 *     cerraría el bloque.
 */
import { NOMBRE_SITIO, TITULO, UMAMI } from './sitio.js'

export function escaparHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;')
}

// Claves ordenadas: dos construcciones del mismo commit tienen que dar los mismos
// bytes, y el orden de inserción de un objeto no es algo que se quiera vigilar.
function ordenado(v) {
  if (Array.isArray(v)) return v.map(ordenado)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenado(v[k])]))
  }
  return v
}

/** El bloque <script type="application/ld+json">, escapado para vivir dentro de <script>. */
export function jsonLd(obj) {
  const texto = JSON.stringify(ordenado(obj))
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
  return `<script type="application/ld+json">${texto}</script>`
}

const meta = (atr, nombre, contenido) =>
  `<meta ${atr}="${nombre}" content="${escaparHtml(contenido)}" />`

/**
 * Las etiquetas de la vista previa. `imagen` es { url, ancho, alto, alt } o null.
 * Con imagen la tarjeta es grande (summary_large_image); sin ella, `summary`.
 */
export function metasVistaPrevia({ canonical, titulo, descripcion, imagen, version }) {
  const lineas = [
    meta('name', 'description', descripcion),
    `<link rel="canonical" href="${escaparHtml(canonical)}" />`,
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', NOMBRE_SITIO),
    meta('property', 'og:locale', 'es_CL'),
    meta('property', 'og:url', `${canonical}?v=${version}`),
    meta('property', 'og:title', titulo),
    meta('property', 'og:description', descripcion),
  ]
  if (imagen) {
    lineas.push(
      meta('property', 'og:image', imagen.url),
      meta('property', 'og:image:secure_url', imagen.url),
      meta('property', 'og:image:type', 'image/png'),
      meta('property', 'og:image:width', String(imagen.ancho)),
      meta('property', 'og:image:height', String(imagen.alto)),
      meta('property', 'og:image:alt', imagen.alt),
      meta('name', 'twitter:card', 'summary_large_image'),
      meta('name', 'twitter:image', imagen.url),
    )
  } else {
    lineas.push(meta('name', 'twitter:card', 'summary'))
  }
  lineas.push(meta('name', 'twitter:title', titulo), meta('name', 'twitter:description', descripcion))
  return lineas
}

/**
 * La etiqueta de Umami, o nada si el sitio todavía no tiene identificador.
 * `autoTrack` en false para la app: el visor reescribe la URL en cada paneo y Umami
 * contaría una visita por cada movimiento del mapa (lo registra la app a mano).
 */
export function etiquetaUmami({ autoTrack = true } = {}) {
  if (!UMAMI.id) return ''
  const extra = autoTrack ? '' : ' data-auto-track="false"'
  return (
    `<script defer src="${UMAMI.src}" data-website-id="${UMAMI.id}" ` +
    `data-domains="sud-austral.github.io" data-performance="true"${extra}></script>`
  )
}

/** El <head> horneado de la portada, una etiqueta por línea. */
export function cabezaPortada({ canonical, descripcion, imagen, version }) {
  return [
    ...metasVistaPrevia({ canonical, titulo: TITULO, descripcion, imagen, version }),
    etiquetaUmami({ autoTrack: false }),
  ].filter(Boolean)
}
