/**
 * Las rutas de lo publicado, relativas al host y con el `base`. Una sola regla:
 * la usan la portada, las páginas, el sitemap y Compartir.
 *
 * SIN IMPORTS salvo módulos puros: lo carga Node al generar las páginas.
 */
import { BASE } from './sitio.js'
import { slugDePagina } from './textos.js'

export const urlRegion = (r) => `${BASE}region/${slugDePagina(r.nombre)}/`
export const urlComuna = (c) => `${BASE}comuna/${slugDePagina(c.etiqueta)}/`
export const URL_INDICE = `${BASE}regiones/`
/** El visor con el ámbito puesto. */
export const urlVisor = (r, c) => `${BASE}?reg=${r.cod}${c ? `&com=${c.cod}` : ''}`
