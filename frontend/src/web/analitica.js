/**
 * Qué dirección se le cuenta a Umami por cada vista del visor (DECISIONES §M.11).
 *
 * El visor escribe el encuadre en la URL en cada paneo (`lat`, `lon`, `z`, con
 * replaceState). Con el rastreo automático de Umami, cada movimiento del mapa sería
 * una «página vista» distinta: el informe quedaría inservible y la base de la flota
 * se llenaría de filas. Por eso en la app el rastreo automático va APAGADO
 * (data-auto-track="false", cabeza.js) y la vista se registra a mano, con la
 * dirección NORMALIZADA: se queda lo que dice QUÉ se mira —el ámbito, los usos y
 * los filtros— y se quita DÓNDE está el mapa y con qué fondo.
 *
 * Sin imports: puro, con pruebas en Node.
 */

// Encuadre y fondo: cambian al mirar, no cambian lo que se mira.
const DE_ENCUADRE = ['lat', 'lon', 'z', 'base']

/**
 * Las etiquetas de campaña (`utm_*`) SÍ se mandan —con ellas se ve que alguien llegó
 * desde un asistente, `utm_source=chatgpt.com`—, pero no cuentan para decidir si la
 * vista es otra: la app las borra de la barra al escribir su estado, y sin esto la misma
 * visita se contaría dos veces, con y sin la etiqueta.
 */
export function claveDeVista(search) {
  const q = new URLSearchParams(urlParaAnalitica(search))
  for (const k of [...q.keys()]) if (k.startsWith('utm_')) q.delete(k)
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** La query normalizada, con los parámetros en orden estable, o '' si no queda nada. */
export function urlParaAnalitica(search) {
  const q = new URLSearchParams(search)
  for (const k of DE_ENCUADRE) q.delete(k)
  // El mismo ámbito y los mismos filtros en otro orden son la misma vista.
  const orden = [...q.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const s = new URLSearchParams(orden).toString()
  return s ? `?${s}` : ''
}
