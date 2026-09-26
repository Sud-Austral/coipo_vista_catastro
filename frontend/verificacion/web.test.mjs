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
import { descripcionPortada, fraseNacional, QUIEN, SALVEDAD } from '../src/web/textos.js'
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

test('Umami: sin identificador no se escribe nada', () => {
  if (!UMAMI.id) assert.equal(etiquetaUmami(), '')
  else assert.match(etiquetaUmami({ autoTrack: false }), /data-auto-track="false"/)
})
