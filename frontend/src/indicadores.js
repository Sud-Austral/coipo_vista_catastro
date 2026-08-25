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
    coberturas: conPct(manifest.coberturas),
    alturas: conPct(manifest.alturas),
    subtiposForestales: conPct(manifest.subtipos_forestales),
    especies: conPct(manifest.especies),
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
 * Las diez dimensiones se acumulan DENTRO de esa única pasada, así que el coste
 * no se multiplica por diez, y sólo corre cuando cambia el filtro.
 */
export function resumenFiltrado(datos, mascara) {
  if (!datos) return null
  const m = datos.manifest
  // UNA sola pasada para las diez dimensiones, no diez pasadas de una.
  //
  // Con seis dimensiones el patron de "una pasada por dimension" costaba 8-14 ms
  // cada una y cabia de sobra en el presupuesto. Con diez ya no: son diez
  // recorridos de 1,8 M de filas, y lo unico que cambia entre ellos es que
  // columna se lee. Leyendo las diez dentro del mismo bucle, la fila se toca una
  // vez y su superficie se lee una vez.
  const espec = [
    [datos.uso, m.usos, 255],
    [datos.subuso, m.subusos, 255],
    [datos.estruc, m.estructuras, 255],
    [datos.tifo, m.tipos_forestales, 255],
    [datos.snaspe, m.snaspe, 255],
    [datos.comuna, m.comunas, 65535],
    [datos.cober, m.coberturas, 255],
    [datos.altura, m.alturas, 255],
    [datos.stifo, m.subtipos_forestales, 255],
    [datos.especie, m.especies, 65535],
  ]
  // La ultima casilla de cada acumulador es la del centinela: las filas sin dato
  // se CUENTAN aparte en vez de caer en el indice 0, que seria absorberlas en
  // silencio dentro de la primera categoria.
  const acc = espec.map(([col, dom, cent]) => ({
    col,
    cent,
    k: dom.length,
    cuenta: new Int32Array(dom.length + 1),
    suma: new Float64Array(dom.length + 1),
  }))

  const ha = datos.ha
  let n = 0
  let total = 0
  for (let i = 0; i < datos.n; i++) {
    if (mascara && !mascara[i]) continue
    const h = ha[i]
    n += 1
    total += h
    for (let d = 0; d < acc.length; d++) {
      const a = acc[d]
      const v = a.col[i]
      const j = v === a.cent ? a.k : v
      a.cuenta[j] += 1
      a.suma[j] += h
    }
  }
  const [u, s, e, t, p, c, cb, al, sf, ep] = acc

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
    coberturas: listar(m.coberturas, cb.cuenta, cb.suma, total),
    alturas: listar(m.alturas, al.cuenta, al.suma, total),
    subtiposForestales: listar(m.subtipos_forestales, sf.cuenta, sf.suma, total),
    especies: listar(m.especies, ep.cuenta, ep.suma, total),
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
      cobertura: cb.cuenta[m.coberturas.length],
      altura: al.cuenta[m.alturas.length],
      subtipoForestal: sf.cuenta[m.subtipos_forestales.length],
      especie: ep.cuenta[m.especies.length],
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
