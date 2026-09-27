/**
 * El número de esquema del .bin vive en CUATRO sitios que suben juntos (CLAUDE.md §4):
 * el ETL que lo escribe, D1 que lo exige del manifest, el lector del navegador y el de
 * Node. D1 sólo compara el manifest con SU literal: si alguien sube el ETL, D1 y el
 * lector de Node y olvida binario.js, el CI queda verde y cada visitante ve «este visor
 * lee el 5». Esta prueba lee los cuatro como TEXTO y exige que digan lo mismo.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { ESQUEMA } from '../scripts/datos-node.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const leer = (ruta) => readFileSync(join(RAIZ, ...ruta.split('/')), 'utf8')

// [dónde, patrón que tiene que encontrar el número]
const SITIOS = [
  ['ETL/build_bin.py', /"esquema":\s*(\d+)/],
  ['ETL/verificar_datos.py', /man\.get\("esquema"\)\s*!=\s*(\d+)/],
  ['frontend/src/datos/binario.js', /man\.esquema\s*!==\s*(\d+)/],
]

test('el número de esquema es el mismo en los cuatro sitios', () => {
  for (const [ruta, patron] of SITIOS) {
    const m = leer(ruta).match(patron)
    // Si el patrón deja de encontrarlo, la prueba no compararía nada: que falle.
    assert.ok(m, `no encuentro el número de esquema en ${ruta} con ${patron}`)
    assert.equal(Number(m[1]), ESQUEMA, `${ruta} dice esquema ${m[1]} y datos-node.mjs dice ${ESQUEMA}`)
  }
})

test('el comparador caza un literal que se quedó atrás (negativa)', () => {
  const binario = leer('frontend/src/datos/binario.js').replace(/man\.esquema\s*!==\s*\d+/, 'man.esquema !== 4')
  const m = binario.match(SITIOS[2][1])
  assert.notEqual(Number(m[1]), ESQUEMA)
})
