/**
 * Dónde vive el sitio y cómo se llama. ÚNICA fuente de los literales que el HTML
 * horneado, las páginas por región y comuna, el sitemap y el humo tienen que
 * repetir igual.
 *
 * SIN IMPORTS: lo cargan el navegador, el render en Node y las guardas.
 *
 * ACOPLADOS que no pueden leer este módulo y se cambian a mano con él (una prueba
 * compara los dos primeros): el `base` de frontend/vite.config.js y el `--base` del
 * trabajo de humo en .github/workflows/deploy.yml. Un `base` mal resuelto funciona
 * en la raíz y rompe publicado, con código de salida 0 (CLAUDE.md §8).
 */

export const ORIGEN = 'https://sud-austral.github.io'
export const BASE = '/coipo_vista_catastro/'
export const URL_PUBLICA = ORIGEN + BASE

/** Esquema de web/indice.json: lo escribe el generador y lo lee Compartir. */
export const ESQUEMA_INDICE = 1

export const TITULO = 'Catastro de Usos de la Tierra y Recursos Vegetacionales — CONAF'
export const NOMBRE_SITIO = 'CONAF · Gerencia de Fiscalización Forestal y Evaluación Ambiental'
export const PUBLICA = 'CONAF · Gerencia de Fiscalización Forestal y Evaluación Ambiental'
export const DESARROLLA = 'Unidad de Información y Análisis'

/**
 * Umami de la flota (DECISIONES §M.5). Sin `id` no se escribe ninguna etiqueta: el
 * identificador del sitio lo crea un admin de Umami y todavía no existe.
 */
export const UMAMI = { src: 'https://prueba5.conaf.cl/conaf.js', id: '' }
