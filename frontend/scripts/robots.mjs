/**
 * Comprueba el robots.txt de la RAÍZ del host LEYÉNDOLO COMO UN RASTREADOR.
 *
 *     node scripts/robots.mjs                 la copia de referencia, docs/robots-raiz.txt
 *     node scripts/robots.mjs --url <url>     el publicado (lo usa el humo)
 *
 * Por qué la raíz. En un sitio de proyecto de GitHub Pages ningún rastreador lee
 * /coipo_vista_catastro/robots.txt: el único que cuenta es
 * https://sud-austral.github.io/robots.txt, que es de la ORGANIZACIÓN y afecta a
 * sus 68 sitios (DECISIONES §M.2). Vive en otro repositorio; aquí se vigila.
 *
 * Lo que se exige:
 *   - los buscadores, los asistentes que citan (y sus agentes *-User), Google-Extended
 *     y las vistas previas leen la portada, las páginas, los datos y las tarjetas;
 *   - los que entrenan modelos no leen el visor;
 *   - un Sitemap absoluto que incluya el de este visor.
 *
 * SE LEE SEGÚN RFC 9309, no como `urllib.robotparser`: un bot con grupo propio
 * ignora el grupo `*` (§2.2.1), y entre las reglas que coinciden gana la de ruta MÁS
 * LARGA, con empate a favor de Allow (§2.2.2). Leyendo «la primera que coincide»,
 * `Allow: /` antes de un `Disallow` más largo lo anularía. El lector es el de
 * coipo_boton_rojo/frontend/scripts/robots.mjs, probado allí.
 *
 * PRIMERO LAS NEGATIVAS, como el resto de guardas de este directorio.
 */
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BASE, URL_PUBLICA } from '../src/web/sitio.js'

const AQUI = dirname(fileURLToPath(import.meta.url))
const REFERENCIA = resolve(AQUI, '..', '..', 'docs', 'robots-raiz.txt')

/** Los grupos del archivo: [{ agentes: ['gptbot', …], reglas: [{ permite, ruta }] }]. */
function grupos(texto) {
  const salida = []
  let actual = null
  let enReglas = false
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.replace(/#.*/, '').trim()
    const m = linea.match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
    if (!m) continue
    const [, campo, valor] = m
    const c = campo.toLowerCase()
    if (c === 'user-agent') {
      // Varias líneas User-agent seguidas forman UN grupo; una después de reglas abre otro.
      if (!actual || enReglas) {
        actual = { agentes: [], reglas: [] }
        salida.push(actual)
        enReglas = false
      }
      actual.agentes.push(valor.trim().toLowerCase())
    } else if ((c === 'allow' || c === 'disallow') && actual) {
      enReglas = true
      // `Disallow:` vacío no prohíbe nada: se omite.
      if (valor.trim()) actual.reglas.push({ permite: c === 'allow', ruta: valor.trim() })
    }
  }
  return salida
}

/** ¿La ruta del archivo coincide con la pedida? `*` es cualquier cosa y `$` ancla el final. */
function coincide(patron, ruta) {
  const ancla = patron.endsWith('$')
  const cuerpo = (ancla ? patron.slice(0, -1) : patron)
    .split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${cuerpo}${ancla ? '$' : ''}`).test(ruta)
}

/** Si `agente` puede leer `ruta` según `texto` (RFC 9309). */
export function permitido(texto, agente, ruta) {
  const todos = grupos(texto)
  const propio = todos.filter((g) => g.agentes.includes(agente.toLowerCase()))
  const aplicables = propio.length ? propio : todos.filter((g) => g.agentes.includes('*'))
  let mejor = null
  for (const r of aplicables.flatMap((g) => g.reglas)) {
    if (!coincide(r.ruta, ruta)) continue
    if (!mejor || r.ruta.length > mejor.ruta.length ||
        (r.ruta.length === mejor.ruta.length && r.permite)) mejor = r
  }
  return mejor ? mejor.permite : true
}

export const CITAN = ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot',
  'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'facebookexternalhit',
  'WhatsApp', 'Twitterbot', 'LinkedInBot', 'TelegramBot']
export const ENTRENAN = ['GPTBot', 'ClaudeBot', 'CCBot', 'Applebot-Extended', 'meta-externalagent',
  'Bytespider']
// Lo que importa de este visor: la portada, el índice, una región, una comuna, los
// datos que el visor carga para que Googlebot vea las cifras, y una tarjeta.
const RUTAS = [BASE, `${BASE}regiones/`, `${BASE}region/los-rios/`, `${BASE}comuna/valdivia/`,
  `${BASE}datos/manifest.json`, `${BASE}datos/cbn_puntos.bin`, `${BASE}tarjetas/x/comuna-valdivia.png`]
const SITEMAP = `${URL_PUBLICA}sitemap.xml`

export function problemas(texto) {
  const salida = []
  for (const a of CITAN) {
    for (const r of RUTAS) if (!permitido(texto, a, r)) salida.push(`${a} no puede leer ${r}`)
  }
  for (const a of ENTRENAN) {
    if (permitido(texto, a, BASE)) salida.push(`${a} (entrenamiento) puede leer ${BASE}`)
  }
  const mapas = [...texto.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1])
  for (const m of mapas) if (!/^https:\/\//.test(m)) salida.push(`Sitemap relativo: ${m}`)
  if (!mapas.includes(SITEMAP)) salida.push(`falta el Sitemap ${SITEMAP}`)
  return salida
}

const BUENO = `User-agent: ${ENTRENAN.join('\nUser-agent: ')}
Disallow: /

User-agent: *
Allow: /

Sitemap: ${SITEMAP}
`

const NEGATIVAS = [
  ['bloquea los datos', BUENO.replace('Allow: /\n', `Allow: /\nDisallow: ${BASE}datos/\n`)],
  ['bloquea todo', BUENO.replace('Allow: /\n', 'Disallow: /\n')],
  ['un asistente con grupo propio que lo bloquea', `User-agent: OAI-SearchBot\nDisallow: /\n\n${BUENO}`],
  ['un bot de entrenamiento sin bloquear', BUENO.replace('User-agent: GPTBot\n', '')],
  // El caso que `urllib.robotparser` lee mal: Allow: / primero no anula el Disallow más largo.
  ['un Disallow más largo después de Allow: /', BUENO.replace('Allow: /\n', `Allow: /\nDisallow: ${BASE}comuna/\n`)],
  ['Sitemap relativo', BUENO.replace(SITEMAP, `${BASE}sitemap.xml`)],
  ['sin el sitemap del visor', BUENO.replace(`Sitemap: ${SITEMAP}\n`, '')],
  ['Google-Extended bloqueado', BUENO.replace('User-agent: GPTBot\n', 'User-agent: GPTBot\nUser-agent: Google-Extended\n')],
]

/** Corre las negativas; devuelve cuántas no cazó. */
export function comprobarComprobador() {
  let fallos = 0
  for (const [nombre, texto] of NEGATIVAS) {
    if (problemas(texto).length === 0) {
      console.error(`  VERDE: no cazó «${nombre}» (el comprobador no sirve)`)
      fallos++
    }
  }
  const delBueno = problemas(BUENO)
  if (delBueno.length) {
    console.error(`  ROJO en el control positivo: ${delBueno.join(' · ')}`)
    fallos++
  }
  return fallos
}

async function principal() {
  if (comprobarComprobador()) {
    console.error('\n✗ robots: el comprobador está roto')
    process.exit(1)
  }
  const i = process.argv.indexOf('--url')
  const origen = i >= 0 ? process.argv[i + 1] : REFERENCIA
  const texto = i >= 0 ? await (await fetch(origen)).text() : await readFile(REFERENCIA, 'utf8')
  const reales = problemas(texto)
  if (reales.length) {
    console.error(`✗ robots: ${origen} no deja pasar a quien tiene que pasar`)
    for (const p of reales) console.error(`  ${p}`)
    console.error('  La política está en DECISIONES §M.2.')
    process.exit(1)
  }
  console.log(`✓ robots: ${origen}: ${CITAN.length} lectores pasan, ${ENTRENAN.length} de entrenamiento no ` +
    `(${NEGATIVAS.length} negativas rojas)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal()
