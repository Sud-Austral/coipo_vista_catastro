/**
 * `filtroDelAmbito`: el filtro territorial que comparten el panel y las páginas por
 * región y comuna. Si los dos armaran el suyo, una página publicada podría citar
 * para una comuna otra cifra que la del panel.
 *
 * Lo que más importa es DECISIONES §G: un ámbito sin coincidencias filtra a CERO,
 * nunca al país entero. Un Set vacío significa «ninguna»; ausente, «todas».
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { filtroDelAmbito } from '../src/indicadores.js'

const DATOS = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'datos')
const man = JSON.parse(readFileSync(join(DATOS, 'manifest.json'), 'utf8'))
const iReg = (cod) => man.regiones.findIndex((r) => r.cod === cod)

test('sin ámbito: null, que es «todo Chile»', () => {
  assert.equal(filtroDelAmbito({}, man), null)
  assert.equal(filtroDelAmbito({ region: '14' }, null), null)
})

test('región: filtra por su propia columna y no toca la de comuna', () => {
  const f = filtroDelAmbito({ region: '14' }, man)
  assert.deepEqual([...f.region], [iReg('14')])
  assert.equal(f.comuna, undefined)
})

test('comuna: la región Y la comuna, como hace el panel', () => {
  const f = filtroDelAmbito({ region: '14', comuna: '14101' }, man)
  assert.deepEqual([...f.region], [iReg('14')])
  assert.deepEqual([...f.comuna], [man.comunas.findIndex((c) => c.cod === '14101')])
})

test('provincia: todas sus comunas, y sólo las de esa región', () => {
  const f = filtroDelAmbito({ region: '14', provincia: 'Valdivia' }, man)
  const esperadas = man.comunas.flatMap((c, k) => (c.region === '14' && c.provincia === 'Valdivia' ? [k] : []))
  assert.ok(esperadas.length > 1)
  assert.deepEqual([...f.comuna].sort((a, b) => a - b), esperadas)
})

test('región inexistente: Set VACÍO, no ausente (§G)', () => {
  const f = filtroDelAmbito({ region: '99' }, man)
  assert.ok(f.region instanceof Set)
  assert.equal(f.region.size, 0)
})

test('comuna de OTRA región: Set vacío, no la comuna', () => {
  const f = filtroDelAmbito({ region: '13', comuna: '14101' }, man)
  assert.equal(f.comuna.size, 0)
})
