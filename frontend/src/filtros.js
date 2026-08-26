/**
 * Las dimensiones por las que se puede filtrar, con lo que hay que decir de
 * cada una.
 *
 * NADA de vocabulario aquí: las clases, sus etiquetas y sus cifras salen del
 * manifest. Lo que vive aquí es lo que el manifest no puede saber — cómo se
 * llama la dimensión en pantalla, en qué orden se leen sus clases, y qué
 * advertencia va pegada a ella.
 *
 * `nota` NO es decorativa. Cinco de estas nueve dimensiones se malinterpretan
 * de una forma concreta y previsible, y la advertencia va junto al control, no
 * en una página de metodología que nadie abre teniendo el filtro delante:
 *
 *   - la especie es la PRINCIPAL del polígono, no la única (hay hasta seis);
 *   - la altura viene en DOS escalas cuyos tramos se solapan;
 *   - el subtipo forestal y la especie NO los nombra la guía oficial;
 *   - fuera del bosque, «tipo forestal» y «subtipo» simplemente no aplican, y
 *     eso no es lo mismo que valer cero.
 *
 * `vocabulario` sale del manifest y dice si el vocabulario es oficial. Se
 * muestra porque «lo dice la guía de CONAF» y «lo dedujimos del dato» no son la
 * misma autoridad, y quien cite una cifra tiene derecho a saber cuál es cuál.
 */

/** Un Set vacío compartido: «todas», no «ninguna». Evita recrearlo por render. */
export const NINGUNO = new Set()

export const FILTROS = [
  {
    col: 'uso',
    clave: 'usos',
    resumen: 'usos',
    titulo: 'Clase de uso de la tierra',
    corto: 'Uso',
    abierto: true,
  },
  {
    col: 'subuso',
    clave: 'subusos',
    resumen: 'subusos',
    titulo: 'Subclase',
    corto: 'Subclase',
    buscador: true,
    // Seis de las 43 subclases se llaman «Sin Información» —una por clase de
    // uso, códigos 0199 a 0899— y sin el uso al lado son indistinguibles.
    contexto: 'uso',
    nota: 'Dentro de Bosques distingue nativo, plantación y mixto.',
  },
  {
    col: 'estruc',
    clave: 'estructuras',
    resumen: 'estructuras',
    titulo: 'Estructura',
    corto: 'Estructura',
    buscador: true,
    // Aquí es mucho peor: de las 58 estructuras, «No Aplica» son 38 —una por
    // subclase sin estructura propia— y «Sin Información» otras 3. Sin la
    // subclase al lado, dos docenas de filas idénticas seguidas.
    contexto: 'subuso',
  },
  {
    col: 'tifo',
    clave: 'tipos_forestales',
    resumen: 'tiposForestales',
    titulo: 'Tipo forestal',
    corto: 'Tipo forestal',
    nota: 'Sólo aplica al bosque nativo. El resto del territorio no tiene tipo forestal, que no es lo mismo que tener cero.',
  },
  {
    col: 'stifo',
    clave: 'subtipos_forestales',
    resumen: 'subtiposForestales',
    titulo: 'Subtipo forestal',
    corto: 'Subtipo',
    buscador: true,
    nota: 'Subdivisión del tipo forestal. Se agrupa por el texto de la capa porque su código no distingue los 37 subtipos.',
  },
  {
    col: 'cober',
    clave: 'coberturas',
    resumen: 'coberturas',
    titulo: 'Cobertura de copas',
    corto: 'Cobertura',
    porOrden: true,
    nota: 'Densidad del dosel, de Denso a Escaso. «No Aplica» es el territorio donde la pregunta no tiene sentido, como los cuerpos de agua.',
  },
  {
    col: 'altura',
    clave: 'alturas',
    resumen: 'alturas',
    titulo: 'Altura del dosel',
    corto: 'Altura',
    porEscala: true,
    nota: 'Vienen DOS escalas distintas y sus tramos se solapan: la fina mide en metros y la gruesa sólo distingue por encima y por debajo de 2 m. No se pueden sumar entre sí.',
  },
  {
    col: 'especie',
    clave: 'especies',
    resumen: 'especies',
    titulo: 'Especie principal',
    corto: 'Especie',
    buscador: true,
    conCientifico: true,
    nota: 'Es la PRIMERA especie del polígono, la dominante. Cada polígono puede registrar hasta seis, y las otras cinco no filtran aquí. Incluye toda la vegetación, no sólo árboles.',
  },
  {
    col: 'snaspe',
    clave: 'snaspe',
    resumen: 'snaspe',
    titulo: 'Unidad del SNASPE',
    corto: 'SNASPE',
    buscador: true,
    nota: 'Sistema Nacional de Áreas Silvestres Protegidas del Estado. El Servicio de Biodiversidad y Áreas Protegidas de la Ley 21.600 está en implementación.',
  },
]

/** Cuántas clases se listan antes de exigir una búsqueda. */
export const TOPE_LISTA = 40

/**
 * Opciones de una dimensión, listas para dibujar.
 *
 * DOS FUENTES a propósito: el DOMINIO sale del manifest (todas las clases que
 * existen) y las CIFRAS del marginal vigente (las que quedan tras cruzar LAS
 * DEMÁS dimensiones — ver `resumenYMarginales`).
 *
 * UNA CLASE SIN COINCIDENCIAS SE OCULTA, y esto invierte lo que se decidía
 * antes aquí. El argumento de entonces era que si la lista se encoge al
 * filtrar, la clase que alguien busca parece no existir; pero ese argumento
 * nació de un defecto: las cifras salían del recorte COMPLETO, incluido el
 * filtro de la propia dimensión, así que marcar una clase vaciaba a todas sus
 * hermanas y ocultarlas habría dejado la lista con una sola fila. Con el
 * marginal eso ya no pasa: lo que cae a cero es lo que de verdad no tiene
 * intersección, y arrastrarlo por la lista es ruido.
 *
 * Se devuelve `sinCoincidencias` para que el pie lo diga en vez de que la lista
 * encoja en silencio, y lo MARCADO nunca se oculta: una clase activa invisible
 * dejaría el mapa filtrado por algo que no se ve en ninguna parte.
 */
export function opciones(def, manifest, cifras, seleccion, busqueda) {
  const dominio = manifest?.[def.clave] ?? []
  const vivas = new Map((cifras?.[def.resumen] ?? []).map((f) => [f.cod, f]))
  // El padre de cada clase, para las dimensiones cuyas etiquetas se repiten.
  const padres = def.contexto
    ? new Map((manifest?.[def.contexto === 'uso' ? 'usos' : 'subusos'] ?? [])
        .map((p) => [p.cod, p.etiqueta]))
    : null

  let filas = dominio.map((d, i) => {
    const viva = vivas.get(d.cod)
    return {
      ...d,
      i,
      n: viva?.n ?? 0,
      ha: viva?.ha ?? 0,
      pct: viva?.pct ?? null,
      contexto: padres ? (padres.get(d[def.contexto]) ?? null) : null,
      marcada: seleccion.has(i),
    }
  })

  const conDatos = filas.filter((f) => f.n > 0 || f.marcada)
  const sinCoincidencias = filas.length - conDatos.length
  filas = conDatos

  const q = (busqueda ?? '').trim().toLowerCase()
  if (q) {
    const coincide = (f) =>
      [f.etiqueta, f.cientifico, f.comun, f.categoria, f.contexto]
        .filter(Boolean)
        .some((t) => String(t).toLowerCase().includes(q))
    // Lo marcado NUNCA se esconde: si una búsqueda ocultara una clase activa,
    // el mapa estaría filtrado por algo que no se ve en ninguna parte.
    filas = filas.filter((f) => f.marcada || coincide(f))
  }

  if (def.porOrden) {
    filas.sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99))
  } else if (def.porEscala) {
    // Primero la escala fina y dentro de cada una por tramo. Ordenar por
    // superficie mezclaría los dos sistemas de medida en una lista que se lee
    // como si fuera una sola.
    const rango = { fina: 0, gruesa: 1, no_aplica: 2 }
    filas.sort(
      (a, b) =>
        (rango[a.escala] ?? 3) - (rango[b.escala] ?? 3) ||
        (a.orden ?? 99) - (b.orden ?? 99),
    )
  } else {
    filas.sort((a, b) => b.ha - a.ha || a.etiqueta.localeCompare(b.etiqueta, 'es'))
  }

  const total = filas.length
  // El tope no se aplica a las listas ordenadas por escala: son doce clases y
  // recortarlas partiría la escala por la mitad.
  const recortable = !def.porOrden && !def.porEscala && !q
  const visibles = recortable ? filas.slice(0, TOPE_LISTA) : filas
  // Lo marcado se ve siempre, aunque caiga fuera del tope.
  const faltan = filas.filter((f) => f.marcada && !visibles.includes(f))
  return {
    filas: [...visibles, ...faltan],
    total,
    recortadas: total - visibles.length - faltan.length,
    sinCoincidencias,
  }
}

/** Alterna una clase dentro de una dimensión y devuelve el objeto de filtros. */
export function alternar(filtros, col, i) {
  const previo = filtros[col] ?? NINGUNO
  const s = new Set(previo)
  if (s.has(i)) s.delete(i)
  else s.add(i)
  const siguiente = { ...filtros }
  // Una dimensión sin selección se BORRA en vez de quedarse con un Set vacío:
  // así `hayFiltro` y la URL no distinguen entre «nunca tocado» y «tocado y
  // vaciado», que producen exactamente el mismo resultado.
  if (s.size === 0) delete siguiente[col]
  else siguiente[col] = s
  return siguiente
}

/** Cuántas clases hay elegidas en total, para el rótulo de «limpiar». */
export function cuentaSeleccion(filtros) {
  return Object.values(filtros).reduce((a, s) => a + s.size, 0)
}

/**
 * Filtros a texto para la URL: `uso=04,02&cober=01`. Se guardan los CÓDIGOS y
 * nunca los índices, porque el índice depende del vocabulario y un reproceso
 * que añada una clase desplazaría todo lo demás — y un enlace guardado pasaría
 * a señalar otra cosa sin avisar.
 */
export function filtrosAURL(filtros, manifest) {
  const out = {}
  for (const def of FILTROS) {
    const sel = filtros[def.col]
    if (!sel || sel.size === 0) continue
    const dominio = manifest?.[def.clave] ?? []
    const cods = [...sel].map((i) => dominio[i]?.cod).filter(Boolean)
    if (cods.length) out[def.col] = cods
  }
  return out
}

/** El camino de vuelta: códigos de la URL a índices del vocabulario vigente. */
export function filtrosDesdeURL(crudo, manifest) {
  const out = {}
  for (const def of FILTROS) {
    const cods = crudo?.[def.col]
    if (!cods || !cods.length) continue
    const dominio = manifest?.[def.clave] ?? []
    const s = new Set()
    for (const cod of cods) {
      const i = dominio.findIndex((d) => d.cod === cod)
      if (i >= 0) s.add(i)
    }
    if (s.size) out[def.col] = s
  }
  return out
}
