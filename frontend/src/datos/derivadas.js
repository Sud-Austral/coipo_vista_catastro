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
