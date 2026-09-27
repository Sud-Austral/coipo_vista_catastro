/**
 * Los módulos puros de lo horneado (src/web/): dónde vive el sitio, qué dicen las
 * frases citables y cómo se escapa lo que va al <head>.
 *
 * Uso:  npm run prueba
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { BASE, URL_PUBLICA, UMAMI } from '../src/web/sitio.js'
import {
  descripcionPortada, fraseComuna, fraseNacional, fraseRegion, QUIEN, SALVEDAD, slugDePagina,
} from '../src/web/textos.js'
import { escaparHtml, etiquetaUmami, jsonLd, metasVistaPrevia } from '../src/web/cabeza.js'
import { haEntera } from '../src/formato.js'

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..')
const man = JSON.parse(readFileSync(join(FRONTEND, 'public', 'datos', 'manifest.json'), 'utf8'))
const miles = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

test('BASE es el `base` de vite.config.js y URL_PUBLICA el --base del humo (valores acoplados)', () => {
  const vite = readFileSync(join(FRONTEND, 'vite.config.js'), 'utf8')
  assert.equal(vite.match(/base:\s*'([^']+)'/)?.[1], BASE)
  const deploy = readFileSync(join(FRONTEND, '..', '.github', 'workflows', 'deploy.yml'), 'utf8')
  assert.equal(`${deploy.match(/--base (\S+)/)?.[1]}/`, URL_PUBLICA)
  assert.match(URL_PUBLICA, /^https:\/\//)
})

test('frase nacional: quién, de cuándo, cifras enteras y la salvedad', () => {
  const f = fraseNacional(man)
  assert.ok(f.startsWith('Chile: '), 'nombra el territorio al principio')
  assert.ok(f.includes(QUIEN))
  assert.ok(f.endsWith(SALVEDAD))
  assert.ok(f.includes(`${miles(man.total.filas)} polígonos`))
  assert.ok(f.includes(`${miles(Math.round(man.total.ha))} ha`))
  const nativo = man.subusos.find((s) => s.cod === '0402').ha
  assert.ok(f.includes(`${miles(Math.round(nativo))} ha de bosque nativo`))
  assert.ok(/entre \d{4} y \d{4}/.test(f), 'dice el rango de años')
  // Hectáreas enteras: un decimal en una frase citable invita a leer una precisión
  // que el Catastro no tiene. El porcentaje sí lleva uno.
  assert.doesNotMatch(f, /\d,\d+ ha/)
  // Control de la regex: la forma mala sí la caza.
  assert.match('tiene 12,5 ha de bosque', /\d,\d+ ha/)
})

test('descripción de la portada: cifra del manifest y corta', () => {
  const d = descripcionPortada(man)
  assert.ok(d.includes(miles(man.total.filas)))
  assert.ok(d.length <= 160, `${d.length} caracteres`)
})

test('haEntera: enteras, y lo que no llega a media hectárea no es «0 ha»', () => {
  assert.equal(haEntera(1234.6), '1.235 ha')
  assert.equal(haEntera(0.3), 'menos de 1 ha')
  assert.equal(haEntera(0), '0 ha')
  assert.equal(haEntera(null), '—')
})

test('JSON-LD: se parsea y un nombre con </script> no cierra el bloque', () => {
  const malo = '</script><script>alert(1)</script>'
  const bloque = jsonLd({ name: malo, b: 1, a: { d: 1, c: '&' } })
  const cuerpo = bloque.slice('<script type="application/ld+json">'.length, -'</script>'.length)
  assert.ok(!cuerpo.includes('<') && !cuerpo.includes('>') && !cuerpo.includes('&'))
  assert.deepEqual(JSON.parse(cuerpo), { name: malo, b: 1, a: { d: 1, c: '&' } })
  // Claves ordenadas: dos construcciones del mismo commit dan los mismos bytes.
  assert.ok(cuerpo.indexOf('"a"') < cuerpo.indexOf('"b"'))
})

test('escapado HTML: O\'Higgins sale como O&#x27;Higgins', () => {
  assert.equal(escaparHtml(`O'Higgins "<b>" & co`), 'O&#x27;Higgins &quot;&lt;b&gt;&quot; &amp; co')
})

test('vista previa: og:url = canonical + ?v=, y sin imagen la tarjeta es summary', () => {
  const canonical = `${URL_PUBLICA}region/los-rios/`
  const sin = metasVistaPrevia({ canonical, titulo: 'T', descripcion: 'D', imagen: null, version: 'abc123abc123' }).join('\n')
  assert.ok(sin.includes(`<link rel="canonical" href="${canonical}" />`))
  assert.ok(sin.includes(`og:url" content="${canonical}?v=abc123abc123"`))
  assert.ok(sin.includes('twitter:card" content="summary"'))
  assert.ok(!sin.includes('og:image'))
  const img = { url: `${URL_PUBLICA}og.png`, ancho: 1200, alto: 630, alt: 'A' }
  const con = metasVistaPrevia({ canonical, titulo: 'T', descripcion: 'D', imagen: img, version: 'v' }).join('\n')
  assert.ok(con.includes('summary_large_image') && con.includes('og:image:width" content="1200"'))
})

test('slug: sin tildes ni apóstrofos, sólo [a-z0-9-], y único dentro de cada nivel', () => {
  assert.equal(slugDePagina('Los Ríos'), 'los-rios')
  assert.equal(slugDePagina("O'Higgins"), 'ohiggins')
  assert.equal(slugDePagina('Ñuble'), 'nuble')
  assert.equal(slugDePagina('San Pedro de Atacama'), 'san-pedro-de-atacama')
  const re = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
  const comunas = man.comunas.filter((c) => c.n > 0).map((c) => slugDePagina(c.etiqueta))
  const regiones = man.regiones.map((r) => slugDePagina(r.nombre))
  for (const s of [...comunas, ...regiones]) assert.match(s, re)
  assert.equal(new Set(comunas).size, comunas.length, 'dos comunas con el mismo slug')
  assert.equal(new Set(regiones).size, regiones.length, 'dos regiones con el mismo slug')
  // Seis comunas se llaman como su región: por eso cada nivel tiene su prefijo.
  const choques = comunas.filter((s) => regiones.includes(s))
  assert.ok(choques.length >= 1, `sin comunas homónimas no haría falta el prefijo (${choques})`)
})

const resumenDe = ({ ha, n, bosques = 0, nativo = 0, plant = 0, mixto = 0 }) => ({
  ha, n,
  usos: [{ cod: '04', ha: bosques }],
  subusos: [{ cod: '0402', ha: nativo, uso: '04' }, { cod: '0401', ha: plant, uso: '04' }, { cod: '0403', ha: mixto, uso: '04' }],
})
const region = { cod: '05', nombre: 'Valparaíso', oficial: 'Región de Valparaíso', anio: '2019' }

test('frase de comuna: «La comuna de X» siempre, aunque se llame como su región', () => {
  const f = fraseComuna({ cod: '05101', etiqueta: 'Valparaíso' }, region,
    resumenDe({ ha: 30900.4, n: 1200, bosques: 5000, nativo: 3000, plant: 1900, mixto: 100 }))
  assert.ok(f.startsWith('La comuna de Valparaíso (Región de Valparaíso): '))
  assert.ok(f.includes(QUIEN) && f.endsWith(SALVEDAD))
  assert.ok(f.includes('actualización 2019'))
  assert.ok(f.includes('30.900 ha catastradas en 1.200 polígonos'))
  assert.ok(f.includes('3.000 ha de bosque nativo, 1.900 ha de plantación forestal y 100 ha de bosque mixto'))
  assert.doesNotMatch(f, /\d,\d+ ha/)
})

test('frase de comuna sin bosques: no afirma que no los haya (unidad mínima cartografiable)', () => {
  const f = fraseComuna({ cod: '13101', etiqueta: 'Santiago' }, region, resumenDe({ ha: 2310, n: 1 }))
  assert.ok(f.includes('en 1 polígono;'), 'singular')
  assert.ok(f.includes('no clasifica como bosque ningún polígono de la comuna de Santiago'))
  assert.ok(f.includes('no prueba que no los haya'))
  const sinNativo = fraseComuna({ cod: '1', etiqueta: 'X' }, region, resumenDe({ ha: 10, n: 2, bosques: 5, plant: 5 }))
  assert.ok(sinNativo.includes('no registra bosque nativo en la comuna de X'))
})

test('frase de región: la cifra oficial va con el año de SU planilla', () => {
  const oficial = { anio_actualizacion: '2015', valores: { total: 4061628.2 } }
  const f = fraseRegion({ ...region, anio: '2014' }, resumenDe({ ha: 4061628.1, n: 42025, bosques: 1, nativo: 1 }), oficial)
  assert.ok(f.startsWith('Región de Valparaíso: '))
  assert.ok(f.includes('actualización 2014 del Catastro'))
  assert.ok(f.includes('planilla de la actualización 2015, es de 4.061.628 ha'))
})

test('Umami: sin identificador no se escribe nada', () => {
  if (!UMAMI.id) assert.equal(etiquetaUmami(), '')
  else assert.match(etiquetaUmami({ autoTrack: false }), /data-auto-track="false"/)
})
