/**
 * Las cifras que la PROSA del visor cita, calculadas de los datos publicados.
 *
 * Por qué existe. La prosa —Metodología, advertencias del panel, cabeceras de las
 * descargas— llevaba cifras de los datos escritas a mano: «entre 2014 y 2024» en
 * cinco sitios, «976 de 989» en tres, la cifra oficial del país como literal. Una
 * cifra a mano no avisa cuando el ETL cambia el dato; se queda diciendo lo de antes.
 * Y desde que esa prosa se hornea en HTML para buscadores y asistentes, una cifra
 * vieja ya no la lee sólo quien abre el visor: la cita un asistente, suelta.
 *
 * SIN IMPORTS, igual que indicadores.js: lo usan el navegador y Node (el generador
 * de páginas y las pruebas), y en Node no existe import.meta.env. Devuelve NÚMEROS;
 * el formato lo pone quien los muestra, con formato.js.
 */

/**
 * Años del Catastro según manifest.regiones[].anio. Un periodo «2018-2019» aporta
 * sus dos extremos: el rango tiene que cubrir lo que el Catastro dice, no inventar
 * un año que no da.
 */
export function rangoAnios(manifest) {
  const nums = (manifest?.regiones ?? [])
    .flatMap((r) => String(r.anio ?? '').split('-'))
    .map((t) => parseInt(t, 10))
    .filter((n) => Number.isFinite(n))
  if (nums.length === 0) return null
  return { desde: Math.min(...nums), hasta: Math.max(...nums) }
}

/** «2014 y 2024», para escribir «entre 2014 y 2024»; o un solo año si coinciden. */
export function rangoAniosTexto(manifest) {
  const r = rangoAnios(manifest)
  if (!r) return null
  return r.desde === r.hasta ? String(r.desde) : `${r.desde} y ${r.hasta}`
}

/**
 * Cuántas especies tienen categoría de conservación y cuántas no se han verificado.
 * La categoría viene de una tabla auxiliar sin validar contra el RCE; «Sin dato» es
 * «no se ha comprobado», no «fuera de peligro».
 */
export function especiesConservacion(manifest) {
  const esp = manifest?.especies ?? []
  const sinVerificar = esp.filter((e) => String(e.conservacion ?? '').startsWith('Sin dato')).length
  return { total: esp.length, sinVerificar, conCategoria: esp.length - sinVerificar }
}

/** Porcentaje entero de discos recortados para no invadir a su vecino (DECISIONES §I). */
export function pctRecortados(manifest) {
  const cap = manifest?.capas?.cbn_puntos
  if (!cap?.radio?.recortados || !cap.filas) return null
  return Math.round((100 * cap.radio.recortados) / cap.filas)
}

/** Total del país según la planilla oficial de CONAF. */
export function totalOficial(oficiales) {
  return oficiales?.total_pais?.total ?? null
}

/** El mayor residuo, en hectáreas, entre el visor y la planilla oficial por clase de uso. */
export function mayorResiduoUso(manifest, oficiales) {
  const tp = oficiales?.total_pais
  if (!tp || !manifest?.usos) return null
  let mayor = null
  for (const u of manifest.usos) {
    const of = tp[`uso:${u.cod}`]
    if (of == null) continue
    const d = Math.abs(u.ha - of)
    if (mayor == null || d > mayor) mayor = d
  }
  return mayor
}

/** Superficie de una unidad del SNASPE por su nombre exacto en el manifest. */
export function haSnaspe(manifest, nombre) {
  return manifest?.snaspe?.find((s) => s.etiqueta === nombre)?.ha ?? null
}

// El nombre de región se compara sin mayúsculas ni tildes, como `canon` en
// ETL/cifras_oficiales.py:57, que es quien cruzó las dos fuentes primero.
const canon = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * La fila de la planilla oficial de cada región, por código de región.
 *
 * La planilla nombra las regiones a su manera; 15 de 16 casan por nombre y
 * Magallanes no: allí se llama «Magallanes y de La Antártica». La regla es la misma
 * de ETL/cifras_oficiales.py:192, explícita. LANZA si alguna región queda sin fila
 * o si una fila casa con dos: una cifra oficial atribuida a la región equivocada
 * es peor que ninguna.
 */
export function oficialesPorRegion(manifest, oficiales) {
  if (oficiales?.esquema !== 1) {
    throw new Error(`oficiales.json con esquema ${oficiales?.esquema}; este código lee el 1`)
  }
  const porCanon = new Map()
  for (const fila of oficiales.regiones ?? []) {
    const k = canon(fila.region).replace('magallanes y de la antartica', 'magallanes')
    if (porCanon.has(k)) throw new Error(`dos filas oficiales para «${k}»`)
    porCanon.set(k, fila)
  }
  const salida = new Map()
  const usadas = new Set()
  for (const r of manifest?.regiones ?? []) {
    const fila = porCanon.get(canon(r.nombre))
    if (!fila) throw new Error(`la región ${r.cod} «${r.nombre}» no tiene fila en oficiales.json`)
    if (usadas.has(fila)) throw new Error(`la fila oficial «${fila.region}» casa con dos regiones`)
    usadas.add(fila)
    salida.set(r.cod, fila)
  }
  return salida
}

/**
 * Hectáreas de plantación de una especie, sumando la superficie ENTERA de cada
 * polígono cuya especie PRINCIPAL es ésa: la convención de la planilla oficial de
 * plantaciones por especie.
 *
 * El código DISTINGUE MAYÚSCULAS (CLAUDE.md §5): `PR` es Pinus radiata y `pr` es
 * Poa pratensis. Necesita el .bin cargado; sin él devuelve null.
 */
export function haPlantacionEspecie(datos, manifest, codEspecie, codSubuso = '0401') {
  if (!datos?.especie || !datos?.subuso || !datos?.ha || !manifest) return null
  const e = manifest.especies.findIndex((x) => x.cod === codEspecie)
  const s = manifest.subusos.findIndex((x) => x.cod === codSubuso)
  if (e < 0 || s < 0) return null
  let suma = 0
  for (let i = 0; i < datos.n; i++) {
    if (datos.especie[i] === e && datos.subuso[i] === s) suma += datos.ha[i]
  }
  return suma
}

/** El polígono más grande, en hectáreas. Necesita el .bin cargado. */
export function mayorPoligono(datos) {
  if (!datos?.ha) return null
  let m = 0
  for (let i = 0; i < datos.n; i++) if (datos.ha[i] > m) m = datos.ha[i]
  return m
}
