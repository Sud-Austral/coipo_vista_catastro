/**
 * Columnas DERIVADAS del código de especie, en su propio módulo.
 *
 * Vive aparte de `binario.js` por una razón concreta: `marginales.mjs` --el
 * oráculo del cruce, que corre en Node y en el CI-- necesita exactamente estas
 * columnas, y no puede importar `binario.js` porque ése arrastra `config.js` y
 * con él `import.meta.env`, que en Node no existe. Con la derivación duplicada,
 * el oráculo mediría una versión distinta de la que ve el visor, que es la
 * forma más fina de que una prueba pase en verde sin proteger nada.
 */
/**
 * Las seis dimensiones que describen la VEGETACIÓN y no el polígono: grupo
 * botánico, hábito, condición arbórea, origen, comportamiento invasor y estado
 * de conservación.
 *
 * SE DERIVAN AQUÍ Y NO VIENEN EN EL .bin. Todas son función del código de
 * especie, que ya viaja en su columna, así que mandarlas serían seis bytes más
 * por punto —~11 MB— para un dato que cabe en las 989 filas de
 * `manifest.especies`. La derivación es una pasada por columna: medida, unos
 * pocos milisegundos frente a los ~60-90 ms que ya cuesta el cruce.
 *
 * EL ORDEN DEL DOMINIO SE LEE DEL MANIFEST, no se recalcula. Ordenar aquí y en
 * el ETL por separado es pedir que dos `sort` distintos coincidan sobre valores
 * con tilde —«Sí», «En Peligro Crítico»—, y si no coinciden los índices apuntan
 * a la clase equivocada sin ningún error visible.
 */
const DERIVADAS = [
  ['grupo', 'grupos'],
  ['habito', 'habitos'],
  ['arboreo', 'arboreas'],
  ['origen', 'origenes'],
  ['invasora', 'invasoras'],
  ['conservacion', 'conservaciones'],
]

/**
 * Las tres dimensiones que NO salen de la especie: protección, tramo de
 * superficie y año del catastro.
 *
 * Comparten el mismo principio que las seis de arriba —son función de columnas
 * que ya viajan, así que no cuestan un byte— pero cada una lee una distinta:
 * `snaspe`, `ha` y `region`.
 *
 * LOS CORTES DE SUPERFICIE SE LEEN DEL MANIFEST, no se repiten aquí. El ETL los
 * define y los publica con `desde`/`hasta` en cada clase; copiarlos sería tener
 * dos listas de números en dos lenguajes que nadie garantiza que sigan iguales.
 */
export function derivarDeColumnas(datos, n, man) {
  const out = {}

  // Protección: el centinela de `snaspe` no es «no se sabe», es «fuera del
  // Sistema» — el 78 % del país. Es una respuesta, y ahora se puede filtrar.
  const pro = man.protecciones ?? []
  if (pro.length && datos.snaspe) {
    const centinela = man.capas.cbn_puntos.campos.snaspe.centinela
    const dentro = pro.findIndex((d) => d.cod === 'Dentro del SNASPE')
    const fuera = pro.findIndex((d) => d.cod === 'Fuera del SNASPE')
    const col = new Uint8Array(n)
    for (let i = 0; i < n; i++) col[i] = datos.snaspe[i] === centinela ? fuera : dentro
    out.proteccion = col
  }

  // Tramo de superficie, con los cortes que publica el manifest.
  const tam = man.tamanos ?? []
  if (tam.length && datos.ha) {
    const col = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const v = datos.ha[i]
      let j = tam.length - 1
      for (let k = 0; k < tam.length; k++) {
        const hasta = tam[k].hasta
        if (v >= tam[k].desde && (hasta == null || v < hasta)) { j = k; break }
      }
      col[i] = j
    }
    out.tamano = col
  }

  // Año del catastro: se traduce la región a su año y el año a su clase. Los
  // periodos —«2017-2019»— se conservan tal cual: elegir uno de sus extremos
  // sería inventar una fecha que el Catastro no da.
  const anios = man.anios ?? []
  const regiones = man.regiones ?? []
  if (anios.length && regiones.length && datos.region) {
    const pos = new Map(anios.map((d, i) => [d.cod, i]))
    const trad = new Uint8Array(regiones.length)
    regiones.forEach((r, i) => { trad[i] = pos.get(r.anio) ?? 0 })
    const col = new Uint8Array(n)
    for (let i = 0; i < n; i++) col[i] = trad[datos.region[i]]
    out.anio = col
  }

  return out
}

export function derivarDeEspecie(especie, n, man) {
  const especies = man.especies ?? []
  const centinela = man.capas.cbn_puntos.campos.especie.centinela
  const out = {}
  for (const [campo, clave] of DERIVADAS) {
    const dominio = man[clave] ?? []
    const pos = new Map(dominio.map((d, i) => [d.cod, i]))
    // La tabla lleva una entrada extra al final para el centinela: las 284.279
    // filas sin especie quedan «sin dato» en las seis, que es lo correcto —«no
    // se sabe la especie» no es «no es nativa»—.
    const trad = new Uint8Array(especies.length + 1).fill(255)
    especies.forEach((e, i) => {
      const p = pos.get(e[campo])
      if (p !== undefined) trad[i] = p
    })
    const col = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const e = especie[i]
      col[i] = trad[e === centinela ? especies.length : e]
    }
    out[campo] = col
  }
  return out
}
