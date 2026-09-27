/**
 * Compartir ofrece la página estática sólo cuando la vista es EXACTAMENTE un territorio.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { cargarIndiceWeb, paginaDelEnlace } from '../src/web/enlaces.js'

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..')
const man = JSON.parse(readFileSync(join(FRONTEND, 'public', 'datos', 'manifest.json'), 'utf8'))
const indice = {
  esquema: 1,
  regiones: { 10: 'los-lagos', 14: 'los-rios' },
  comunas: { 14101: 'valdivia', 10202: 'ancud' },
}
const B = '/coipo_vista_catastro/'

test('una comuna, con o sin encuadre', () => {
  assert.equal(paginaDelEnlace('?reg=14&com=14101', indice, man), `${B}comuna/valdivia/`)
  assert.equal(paginaDelEnlace('?reg=14&com=14101&lat=-39.8&lon=-73.2&z=11&base=Satelital', indice, man), `${B}comuna/valdivia/`)
})

test('una región sola', () => {
  assert.equal(paginaDelEnlace('?reg=10&lat=-41&lon=-73&z=7', indice, man), `${B}region/los-lagos/`)
})

test('región → provincia → comuna: vale si la provincia es la de la comuna', () => {
  const ancud = man.comunas.find((c) => c.cod === '10202')
  const q = new URLSearchParams({ reg: '10', prov: ancud.provincia, com: '10202' }).toString()
  assert.equal(paginaDelEnlace(`?${q}`, indice, man), `${B}comuna/ancud/`)
  assert.equal(paginaDelEnlace('?reg=10&prov=Llanquihue&com=10202', indice, man), null)
})

test('con un uso o un filtro, NO: las cifras de la página serían otras', () => {
  assert.equal(paginaDelEnlace('?reg=14&com=14101&usos=04', indice, man), null)
  assert.equal(paginaDelEnlace('?reg=14&com=14101&usos=', indice, man), null, 'usos vacío es «ninguna»')
  assert.equal(paginaDelEnlace('?reg=14&tifo=05', indice, man), null)
})

test('lo que no es un territorio con página, tampoco', () => {
  assert.equal(paginaDelEnlace('', indice, man), null, 'todo Chile tiene la portada')
  assert.equal(paginaDelEnlace('?reg=14&com=10202', indice, man), null, 'una comuna de otra región')
  assert.equal(paginaDelEnlace('?reg=10&prov=Chiloé', indice, man), null, 'las provincias no tienen página')
  assert.equal(paginaDelEnlace('?reg=14&com=14101', { ...indice, esquema: 2 }, man), null, 'otro esquema de índice')
  assert.equal(paginaDelEnlace('?reg=14&com=14101', null, man), null, 'sin índice')
})

test('cargarIndiceWeb: null ante 404, HTML del servidor de desarrollo, red caída u otro esquema', async () => {
  const resp = (status, tipo, cuerpo) => async () => new Response(cuerpo, { status, headers: { 'Content-Type': tipo } })
  assert.equal(await cargarIndiceWeb(B, resp(404, 'text/html', 'no')), null)
  assert.equal(await cargarIndiceWeb(B, resp(200, 'text/html', '<!doctype html>')), null)
  assert.equal(await cargarIndiceWeb(B, async () => { throw new TypeError('fetch failed') }), null)
  assert.equal(await cargarIndiceWeb(B, resp(200, 'application/json', '{"esquema":2}')), null)
  assert.deepEqual(await cargarIndiceWeb(B, resp(200, 'application/json; charset=utf-8', JSON.stringify(indice))), indice)
})
