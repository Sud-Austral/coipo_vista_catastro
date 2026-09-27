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
 * El trozo de URL de una región o comuna: «Los Ríos» → los-rios, «O'Higgins» →
 * ohiggins, «Ñuble» → nuble. Se calcula SÓLO aquí; Compartir lo lee de
 * web/indice.json y nunca lo recalcula.
 *
 * No es el `slug` de descargas.js (nombres de archivo): ése convierte O'Higgins en
 * o-higgins y corta a 40 caracteres. Seis comunas se llaman como su región
 * (Antofagasta, Coquimbo, Valparaíso, Maule, O'Higgins, Los Lagos), así que cada
 * nivel va bajo su propio prefijo: /region/…/ y /comuna/…/.
 */
export function slugDePagina(nombre) {
  return String(nombre)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// La unidad mínima cartografiable (UMC) deja fuera los rodales pequeños: que el
// Catastro no dibuje un bosque no prueba que no exista. Una frase suelta que dijera
// «X no tiene bosque» la citaría un asistente como un hecho (DECISIONES §M.9).
const SIN_PRUEBA = 'los rodales menores que la unidad mínima cartografiable no se dibujan, así que eso no prueba que no los haya'

const n = (x) => `${fmt.format(x)} ${x === 1 ? 'polígono' : 'polígonos'}`

/** El tramo de los bosques de una entidad, para las frases de región y comuna. */
function tramoBosquesEntidad(quien, resumen) {
  const total = resumen.ha
  const bosques = haDe(resumen.usos, USO_BOSQUES)
  if (!(bosques > 0)) {
    return `el Catastro no clasifica como bosque ningún polígono de ${quien} (${SIN_PRUEBA})`
  }
  const partes = SUBUSOS_BOSQUE
    .map(([cod, nombre]) => [haDe(resumen.subusos, cod), nombre])
    .filter(([ha]) => ha > 0)
    .map(([ha, nombre]) => `${haEntera(ha)} de ${nombre}`)
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}` : partes[0]
  let t = `${haEntera(bosques)} (${pct(bosques, total)}) son bosques: ${lista}`
  if (!(haDe(resumen.subusos, '0402') > 0)) {
    t += `; el Catastro no registra bosque nativo en ${quien} (${SIN_PRUEBA})`
  }
  return t
}

/**
 * La frase citable de una comuna. Empieza por «La comuna de X» SIEMPRE: seis comunas
 * se llaman como su región, y «Valparaíso (Región de Valparaíso) tiene 30.900 ha»
 * se leería como la cifra de la región (el mismo defecto de DECISIONES §G).
 */
export function fraseComuna(comuna, region, resumen) {
  const quien = `la comuna de ${comuna.etiqueta}`
  return (
    `La comuna de ${comuna.etiqueta} (${region.oficial}): ${QUIEN}, calculado sobre los ` +
    `polígonos de la actualización ${region.anio} del Catastro para la ${region.oficial.replace(/^Región/, 'región')}, ` +
    `tiene ${haEntera(resumen.ha)} catastradas en ${n(resumen.n)}; ${tramoBosquesEntidad(quien, resumen)}. ${SALVEDAD}`
  )
}

/**
 * La frase citable de una región. Con la cifra oficial de su planilla y EL AÑO de esa
 * planilla: en tres regiones no coincide con el de las capas (oficiales.anio_discrepante),
 * y sin el año la frase pondría lado a lado dos cifras de años distintos.
 */
export function fraseRegion(region, resumen, oficial) {
  const quien = `la ${region.oficial.replace(/^Región/, 'región')}`
  let f =
    `${region.oficial}: ${QUIEN}, calculado sobre los polígonos de su actualización ` +
    `${region.anio} del Catastro, tiene ${haEntera(resumen.ha)} catastradas en ${n(resumen.n)}; ` +
    `${tramoBosquesEntidad(quien, resumen)}.`
  const total = oficial?.valores?.total
  if (total != null) {
    f += ` La cifra oficial publicada por CONAF para la región, en su planilla de la actualización ` +
      `${oficial.anio_actualizacion}, es de ${haEntera(total)}.`
  }
  return `${f} ${SALVEDAD}`
}

/** <title> y og:title. Cortos a propósito: los buscadores cortan hacia los 60 caracteres. */
export const tituloComuna = (comuna, region) =>
  `Comuna de ${comuna.etiqueta} (${region.nombre}): uso de la tierra y bosques — Catastro CONAF`
export const tituloRegion = (region) =>
  `${region.oficial}: uso de la tierra y bosques — Catastro CONAF`
export const TITULO_INDICE = 'Cifras por región y comuna — Catastro de Usos de la Tierra, CONAF'

/** Descripción corta (meta description = og:description) de una región o comuna. */
export function descripcionEntidad(nombre, anio, resumen) {
  const bosques = haDe(resumen.usos, USO_BOSQUES)
  const nativo = haDe(resumen.subusos, '0402')
  return (
    `${nombre}: ${haEntera(resumen.ha)} catastradas, ${haEntera(bosques)} de bosques y ` +
    `${haEntera(nativo)} de bosque nativo, según el Visor del Catastro de CONAF (actualización ${anio}).`
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
