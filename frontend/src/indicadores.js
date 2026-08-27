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

/**
 * Las diez dimensiones filtrables, con sus tres nombres.
 *
 * Cada una se llama de tres formas distintas y hay que seguirlas las tres:
 * `col` en el .bin y en la URL, `dominio` en el manifest, `resumen` dentro del
 * objeto de resumen. Tenerlas juntas es lo que permite que añadir una dimensión
 * sea añadir una línea y no tocar ningún bucle.
 *
 * `centinela` es el valor que significa «sin dato» en esa columna. Va aquí
 * porque el acumulador le reserva una casilla propia: las filas sin dato se
 * cuentan aparte en vez de caer en el índice 0, que sería absorberlas en
 * silencio dentro de la primera categoría.
 */
export const DIMENSIONES = [
  { col: 'uso', dominio: 'usos', resumen: 'usos', centinela: 255 },
  { col: 'subuso', dominio: 'subusos', resumen: 'subusos', centinela: 255 },
  { col: 'estruc', dominio: 'estructuras', resumen: 'estructuras', centinela: 255 },
  { col: 'tifo', dominio: 'tipos_forestales', resumen: 'tiposForestales', centinela: 255 },
  { col: 'stifo', dominio: 'subtipos_forestales', resumen: 'subtiposForestales', centinela: 255 },
  { col: 'cober', dominio: 'coberturas', resumen: 'coberturas', centinela: 255 },
  { col: 'altura', dominio: 'alturas', resumen: 'alturas', centinela: 255 },
  { col: 'especie', dominio: 'especies', resumen: 'especies', centinela: 65535 },
  { col: 'snaspe', dominio: 'snaspe', resumen: 'snaspe', centinela: 255 },
  { col: 'comuna', dominio: 'comunas', resumen: 'comunas', centinela: 65535 },
]

/**
 * Tabla de pertenencia de un Set de índices, para consultarla dentro del bucle.
 *
 * Con diez dimensiones activas, `Set.has()` dentro del bucle son 18 millones de
 * llamadas por cambio de filtro; indexar un Uint8Array es una lectura de
 * memoria. La tabla mide 256 o 65.536 bytes según el ancho de la columna —el
 * rango completo del tipo, así que el centinela también cabe y queda en 0 sin
 * ningún caso especial—, o sea nada al lado de las 1,8 M de filas que recorre.
 */
function tablaPertenencia(columna, sel) {
  const t = new Uint8Array(columna.BYTES_PER_ELEMENT === 1 ? 256 : 65536)
  for (const v of sel) t[v] = 1
  return t
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
    coberturas: conPct(manifest.coberturas),
    alturas: conPct(manifest.alturas),
    subtiposForestales: conPct(manifest.subtipos_forestales),
    especies: conPct(manifest.especies),
    estructuras: conPct(manifest.estructuras),
    tiposForestales: conPct(manifest.tipos_forestales),
    snaspe: conPct(manifest.snaspe),
    comunas: conPct(manifest.comunas),
    regiones: manifest.regiones.filter((r) => r.n > 0),
    // El manifest YA trae las filas sin dato por dimensión y aquí no se leían,
    // así que sin ningún filtro activo el panel decía que no había ninguna. Son
    // 1.114.688 polígonos sin tipo forestal y 1.431.130 fuera del SNASPE: justo
    // el aviso sin el cual los porcentajes de la dimensión parecen cubrir todo
    // el territorio.
    sinDato: sinDatoDelManifest(manifest),
  }
}

/**
 * Cómo se llama cada dimensión dentro de `sinDato`. Son nombres distintos de
 * los de la columna del .bin porque el panel de indicadores los fijó primero.
 * SNASPE no está, y su ausencia es deliberada: su centinela no significa «no
 * sabemos», significa «fuera del SNASPE». Publicarlo como «1.431.130 polígonos
 * sin este dato» convertiría el 78 % del país en un agujero de información
 * cuando es una respuesta.
 */
const SIN_DATO_POR_COL = {
  subuso: 'subuso',
  estruc: 'estructura',
  tifo: 'tipoForestal',
  comuna: 'comuna',
  cober: 'cobertura',
  altura: 'altura',
  stifo: 'subtipoForestal',
  especie: 'especie',
}

/**
 * Las filas sin dato por dimensión, con los nombres que espera el panel.
 *
 * `cuenta` elige de qué acumulador se lee: el global para el resumen y el
 * marginal para las listas de filtro, que cuentan sobre conjuntos distintos.
 */
function sinDatoDe(por, cuenta) {
  const out = {}
  for (const [col, nombre] of Object.entries(SIN_DATO_POR_COL)) {
    out[nombre] = cuenta(por[col])[por[col].k]
  }
  return out
}

/** Lo mismo, del manifest: ahí `sin_dato` va con los nombres de la columna. */
function sinDatoDelManifest(manifest) {
  const s = manifest.capas?.cbn_puntos?.sin_dato ?? {}
  const out = {}
  for (const [col, nombre] of Object.entries(SIN_DATO_POR_COL)) {
    out[nombre] = s[col] ?? 0
  }
  return out
}

/**
 * El cruce entero en UNA pasada: la máscara del mapa, el resumen del recorte y
 * los MARGINALES que alimentan la cascada de los filtros.
 *
 * ── Por qué hace falta el marginal ───────────────────────────────────────────
 * La lista de clases de la dimensión D no se puede contar sobre el recorte
 * completo, porque ese recorte YA aplica el filtro de D. Al marcar «Denso» en
 * Cobertura, las otras cinco coberturas caían a cero — no porque su
 * intersección con el resto fuera vacía, sino porque estaban compitiendo
 * consigo mismas. Con eso, marcar una segunda clase de la misma dimensión era
 * imposible: la lista se había quedado con una fila.
 *
 * Lo que necesita cada lista es el marginal LEAVE-ONE-OUT: contar sobre las
 * filas que pasan todas las dimensiones MENOS la suya.
 *
 * ── Cómo se calcula sin diez pasadas ────────────────────────────────────────
 * Diez marginales parecen diez recorridos. No lo son, si en vez de preguntar
 * «¿pasa?» se cuenta CUÁNTAS dimensiones falla cada fila:
 *
 *   0 fallos  la fila pasa todo. Pasa también «todo menos D» para CUALQUIER D,
 *             así que entra en la máscara, en el total y en las diez.
 *   1 fallo   la fila pasa «todo menos D» sólo para la D que falla. Entra sólo
 *             ahí, y no en el mapa ni en el total.
 *   2 o más   no entra en ninguna parte, y se corta el bucle interno.
 *
 * Y como «pasa todo menos D» = «pasa todo» ∪ «falla exactamente D», y los dos
 * conjuntos son disjuntos, basta con acumular los del segundo grupo APARTE y
 * sumarlos al final sobre las pocas casillas de cada dominio. El camino
 * caliente sigue costando lo mismo que antes.
 *
 * ── Lo que cuesta, medido, no supuesto ─────────────────────────────────────
 * Esto SUSTITUYE a `canalFiltro` + `resumenFiltrado`, que eran dos recorridos
 * completos por clic de casilla. Juntarlos en uno NO lo hace más barato: sale
 * ENTRE UN 8 Y UN 43 % MÁS CARO, porque calcula diez marginales que antes no
 * existían. Medido sobre las 1.827.933 filas reales, alternando las dos
 * implementaciones, mediana de 15:
 *
 *      caso                        antes    ahora
 *      1 dim · uso Bosques          66 ms    71 ms
 *      1 dim · cobertura Denso      33 ms    33 ms
 *      2 dims · uso + cobertura     32 ms    39 ms
 *      ámbito · una región          29 ms    32 ms
 *      ámbito + 3 temáticos         16 ms    24 ms
 *
 * El peor caso queda en 78 ms contra el techo de 120 ms que fijó el spike. Se
 * paga por tener listas que no mienten; si algún día no cupiera, lo que sobra
 * es el marginal, no la máscara.
 *
 * Sólo se llama cuando hay algún filtro. Sin filtros el resumen sale del
 * manifest y no se recorre nada.
 */
export function resumenYMarginales(datos, filtros = {}) {
  if (!datos) return null
  const m = datos.manifest
  const n = datos.n

  const dims = DIMENSIONES.map((d) => {
    const dom = m[d.dominio] ?? []
    return {
      col: d.col,
      resumen: d.resumen,
      dom,
      columna: datos[d.col],
      cent: d.centinela,
      k: dom.length,
      // La última casilla es la del centinela: las filas sin dato se cuentan
      // aparte en vez de caer en el índice 0, que sería absorberlas en silencio
      // dentro de la primera categoría.
      cuenta: new Int32Array(dom.length + 1),
      suma: new Float64Array(dom.length + 1),
      // Lo que le falta a esta dimensión para su marginal: las filas que fallan
      // ELLA y sólo ella.
      xCuenta: new Int32Array(dom.length + 1),
      xSuma: new Float64Array(dom.length + 1),
      xN: 0,
      xHa: 0,
      tabla: null,
    }
  })

  const activos = []
  for (const d of dims) {
    const sel = filtros[d.col]
    // Un Set vacío o ausente significa «todas», no «ninguna»: la diferencia
    // entre no haber filtrado y haber filtrado a cero.
    if (!d.columna || !sel || sel.size === 0) continue
    d.tabla = tablaPertenencia(d.columna, sel)
    activos.push(d)
  }

  const ha = datos.ha
  const mascara = new Uint8Array(n)
  const na = activos.length
  const nd = dims.length
  let nTotal = 0
  let haTotal = 0

  // La CAJA de lo que pasa el filtro, para que el mapa pueda encuadrarlo. Sale
  // de este bucle y no de una pasada aparte: medido sobre el .bin real, anadir
  // el min/max aqui cuesta 5,4 ms con Bosques (943 k filas) y 8,7 ms con todo el
  // pais, mientras que recorrer despues la mascara ya calculada cuesta 7,8 y 9,4
  // -- porque esa segunda pasada paga su propio recorrido entero de 1,83 M de
  // posiciones, y aqui la fila ya esta en la mano.
  //
  // El bbox del RECORTE no lo puede precalcular el ETL: son todas las
  // combinaciones de diez dimensiones. El del AMBITO si, y sigue viniendo del
  // manifest (ver cajaDelAmbito en App.jsx).
  const lonc = datos.lon
  const latc = datos.lat
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity

  // CON UNA SOLA DIMENSIÓN ACTIVA no hay nada que acumular aparte: su marginal
  // —«todo menos ella»— es el país entero, y eso ya está contado en el manifest.
  // Sin el atajo hay que acumular también las 1,15 M de filas que fallan el
  // filtro. Medido con el MISMO conjunto de filas, forzando dos dimensiones
  // activas de las que una no descarta nada: 71 ms con atajo, 78 ms sin él.
  const soloUna = na === 1

  for (let i = 0; i < n; i++) {
    let fallos = 0
    let cual = -1
    for (let d = 0; d < na; d++) {
      const a = activos[d]
      if (!a.tabla[a.columna[i]]) {
        fallos += 1
        if (fallos > 1) break
        cual = d
      }
    }
    if (fallos > 1) continue
    const h = ha[i]
    if (fallos === 0) {
      mascara[i] = 1
      nTotal += 1
      haTotal += h
      const x = lonc[i]
      const y = latc[i]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let d = 0; d < nd; d++) {
        const a = dims[d]
        const v = a.columna[i]
        const j = v === a.cent ? a.k : v
        a.cuenta[j] += 1
        a.suma[j] += h
      }
    } else if (!soloUna) {
      const a = activos[cual]
      const v = a.columna[i]
      const j = v === a.cent ? a.k : v
      a.xCuenta[j] += 1
      a.xSuma[j] += h
      a.xN += 1
      a.xHa += h
    }
  }

  const por = Object.fromEntries(dims.map((d) => [d.col, d]))
  const c = por.comuna

  // Las regiones se agregan desde las comunas: el .bin no lleva columna de
  // región, y añadirla sería un byte por punto para un dato que ya se deduce.
  const regionesDe = (cuenta, suma) => {
    const acc = new Map()
    m.comunas.forEach((com, i) => {
      if (!cuenta[i]) return
      const r = acc.get(com.region) ?? { n: 0, ha: 0 }
      r.n += cuenta[i]
      r.ha += suma[i]
      acc.set(com.region, r)
    })
    return m.regiones
      .map((r) => ({ ...r, ...(acc.get(r.cod) ?? { n: 0, ha: 0 }) }))
      .filter((r) => r.n > 0)
  }

  const resumen = {
    fuente: 'filtrado',
    n: nTotal,
    ha: haTotal,
    regiones: regionesDe(c.cuenta, c.suma),
    // Las filas que no se pudieron clasificar en cada dimensión. Se publican:
    // «sin dato» y «con un valor que la guía no nombra» no son cero.
    sinDato: sinDatoDe(por, (d) => d.cuenta),
  }
  for (const d of dims) {
    resumen[d.resumen] = listar(d.dom, d.cuenta, d.suma, haTotal)
  }

  // El marginal: lo global MÁS lo que sólo falla en esta dimensión. Se suma
  // sobre las casillas del dominio (de 6 a 989), no sobre las filas.
  const marginales = { fuente: 'marginal', n: nTotal, ha: haTotal }
  const nacionales = soloUna ? sinDatoDelManifest(m) : null
  for (const d of dims) {
    if (soloUna && d === activos[0]) {
      // Su marginal es el país. Se toma del manifest en vez de contarlo.
      d.mCuenta = null
      marginales[d.resumen] = d.dom
        .filter((x) => x.n > 0)
        .map((x) => ({ ...x, pct: m.total.ha > 0 ? (100 * x.ha) / m.total.ha : null }))
        .sort((a, b) => b.ha - a.ha)
      if (d.col === 'comuna') marginales.regiones = m.regiones.filter((r) => r.n > 0)
      continue
    }
    d.mCuenta = new Int32Array(d.k + 1)
    d.mSuma = new Float64Array(d.k + 1)
    for (let j = 0; j <= d.k; j++) {
      d.mCuenta[j] = d.cuenta[j] + d.xCuenta[j]
      d.mSuma[j] = d.suma[j] + d.xSuma[j]
    }
    marginales[d.resumen] = listar(d.dom, d.mCuenta, d.mSuma, haTotal + d.xHa)
    if (d.col === 'comuna') marginales.regiones = regionesDe(d.mCuenta, d.mSuma)
  }
  marginales.sinDato = sinDatoDe(por, (d) => d.mCuenta ?? d.cuenta)
  // La dimensión que se saltó el conteo toma su «sin dato» del manifest, por la
  // misma razón: su marginal es el país.
  if (soloUna) {
    const salvo = SIN_DATO_POR_COL[activos[0].col]
    if (salvo) marginales.sinDato[salvo] = nacionales[salvo]
  }

  // null y no una caja degenerada cuando el recorte esta vacio, que NO es un
  // caso raro: 834 de las 2.979 combinaciones de uso x comuna no devuelven ni
  // una fila (el 28 %), y 16 clases del vocabulario no tienen ninguna. La guarda
  // atrapa ademas el caso de lon/lat corruptos: con NaN todas las comparaciones
  // son falsas, los acumuladores se quedan en Infinity y esto devuelve null en
  // vez de unos bounds que Leaflet aceptaria para irse a ninguna parte.
  const caja = x0 <= x1 && y0 <= y1 ? [x0, y0, x1, y1] : null

  return { mascara, resumen, marginales, caja }
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
