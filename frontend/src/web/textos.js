/**
 * Las frases que un buscador o un asistente de IA van a citar SUELTAS.
 *
 * Un asistente no copia la página: copia una oración. Por eso cada frase lleva
 * dentro todo lo que necesita para no mentir fuera de contexto (guía §6.3):
 *   - el nombre explícito del territorio, nunca «esta comuna»;
 *   - quién lo dice (DECISIONES §M.3): el VISOR publicado por CONAF, calculado
 *     sobre los polígonos; no la cifra oficial, que es otra fuente;
 *   - de cuándo es: cada región se actualizó en un año distinto;
 *   - hectáreas ENTERAS, ya redondeadas;
 *   - la salvedad frente a las cifras oficiales.
 *
 * Importa sólo módulos sin imports (formato.js, hechos.js), con la extensión .js que
 * Node exige: lo usan el render en Node y las guardas.
 */
import { fmt, haEntera, pct } from '../formato.js'
import { rangoAniosTexto } from '../hechos.js'

export const QUIEN =
  'según el Visor del Catastro de Usos de la Tierra y Recursos Vegetacionales publicado por ' +
  'CONAF (Gerencia de Fiscalización Forestal y Evaluación Ambiental)'

export const SALVEDAD = 'Las cifras del visor pueden diferir levemente de las oficiales de CONAF.'

// Los subusos de Bosques por su CÓDIGO oficial, no por su etiqueta: el código es de
// la guía de CONAF y no cambia con una corrección de redacción.
const SUBUSOS_BOSQUE = [
  ['0402', 'bosque nativo'],
  ['0401', 'plantación forestal'],
  ['0403', 'bosque mixto'],
]
const USO_BOSQUES = '04'

const haDe = (lista, cod) => lista?.find((x) => x.cod === cod)?.ha ?? 0

/** «18.862.755 ha (24,9 %) son bosques: … de bosque nativo, … y … de bosque mixto» */
function tramoBosques(total, usos, subusos) {
  const bosques = haDe(usos, USO_BOSQUES)
  const partes = SUBUSOS_BOSQUE.map(([cod, nombre]) => `${haEntera(haDe(subusos, cod))} de ${nombre}`)
  const lista = `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`
  return `${haEntera(bosques)} (${pct(bosques, total)}) son bosques: ${lista}`
}

/** La frase citable de la portada: el país entero. */
export function fraseNacional(manifest) {
  const { filas, ha } = manifest.total
  const rango = rangoAniosTexto(manifest)
  return (
    `Chile: ${QUIEN}, calculado sobre los ${fmt.format(filas)} polígonos del Catastro —cada ` +
    `región actualizada en un año distinto, entre ${rango}—, el país tiene ${haEntera(ha)} ` +
    `catastradas; ${tramoBosques(ha, manifest.usos, manifest.subusos)}. ${SALVEDAD}`
  )
}

/**
 * La descripción de la portada (meta description y og:description, que son el
 * MISMO texto: dos redacciones divergen a la primera edición). Las cifras salen del
 * manifest al construir; escritas a mano se quedaban diciendo lo de antes (mejoras
 * M8). Corta a propósito: los buscadores muestran unos 155 caracteres.
 */
export function descripcionPortada(manifest) {
  return (
    'Visor del Catastro de Usos de la Tierra y Recursos Vegetacionales de CONAF: ' +
    `${fmt.format(manifest.total.filas)} polígonos con su uso de suelo, superficie y ubicación.`
  )
}
