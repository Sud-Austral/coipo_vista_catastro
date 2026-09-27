/**
 * Las cifras de la prosa (src/hechos.js), contra los datos REALES y por otro camino.
 *
 * No compara contra números guardados: eso sólo detecta que algo cambió, no que esté
 * mal, y obliga a reescribir la prueba cada vez que cambian los datos. Recalcula cada
 * cifra con una lectura propia y tonta del manifest y de oficiales.json.
 *
 * Uso:  node --test verificacion/*.test.mjs      (npm run prueba)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  especiesConservacion, haPlantacionEspecie, haSnaspe, mayorPoligono, mayorResiduoUso,
  oficialesPorRegion, pctRecortados, rangoAnios, rangoAniosTexto, totalOficial,
} from '../src/hechos.js'
import { cargarDatos, exigirEsquema } from '../scripts/datos-node.mjs'

const DATOS = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'datos')
const man = JSON.parse(readFileSync(join(DATOS, 'manifest.json'), 'utf8'))
const of = JSON.parse(readFileSync(join(DATOS, 'oficiales.json'), 'utf8'))
const copia = (x) => JSON.parse(JSON.stringify(x))

test('rango de años: el menor y el mayor de todos los años que nombra el manifest', () => {
  // Otro camino: todos los grupos de cuatro dígitos, con regex, sin partir por guion.
  const anios = man.regiones.flatMap((r) => String(r.anio).match(/\d{4}/g).map(Number))
  assert.deepEqual(rangoAnios(man), { desde: Math.min(...anios), hasta: Math.max(...anios) })
  assert.equal(rangoAniosTexto(man), `${Math.min(...anios)} y ${Math.max(...anios)}`)
  // Un periodo aporta sus DOS extremos: si sólo contara el primero, 2020-2022 no
  // podría ser el máximo.
  assert.deepEqual(rangoAnios({ regiones: [{ anio: '2015' }, { anio: '2020-2022' }] }), { desde: 2015, hasta: 2022 })
  assert.equal(rangoAniosTexto({ regiones: [{ anio: '2019' }] }), '2019')
  assert.equal(rangoAnios({ regiones: [] }), null)
})

test('especies: cuántas tienen categoría y cuántas no se han verificado', () => {
  let sin = 0
  for (const e of man.especies) if (/^Sin dato/.test(e.conservacion)) sin++
  assert.deepEqual(especiesConservacion(man), {
    total: man.especies.length, sinVerificar: sin, conCategoria: man.especies.length - sin,
  })
})

test('discos recortados: el porcentaje entero de las filas', () => {
  const { radio, filas } = man.capas.cbn_puntos
  assert.equal(pctRecortados(man), Math.round((radio.recortados / filas) * 100))
})

test('planilla oficial: total del país y mayor residuo por clase de uso', () => {
  assert.equal(totalOficial(of), of.total_pais.total)
  const residuos = man.usos.map((u) => Math.abs(u.ha - of.total_pais['uso:' + u.cod]))
  assert.equal(mayorResiduoUso(man, of), Math.max(...residuos))
})

test('SNASPE: una unidad por su nombre exacto', () => {
  const u = man.snaspe[0]
  assert.equal(haSnaspe(man, u.etiqueta), u.ha)
  assert.equal(haSnaspe(man, 'Parque Nacional Que No Existe'), null)
})

test('oficiales por región: las 16 casan, cada fila una sola vez', () => {
  const m = oficialesPorRegion(man, of)
  assert.equal(m.size, man.regiones.length)
  assert.equal(new Set(m.values()).size, man.regiones.length)
  // Magallanes es la que exige la regla explícita: sin ella no casaría.
  assert.match(m.get('12').region, /^Magallanes/)
  for (const r of man.regiones) {
    const tildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    if (r.cod !== '12') assert.equal(tildes(m.get(r.cod).region), tildes(r.nombre))
  }
})

test('oficiales por región — NEGATIVAS: renombrar o duplicar tiene que lanzar', () => {
  const renombrada = copia(of)
  renombrada.regiones.find((r) => r.region === 'Los Ríos').region = 'Región de Los Ríos'
  assert.throws(() => oficialesPorRegion(man, renombrada), /no tiene fila/)

  const duplicada = copia(of)
  duplicada.regiones.push(copia(duplicada.regiones[0]))
  assert.throws(() => oficialesPorRegion(man, duplicada), /dos filas/)

  const otroEsquema = copia(of)
  otroEsquema.esquema = 2
  assert.throws(() => oficialesPorRegion(man, otroEsquema), /esquema/)
})

test('el cargador del .bin rechaza un manifest de otro esquema', () => {
  // Un esquema equivocado abre vistas tipadas VÁLIDAS sobre bytes corridos: el
  // mapa y las páginas saldrían plausibles y falsos, sin ningún error.
  assert.doesNotThrow(() => exigirEsquema(man))
  for (const e of [4, 6, undefined]) assert.throws(() => exigirEsquema({ ...man, esquema: e }), /esquema/)
})

test('cifras que exigen el .bin: Pinus radiata y el polígono mayor', () => {
  const datos = cargarDatos()
  const e = man.especies.findIndex((x) => x.cod === 'PR')
  const s = man.subusos.findIndex((x) => x.cod === '0401')
  let pinus = 0
  let mayor = 0
  for (let i = 0; i < datos.n; i++) {
    if (datos.especie[i] === e && datos.subuso[i] === s) pinus += datos.ha[i]
    mayor = Math.max(mayor, datos.ha[i])
  }
  assert.equal(haPlantacionEspecie(datos, man, 'PR'), pinus)
  assert.equal(mayorPoligono(datos), mayor)
  // EL CÓDIGO DISTINGUE MAYÚSCULAS (CLAUDE.md §5): `pr` es Poa pratensis, no pino.
  assert.equal(man.especies.find((x) => x.cod === 'pr')?.cientifico, 'Poa pratensis')
  assert.notEqual(haPlantacionEspecie(datos, man, 'pr'), pinus)
  // Sin datos no hay cifra, en vez de una inventada.
  assert.equal(haPlantacionEspecie(null, man, 'PR'), null)
  assert.equal(mayorPoligono(null), null)
})
