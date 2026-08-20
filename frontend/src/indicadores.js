/**
 * Agregados del panel de indicadores.
 *
 * SIN React y sin JSX a propósito: esto es la aritmética, y separarla permite
 * contrastarla con `node` sin montar nada.
 *
 * UNIVERSO: el Catastro de Bosque Nativo de CONAF. Cada región se levantó en un
 * año distinto entre 2014 y 2024, así que estas cifras son una foto por región,
 * no una serie. Cualquier rótulo que salga de aquí lleva su año.
 *
 * DOS FUENTES, UNA SOLA FORMA. `resumenNacional` sale del manifest y
 * `resumenFiltrado` de una pasada sobre el .bin; las dos devuelven exactamente
 * la misma estructura, con un campo `fuente` como discriminante. Así los
 * componentes tienen UN camino de render y no dos, y una sección nunca se
 * desmonta por haber filtrado.
 *
 * EL DENOMINADOR ENTRA COMO PARÁMETRO. Escribir «denominador: 15.536.329 ha»
 * como constante funciona hasta que alguien filtra por región, y a partir de ahí
 * miente en cada porcentaje.
 */

/** Suma por índice en UNA pasada. `mascara` null = todo el país. */
function acumular(codigos, ha, k, centinela, mascara) {
  const n = codigos.length
  const cuenta = new Int32Array(k + 1) // la última casilla es el centinela
  const suma = new Float64Array(k + 1)
  for (let i = 0; i < n; i++) {
    if (mascara && !mascara[i]) continue
    const c = codigos[i]
    const j = c === centinela ? k : c
    cuenta[j] += 1
    suma[j] += ha[i]
  }
  return { cuenta, suma }
}

function listar(dominio, cuenta, suma, total) {
  return dominio
    .map((d, i) => ({
      ...d,
      n: cuenta[i],
      ha: suma[i],
      pct: total > 0 ? (100 * suma[i]) / total : null,
    }))
    .filter((d) => d.n > 0)
    .sort((a, b) => b.ha - a.ha)
}

/**
 * Resumen NACIONAL, directo del manifest. No acepta filtro: el manifest trae
 * los marginales del país y nada más. Si alguien pide un ámbito, se usa
 * `resumenFiltrado`; declarar «Ámbito: Aysén» sobre la cifra del país sería
 * publicar una contradicción.
 */
export function resumenNacional(manifest) {
  if (!manifest) return null
  const total = manifest.total.ha
  const conPct = (filas) =>
    filas
      .filter((d) => d.n > 0)
      .map((d) => ({ ...d, pct: total > 0 ? (100 * d.ha) / total : null }))
      .sort((a, b) => b.ha - a.ha)
  return {
    fuente: 'manifest',
    n: manifest.total.filas,
    ha: total,
    usos: conPct(manifest.usos),
    subusos: conPct(manifest.subusos),
    estructuras: conPct(manifest.estructuras),
    tiposForestales: conPct(manifest.tipos_forestales),
    snaspe: conPct(manifest.snaspe),
    comunas: conPct(manifest.comunas),
    regiones: manifest.regiones.filter((r) => r.n > 0),
  }
}

/**
 * Resumen del ámbito filtrado: una sola pasada por cada dimensión sobre las
 * filas que pasan la máscara.
 *
 * Medido en el spike: una pasada completa sobre 1.827.933 filas tarda 8-14 ms.
 * Con seis dimensiones sigue por debajo del presupuesto de 120 ms, y sólo corre
 * cuando cambia el filtro.
 */
export function resumenFiltrado(datos, mascara) {
  if (!datos) return null
  const m = datos.manifest
  const dim = (codigos, dominio, centinela) => {
    const { cuenta, suma } = acumular(codigos, datos.ha, dominio.length, centinela, mascara)
    return { cuenta, suma }
  }

  let n = 0
  let total = 0
  for (let i = 0; i < datos.n; i++) {
    if (mascara && !mascara[i]) continue
    n += 1
    total += datos.ha[i]
  }

  const u = dim(datos.uso, m.usos, 255)
  const s = dim(datos.subuso, m.subusos, 255)
  const e = dim(datos.estruc, m.estructuras, 255)
  const t = dim(datos.tifo, m.tipos_forestales, 255)
  const p = dim(datos.snaspe, m.snaspe, 255)
  const c = dim(datos.comuna, m.comunas, 65535)

  // Las regiones se agregan desde las comunas: el .bin no lleva columna de
  // región, y añadirla sería un byte por punto para un dato que ya se deduce.
  const porRegion = new Map()
  m.comunas.forEach((com, i) => {
    if (!c.cuenta[i]) return
    const r = porRegion.get(com.region) ?? { n: 0, ha: 0 }
    r.n += c.cuenta[i]
    r.ha += c.suma[i]
    porRegion.set(com.region, r)
  })

  return {
    fuente: 'filtrado',
    n,
    ha: total,
    usos: listar(m.usos, u.cuenta, u.suma, total),
    subusos: listar(m.subusos, s.cuenta, s.suma, total),
    estructuras: listar(m.estructuras, e.cuenta, e.suma, total),
    tiposForestales: listar(m.tipos_forestales, t.cuenta, t.suma, total),
    snaspe: listar(m.snaspe, p.cuenta, p.suma, total),
    comunas: listar(m.comunas, c.cuenta, c.suma, total),
    regiones: m.regiones
      .map((r) => ({ ...r, ...(porRegion.get(r.cod) ?? { n: 0, ha: 0 }) }))
      .filter((r) => r.n > 0),
    // Las filas que no se pudieron clasificar en cada dimensión. Se publican:
    // «sin dato» y «con un valor que la guía no nombra» no son cero.
    sinDato: {
      subuso: s.cuenta[m.subusos.length],
      estructura: e.cuenta[m.estructuras.length],
      tipoForestal: t.cuenta[m.tipos_forestales.length],
      comuna: c.cuenta[m.comunas.length],
    },
  }
}

/** Los tres subusos de Bosques, con su denominador propio. */
export function composicionBosque(resumen) {
  if (!resumen) return null
  const bosques = resumen.usos.find((u) => u.cod === '04')
  if (!bosques) return null
  const de = (cod) => resumen.subusos.find((s) => s.cod === cod) ?? { n: 0, ha: 0 }
  const nativo = de('0402')
  const plantacion = de('0401')
  const mixto = de('0403')
  return {
    bosques,
    nativo,
    plantacion,
    mixto,
    // El denominador de «cuánto del bosque es nativo» son los bosques, no el
    // país. Son dos porcentajes distintos y los dos hacen falta.
    pctPais: resumen.ha > 0 ? (100 * bosques.ha) / resumen.ha : null,
    pctNativoDelBosque: bosques.ha > 0 ? (100 * nativo.ha) / bosques.ha : null,
  }
}

/** Las estructuras del bosque nativo, con el bosque nativo por denominador. */
export function estructurasBosqueNativo(resumen) {
  if (!resumen) return null
  const bn = resumen.subusos.find((s) => s.cod === '0402')
  if (!bn || !bn.ha) return null
  return {
    total: bn,
    filas: resumen.estructuras
      .filter((e) => e.subuso === '0402')
      .map((e) => ({ ...e, pct: (100 * e.ha) / bn.ha })),
  }
}

/** El SNASPE agregado por categoría, más las unidades mayores. */
export function resumenSnaspe(resumen, tope = 10) {
  if (!resumen) return null
  const porCat = new Map()
  for (const u of resumen.snaspe) {
    const c = porCat.get(u.categoria) ?? { categoria: u.categoria, n: 0, ha: 0, unidades: 0 }
    c.n += u.n
    c.ha += u.ha
    c.unidades += 1
    porCat.set(u.categoria, c)
  }
  const total = resumen.snaspe.reduce((a, u) => a + u.ha, 0)
  return {
    total,
    unidades: resumen.snaspe.length,
    // El porcentaje del ámbito que está protegido: es la cifra que se pregunta.
    pctDelAmbito: resumen.ha > 0 ? (100 * total) / resumen.ha : null,
    categorias: [...porCat.values()].sort((a, b) => b.ha - a.ha),
    mayores: resumen.snaspe.slice(0, tope),
  }
}

/**
 * Rótulo explícito del ámbito. Sustituye a la reactividad al encuadre: una
 * cifra leída sobre un rectángulo arbitrario invita a citarla como nacional.
 */
export function ambitoTexto(ambito, manifest) {
  if (!ambito?.region) return 'todo Chile'
  const reg = manifest.regiones.find((r) => r.cod === ambito.region)
  const partes = [reg?.nombre ?? ambito.region]
  if (ambito.provincia) partes.push(ambito.provincia)
  if (ambito.comuna) {
    const com = manifest.comunas.find((c) => c.cod === ambito.comuna)
    partes.push(com?.etiqueta ?? ambito.comuna)
  }
  return partes.join(' › ')
}

/** El año del catastro del ámbito, o null si el ámbito abarca varios. */
export function anioDelAmbito(ambito, manifest) {
  if (!ambito?.region) return null
  return manifest.regiones.find((r) => r.cod === ambito.region)?.anio ?? null
}
