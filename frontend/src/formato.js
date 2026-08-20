/**
 * Formato de cifras. Una sola regla, y vive aquí para que no se desincronice.
 *
 * PANEL:  «15,5 M ha», porcentajes con un decimal.
 * TÍTULO del elemento, tabla gemela, CSV y PDF:  «15.536.329,01 ha», completo.
 * PORTADA, una sola vez: la cifra nacional completa.
 *
 * Por qué no dos decimales en el panel, que era lo que pedía el rigor:
 *  - «15.536.329,01» son 13 caracteres ≈ 94 px de los 288 del lienzo. El 33 %
 *    del ancho para un número, y con todas las cifras midiendo lo mismo la
 *    columna deja de ser escaneable.
 *  - Y a dos decimales, en una columna de nueve filas, alguien va a sumar. Ahí
 *    nace justo el flanco que la precisión pretendía cerrar: los redondeos no
 *    cuadran, y el lector concluye que el dato está mal.
 * No se pierde nada: la auditoría está a un `title` y a un CSV de distancia.
 */

const es = (opts) => new Intl.NumberFormat('es-CL', opts)

export const fmt = es()
export const fmt1 = es({ maximumFractionDigits: 1 })
export const fmt2 = es({ minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Superficie para el PANEL: abreviada por encima del millón. */
export function ha(v) {
  if (v == null) return '—'
  if (v >= 1e6) return `${fmt1.format(v / 1e6)} M ha`
  return `${fmt.format(Math.round(v))} ha`
}

/** Superficie COMPLETA, para el title, la tabla gemela, el CSV y el PDF. */
export function haExacta(v) {
  return v == null ? '—' : `${fmt2.format(v)} ha`
}

/** Porcentaje con un decimal. Nunca se fuerza a que sumen 100. */
export function pct(parte, total) {
  if (!total) return '—'
  return `${fmt1.format((100 * parte) / total)} %`
}

export const numero = (v) => (v == null ? '—' : fmt.format(v))

/**
 * Título en español para nombres que vienen en minúsculas del Catastro
 * («lenga», «coihue de magallanes»).
 *
 * Se capitaliza SOLO la primera letra, no cada palabra: en español «Coihue De
 * Magallanes» está mal escrito. Y los topónimos que ya vienen bien no se tocan.
 */
export function titular(s) {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}
