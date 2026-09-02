/**
 * La aritmética de los filtros en cascada, contra un oráculo INDEPENDIENTE.
 *
 * Por qué existe este archivo aparte de verificar.py: la cascada es lo primero
 * que rompe cualquier cambio en el cruce, y `verificar.py` necesita Chrome, así
 * que el CI no lo corre. Esto es Node pelado sobre el .bin commiteado: tarda
 * segundos, no necesita GPU ni navegador, y corre en cada push.
 *
 * QUÉ COMPRUEBA, Y POR QUÉ ASÍ. No compara contra cifras guardadas —eso sólo
 * detecta que algo cambió, no que esté mal, y obliga a reescribir la prueba
 * cada vez que cambian los datos—. Compara contra una implementación TONTA y
 * separada: para la dimensión D, recorrer el .bin aplicando a mano todos los
 * filtros MENOS el suyo. Si las dos coinciden sobre 1.827.933 filas reales, el
 * truco del «cuenta cuántas fallas» hace lo que dice.
 *
 * Y no sólo sobre los casos que se le ocurrieron a quien lo escribió: hay un
 * FUZZ con semilla fija que arma filtros al azar —número de dimensiones, qué
 * dimensiones, cuántas clases de cada una— y los contrasta igual. Es lo que
 * caza lo que nadie anticipó, que es justo de lo que se trata.
 *
 * Uso:  node frontend/verificacion/marginales.mjs [--negativas]
 *
 * `--negativas` corrompe el resultado a propósito y exige que la comprobación
 * se ponga ROJA. Una prueba que no se ha visto fallar no es una prueba, y ésta
 * es la que sostiene toda la cascada.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DIMENSIONES, SIN_DATO_POR_COL, resumenYMarginales } from '../src/indicadores.js'
import { derivarDeColumnas, derivarDeEspecie } from '../src/datos/derivadas.js'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const DATOS = path.join(AQUI, '..', 'public', 'datos')
const CTOR = { f32: Float32Array, u16: Uint16Array, u8: Uint8Array }

// Los recuentos se exigen EXACTOS; las hectáreas con 1e-7 relativo.
//
// Con una sola dimensión activa el marginal toma las hectáreas del manifest, y
// el manifest las acumuló en float64 sobre los valores ORIGINALES, mientras que
// este oráculo suma la columna float32 del .bin. Un polígono de 100.000 ha ya
// lleva ~0,008 ha de error de cuantización en float32, así que sobre miles de
// polígonos la diferencia llega a la centésima. La cifra del manifest es la
// buena y la interfaz redondea a hectárea entera. Con 1e-7 relativo, una clase
// EQUIVOCADA sigue cayendo: se diferencian en órdenes de magnitud.
const casi = (a, b) => Math.abs(a - b) <= 0.02 + 1e-7 * Math.abs(a)

function cargar() {
  const man = JSON.parse(fs.readFileSync(path.join(DATOS, 'manifest.json'), 'utf8'))
  const capa = man.capas.cbn_puntos
  const b = fs.readFileSync(path.join(DATOS, capa.archivo))
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  const n = capa.filas
  const datos = { n, manifest: man }
  for (const [nombre, c] of Object.entries(capa.campos)) {
    datos[nombre] = new CTOR[c.tipo](ab, c.offset, n)
  }
  // Las seis derivadas de la especie NO están en el .bin: las construye el
  // mismo módulo que usa el visor, para que el oráculo mida lo que se publica.
  Object.assign(datos, derivarDeEspecie(datos.especie, n, man))
  Object.assign(datos, derivarDeColumnas(datos, n, man))
  return datos
}

// ---------------------------------------------------------------- el oráculo
// A propósito tonto y lento: Set.has() por fila y una pasada por dimensión. Si
// se pareciera al código que verifica, compartiría sus errores.

function mascaraAPelo(datos, filtros, excluir = null) {
  const activos = DIMENSIONES
    .filter((d) => d.col !== excluir && filtros[d.col]?.size)
    .map((d) => [datos[d.col], filtros[d.col]])
  const f = new Uint8Array(datos.n)
  fila: for (let i = 0; i < datos.n; i++) {
    for (const [col, sel] of activos) if (!sel.has(col[i])) continue fila
    f[i] = 1
  }
  return f
}

function contarAPelo(datos, mascara, dim) {
  const dom = datos.manifest[dim.dominio]
  const cuenta = new Int32Array(dom.length + 1)
  const suma = new Float64Array(dom.length + 1)
  const col = datos[dim.col]
  for (let i = 0; i < datos.n; i++) {
    if (!mascara[i]) continue
    const v = col[i]
    const j = v === dim.centinela ? dom.length : v
    cuenta[j] += 1
    suma[j] += datos.ha[i]
  }
  return { cuenta, suma }
}

/** Todo lo que el cruce debería devolver, calculado del modo más simple. */
function oraculo(datos, filtros) {
  const mascara = mascaraAPelo(datos, filtros)
  let n = 0
  let ha = 0
  for (let i = 0; i < datos.n; i++) if (mascara[i]) { n += 1; ha += datos.ha[i] }
  const marginales = {}
  const global = {}
  for (const d of DIMENSIONES) {
    marginales[d.col] = contarAPelo(datos, mascaraAPelo(datos, filtros, d.col), d)
    global[d.col] = contarAPelo(datos, mascara, d)
  }
  return { mascara, n, ha, marginales, global }
}

// ------------------------------------------------------------- comparación
function comparar(datos, filtros, obtenido) {
  const esperado = oraculo(datos, filtros)
  const m = datos.manifest
  const problemas = []

  let dif = 0
  for (let i = 0; i < datos.n; i++) if (obtenido.mascara[i] !== esperado.mascara[i]) dif += 1
  if (dif) problemas.push(`la máscara difiere en ${dif.toLocaleString('es-CL')} filas`)
  if (obtenido.resumen.n !== esperado.n) {
    problemas.push(`el total cuenta ${obtenido.resumen.n} y son ${esperado.n}`)
  }
  if (!casi(obtenido.resumen.ha, esperado.ha)) {
    problemas.push(`el total suma ${obtenido.resumen.ha} y son ${esperado.ha}`)
  }

  for (const d of DIMENSIONES) {
    const dom = m[d.dominio]
    const ref = esperado.marginales[d.col]
    const vistas = new Map((obtenido.marginales[d.resumen] ?? []).map((f) => [f.cod, f]))
    let malas = 0
    let ejemplo = ''
    for (let j = 0; j < dom.length; j++) {
      const f = vistas.get(dom[j].cod)
      const gotN = f?.n ?? 0
      const gotHa = f?.ha ?? 0
      if (gotN !== ref.cuenta[j] || !casi(gotHa, ref.suma[j])) {
        malas += 1
        if (!ejemplo) {
          ejemplo = ` (p.ej. ${dom[j].cod}: n ${gotN}≠${ref.cuenta[j]}, ha ${gotHa}≠${ref.suma[j]})`
        }
      }
    }
    // Y al revés: una clase que el marginal publica y el oráculo no tiene.
    for (const [cod, f] of vistas) {
      const j = dom.findIndex((x) => x.cod === cod)
      if (j < 0 || (ref.cuenta[j] === 0 && f.n > 0)) malas += 1
    }
    if (malas) problemas.push(`${d.col}: ${malas} clases mal${ejemplo}`)

    // LA CASILLA DEL CENTINELA, que es la que alimenta «N polígonos sin este
    // dato». Sin esta comprobación la prueba pasaba en verde con el centinela
    // roto: las filas sin dato caían fuera del acumulador —un índice 255 sobre
    // un Int32Array de 10 se descarta en silencio— y las clases reales salían
    // idénticas. Los que mentían eran los pies del panel, que es justo lo que
    // nadie mira dos veces.
    const nombre = SIN_DATO_POR_COL[d.col]
    if (!nombre) continue   // SNASPE no publica «sin dato»: su centinela es una respuesta
    const refM = ref.cuenta[dom.length]
    const gotM = obtenido.marginales.sinDato?.[nombre] ?? 0
    if (gotM !== refM) problemas.push(`${d.col}: sin dato marginal ${gotM} ≠ ${refM}`)
    const refG = esperado.global[d.col].cuenta[dom.length]
    const gotG = obtenido.resumen.sinDato?.[nombre] ?? 0
    if (gotG !== refG) problemas.push(`${d.col}: sin dato del recorte ${gotG} ≠ ${refG}`)
  }
  return problemas
}

// ------------------------------------------------------------------- casos
const idx = (m, dom, cod) => m[dom].findIndex((d) => d.cod === cod)
/** El índice de la clase más poblada del dominio, entre las que pasen el filtro. */
const mayor = (m, dom, filtro = () => true) =>
  m[dom].map((x, i) => [i, x]).filter(([, x]) => filtro(x))
    .sort((a, b) => b[1].n - a[1].n)[0][0]
const region = (m, cod) =>
  new Set(m.comunas.map((c, i) => (c.region === cod ? i : -1)).filter((i) => i >= 0))

function casosFijos(m) {
  return [
    ['una dimensión (toma el atajo del manifest)',
     { cober: new Set([idx(m, 'coberturas', '01')]) }],
    // El atajo de «una sola dimensión» y el camino largo son DOS caminos de
    // código. Este caso tiene el mismo conjunto de filas que el anterior pero
    // con dos dimensiones activas —la segunda no descarta nada—, así que
    // recorre el otro. Sin él, media función queda sin ejercitar.
    ['una dimensión, pero por el camino largo',
     { cober: new Set([idx(m, 'coberturas', '01')]),
       uso: new Set(m.usos.map((_, i) => i)) }],
    ['dos dimensiones',
     { uso: new Set([idx(m, 'usos', '04')]), cober: new Set([idx(m, 'coberturas', '01')]) }],
    // Dentro de un grupo las clases se cruzan con O, no con Y.
    ['varias clases en la misma dimensión',
     { cober: new Set([idx(m, 'coberturas', '01'), idx(m, 'coberturas', '02'),
                       idx(m, 'coberturas', '03')]) }],
    ['ámbito solo', { comuna: region(m, '15') }],
    ['ámbito + temático', { comuna: region(m, '11'), uso: new Set([idx(m, 'usos', '04')]) }],
    // Cinco a la vez y con filas dentro: cada clase es la MAYOR de su
    // dimensión, o el cruce sale vacío y no ejercita la rama de «pasa todo».
    ['cinco dimensiones a la vez',
     { uso: new Set([idx(m, 'usos', '04')]),
       subuso: new Set([idx(m, 'subusos', '0402')]),
       cober: new Set([idx(m, 'coberturas', '01'), idx(m, 'coberturas', '02')]),
       tifo: new Set([mayor(m, 'tipos_forestales', (x) => x.cod !== '00')]),
       comuna: region(m, '10') }],
    // El caso que se olvida: el filtro que no deja NADA. Aquí es donde un
    // marginal mal hecho devuelve el país entero en vez de cero.
    ['un filtro que no deja nada',
     { uso: new Set([idx(m, 'usos', '07')]),
       tifo: new Set([idx(m, 'tipos_forestales', '05')]) }],
  ]
}

/** PRNG con semilla: el fuzz tiene que ser REPRODUCIBLE o no se puede depurar. */
function aleatorio(semilla) {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function casosFuzz(m, cuantos, semilla = 20260826) {
  const rnd = aleatorio(semilla)
  const elegir = (n) => Math.floor(rnd() * n)
  // Los índices de cada dominio ordenados de mayor a menor población. Eligiendo
  // clases al azar entre las 989 especies, casi ningún cruce deja filas y el
  // camino caliente —la rama de «pasa todo», que alimenta las diez
  // dimensiones— se queda sin ejercitar. Medido: 7 de 12 casos daban cero.
  // Se elige casi siempre entre las mayores, y de vez en cuando una rara, que
  // es donde viven los desbordes de índice.
  const mayores = {}
  for (const d of DIMENSIONES) {
    mayores[d.col] = m[d.dominio]
      .map((x, i) => [i, x.n ?? 0])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([i]) => i)
  }
  const casos = []
  for (let k = 0; k < cuantos; k++) {
    const cuantas = 1 + elegir(4)
    const dims = [...DIMENSIONES].sort(() => rnd() - 0.5).slice(0, cuantas)
    const filtros = {}
    for (const d of dims) {
      const vivas = mayores[d.col]
      if (!vivas.length) continue
      const tope = Math.max(1, Math.min(8, vivas.length))
      const clases = 1 + elegir(Math.min(4, vivas.length))
      const s = new Set()
      while (s.size < clases) {
        s.add(rnd() < 0.85 ? vivas[elegir(tope)] : vivas[elegir(vivas.length)])
      }
      filtros[d.col] = s
    }
    casos.push([`fuzz #${k + 1} · ${Object.keys(filtros).join('+')}`, filtros])
  }
  return casos
}

// --------------------------------------------------------------- negativas
// Corrompen el RESULTADO, no el código: lo que se comprueba aquí es que el
// comparador de arriba caza cada forma de romper la cascada. Si una de éstas
// pasara en verde, la prueba entera sería decorativa.
const NEGATIVAS = [
  ['el marginal vuelve a ser el recorte completo (el defecto original)',
   (r, datos, filtros) => {
     // Es lo que hacía el panel antes: contar cada dimensión sobre la máscara
     // que YA aplica su propio filtro.
     const m = datos.manifest
     const out = { ...r, marginales: { ...r.marginales } }
     for (const d of DIMENSIONES) {
       if (!filtros[d.col]?.size) continue
       const sel = filtros[d.col]
       out.marginales[d.resumen] = (r.marginales[d.resumen] ?? [])
         .filter((f) => sel.has(m[d.dominio].findIndex((x) => x.cod === f.cod)))
     }
     return out
   }],
  ['una clase del marginal desaparece',
   (r) => {
     const out = { ...r, marginales: { ...r.marginales } }
     const d = DIMENSIONES.find((x) => (r.marginales[x.resumen] ?? []).length > 1)
     out.marginales[d.resumen] = r.marginales[d.resumen].slice(1)
     return out
   }],
  ['un marginal con las hectáreas al doble',
   (r) => {
     const out = { ...r, marginales: { ...r.marginales } }
     const d = DIMENSIONES.find((x) => (r.marginales[x.resumen] ?? []).length > 0)
     out.marginales[d.resumen] = r.marginales[d.resumen]
       .map((f, i) => (i === 0 ? { ...f, ha: f.ha * 2 } : f))
     return out
   }],
  ['la máscara del mapa se descuadra en una fila',
   (r) => {
     const mascara = Uint8Array.from(r.mascara)
     const i = mascara.indexOf(1)
     mascara[i >= 0 ? i : 0] = i >= 0 ? 0 : 1
     return { ...r, mascara }
   }],
  ['el total del recorte cuenta una fila de más',
   (r) => ({ ...r, resumen: { ...r.resumen, n: r.resumen.n + 1 } })],
]

// ------------------------------------------------------------------- main
function main() {
  const negativas = process.argv.includes('--negativas')
  const datos = cargar()
  const m = datos.manifest
  console.log(`${datos.n.toLocaleString('es-CL')} filas · esquema ${m.esquema} · ` +
              `sha ${m.capas.cbn_puntos.sha256.slice(0, 12)}\n`)

  const casos = [...casosFijos(m), ...casosFuzz(m, 12)]
  let rojos = 0
  for (const [etiqueta, filtros] of casos) {
    const t0 = performance.now()
    const r = resumenYMarginales(datos, filtros)
    const ms = performance.now() - t0
    const problemas = comparar(datos, filtros, r)
    if (problemas.length) rojos += 1
    const marca = problemas.length ? 'FALLA' : 'OK   '
    console.log(`  ${marca} ${etiqueta.padEnd(46)} ${r.resumen.n.toLocaleString('es-CL').padStart(10)} filas · ${ms.toFixed(0).padStart(3)} ms`)
    for (const p of problemas) console.log(`        ${p}`)
  }

  // --- el coste, con techo -------------------------------------------------
  // El gate de coste vive AQUI y no en verificar.py: alli la misma medida daba
  // 45 ms en una corrida y 158 en la siguiente sin tocar nada --Chrome headless
  // sin GPU, compitiendo con el resto de la maquina-- y una asercion que se cae
  // por ruido acaba desactivada. Esto es Node pelado y mediana de nueve.
  //
  // 500 ms no vigila milisegundos: caza que alguien deshaga la pasada unica y
  // vuelva a recorrer el .bin una vez por dimension, que son segundos. La cifra
  // fina esta en el comentario de `resumenYMarginales`, medida en condiciones.
  const TECHO_MS = 500
  const filtrosCoste = casosFijos(m)[2][1]
  const t = []
  for (let k = 0; k < 11; k++) {
    const t0 = performance.now()
    resumenYMarginales(datos, filtrosCoste)
    if (k > 1) t.push(performance.now() - t0)   // las dos primeras calientan
  }
  t.sort((a, b) => a - b)
  const mediana = t[Math.floor(t.length / 2)]
  const okCoste = mediana < TECHO_MS
  if (!okCoste) rojos += 1
  console.log(`\n  ${okCoste ? 'OK   ' : 'FALLA'} coste de la pasada: mediana ${mediana.toFixed(0)} ms ` +
              `de ${TECHO_MS} (peor ${t[t.length - 1].toFixed(0)})`)

  if (negativas) {
    console.log('\n--- pruebas negativas: cada defecto DEBE poner roja la comparación ---')
    const filtros = casosFijos(m)[2][1]   // dos dimensiones: hay marginal que romper
    const limpio = resumenYMarginales(datos, filtros)
    for (const [etiqueta, romper] of NEGATIVAS) {
      const problemas = comparar(datos, filtros, romper(limpio, datos, filtros))
      const ok = problemas.length > 0
      if (!ok) rojos += 1
      console.log(`  ${etiqueta.padEnd(56)} -> ${ok ? 'ROJA, correcto' : 'PASÓ EN VERDE — la prueba no mide'}`)
    }
  }

  console.log(`\n${rojos === 0 ? 'TODO EN VERDE' : `${rojos} EN ROJO`}`)
  process.exit(rojos ? 1 : 0)
}

main()
