/**
 * La prueba de humo sobre el sitio PUBLICADO: lo único del CI que mira lo que recibe una persona.
 *
 * Por qué dejó de ser un bloque de curl en deploy.yml. El despliegue del 2026-09-03 (corrida
 * 33760242075) quedó en rojo con el sitio bien publicado: la petición de rango del .bin tardó
 * 60 s y devolvió un 503 de Pages un minuto después de publicar, y el bloque no reintentaba. Un
 * rojo que no es un fallo enseña a ignorar los rojos. Además `curl … | head -c 200` cortaba la
 * tubería y dejaba un «curl: (23)» que parecía un error y no lo era.
 *
 * Qué hace:
 *   1. Si recibe --huella, ESPERA a que Pages sirva lo recién construido: pide web/huella.txt
 *      con `?humo=<run>-<i>` (una clave nueva cada vez, así Fastly no contesta desde su caché de
 *      600 s) hasta que dice la huella que calculó el job build. La huella es el sha256 de TODO
 *      lo publicado (cada archivo de dist/ con su ruta): con sólo index.html y el manifest, un
 *      cambio que tocara únicamente las páginas o las tarjetas daba la huella de ayer, y el humo
 *      aprobaba el sitio de AYER (hallazgo de la revisión del 2026-09-26).
 *   2. Comprueba portada, manifest (tiene que ser JSON), una petición de rango del .bin (206 y
 *      16 B) y el .bin entero, que tiene que medir exactamente lo que declara el manifest.
 *   3. Reintenta ante error de red, 429 y 5xx. Un 404 NO se reintenta: es una respuesta.
 *
 * Y desde que hay páginas por región y comuna (DECISIONES §M.9):
 *   4. el sitemap publicado tiene exactamente 2 + regiones + comunas URL (la cuenta sale del
 *      manifest publicado, nunca escrita aquí), y una muestra de ellas responde 200 text/html;
 *   5. una página pedida sin la barra final responde 301 (lo hace Pages);
 *   5b. la og:image de la portada y la de una página de la muestra: 200 image/png;
 *   6. el robots.txt de la RAÍZ del host, que es de la organización: si no existe, AVISO
 *      (ABIERTO, §M.2); si existe, se lee con RFC 9309 y un lector que cita bloqueado es ROJO.
 *
 * Las comprobaciones son funciones puras y `fetch` se inyecta, así que --negativas monta sitios
 * rotos en memoria y exige que cada uno se ponga ROJO, sin red. Una guarda que nunca se ha visto
 * fallar no es una guarda.
 *
 * Uso:
 *   node scripts/humo.mjs --base https://sud-austral.github.io/coipo_vista_catastro [--huella H] [--run ID]
 *   node scripts/humo.mjs --huella-de dist     calcula la huella de un build, la ESCRIBE en
 *                                              dist/web/huella.txt y la imprime (job build)
 *   node scripts/humo.mjs --negativas          sin red; sale con 1 si alguna guarda no caza su defecto
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { problemas as problemasRobots } from './robots.mjs'
import { UMAMI } from '../src/web/sitio.js'

// ------------------------------------------------------------------ comprobaciones puras

/** Dónde se publica la huella del build, dentro del sitio. */
export const ARCHIVO_HUELLA = 'web/huella.txt'

/**
 * sha256 de TODO lo publicado: cada archivo de `dir`, por su ruta relativa (con «/» y en
 * orden), y sus bytes; salvo el propio archivo de la huella. Cambia con cualquier cambio de
 * la app, los datos, las páginas, las tarjetas o la hoja de estilos.
 */
export function huellaDeDist(dir) {
  const rutas = []
  const recorrer = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) recorrer(join(d, e.name), r)
      else if (r !== ARCHIVO_HUELLA) rutas.push(r)
    }
  }
  recorrer(dir, '')
  rutas.sort()
  const h = createHash('sha256')
  for (const r of rutas) h.update(r).update('\0').update(readFileSync(join(dir, r))).update('\0')
  return h.digest('hex')
}

/** El manifest tiene que ser JSON y declarar cuánto mide el .bin. Devuelve { man, bytes }. */
export function leerManifestPublicado(texto) {
  let man
  try {
    man = JSON.parse(texto)
  } catch {
    throw new Error(`el manifest publicado no es JSON (empieza por ${JSON.stringify(texto.slice(0, 40))})`)
  }
  const bytes = man?.capas?.cbn_puntos?.bytes
  if (!Number.isInteger(bytes) || bytes <= 0) throw new Error('el manifest no declara capas.cbn_puntos.bytes')
  return { man, bytes }
}

/** Cuántas URL tiene que tener el sitemap: portada, índice, cada región y cada comuna con polígonos. */
export const urlsEsperadas = (man) =>
  2 + (man.regiones?.length ?? 0) + (man.comunas ?? []).filter((c) => c.n > 0).length

/** La og:image de un HTML, o null. */
export const imagenDe = (html) => html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null

/** Cinco URL repartidas a lo largo del sitemap, más el índice: una muestra, y siempre la misma. */
export function muestra(locs) {
  const idx = new Set([1, ...[0.2, 0.4, 0.6, 0.8, 1].map((f) => Math.round(f * (locs.length - 1)))])
  return [...idx].filter((i) => i < locs.length).map((i) => locs[i])
}

/** Una petición de rango 0-15 tiene que volver 206 con exactamente 16 bytes. */
export function revisarRango(status, largo) {
  if (status !== 206) throw new Error(`la petición de rango del .bin devolvió ${status}, no 206`)
  if (largo !== 16) throw new Error(`la petición de rango del .bin trajo ${largo} B, no 16`)
}

export function revisarTamano(declarado, servido) {
  if (declarado !== servido) throw new Error(`el .bin servido mide ${servido} B y el manifest declara ${declarado}`)
}

// ------------------------------------------------------------------------------- E/S

const reintentable = (status) => status === 429 || status >= 500

/**
 * fetch con reintentos. Devuelve la respuesta (también un 404: eso ya es una respuesta, y quien
 * llama decide). Lanza sólo si agota los intentos con errores de red o 429/5xx.
 */
export async function pedir(url, init, { fetch, dormir, intentos = 8, espera = 15_000, log = () => {} }) {
  let ultimo = ''
  for (let i = 1; i <= intentos; i++) {
    try {
      const r = await fetch(url, init)
      if (!reintentable(r.status)) return r
      ultimo = `HTTP ${r.status}`
    } catch (e) {
      ultimo = e?.cause?.code ?? e?.message ?? String(e)
    }
    if (i < intentos) {
      log(`  ${ultimo} en ${url}; reintento ${i}/${intentos - 1} en ${espera / 1000} s`)
      await dormir(espera)
    }
  }
  throw new Error(`${url}: ${ultimo} tras ${intentos} intentos`)
}

async function bytesDe(r) {
  return Buffer.from(await r.arrayBuffer())
}

/** Espera a que Pages sirva el build cuya huella se pasa. */
async function esperarHuella(base, esperada, run, io) {
  const { intentosHuella = 30, cada = 20_000, dormir, log } = io
  let vista = ''
  for (let i = 1; i <= intentosHuella; i++) {
    const r = await pedir(`${base}/${ARCHIVO_HUELLA}?humo=${run}-${i}`, undefined, io)
    if (r.status === 200) {
      vista = (await r.text()).trim()
      if (vista === esperada) {
        log(`--- huella ${esperada.slice(0, 12)} servida (intento ${i})`)
        return
      }
    } else {
      vista = `HTTP ${r.status}`
    }
    if (i < intentosHuella) await dormir(cada)
  }
  throw new Error(`Pages sigue sin servir el build ${esperada.slice(0, 12)} (lo último visto: ${vista.slice(0, 12)})`)
}

/** El humo completo. Lanza en el primer fallo. */
export async function humo(base, { huella: esperada, run = 'local', ...io }) {
  const log = io.log ?? (() => {})
  const opciones = { ...io, log }
  if (esperada) await esperarHuella(base, esperada, run, opciones)

  const clave = `humo=${run}`
  const index = await pedir(`${base}/?${clave}`, undefined, opciones)
  if (index.status !== 200) throw new Error(`la portada devolvió ${index.status}`)
  const htmlPortada = new TextDecoder().decode(await bytesDe(index))
  log(`--- index.html: HTTP 200, ${Buffer.byteLength(htmlPortada)} B`)

  const rm = await pedir(`${base}/datos/manifest.json?${clave}`, undefined, opciones)
  if (rm.status !== 200) throw new Error(`el manifest devolvió ${rm.status}`)
  const { man, bytes: declarado } = leerManifestPublicado(new TextDecoder().decode(await bytesDe(rm)))
  log(`--- manifest.json: JSON válido, declara ${declarado} B para el .bin`)

  // Accept-Encoding: identity OBLIGATORIO. Pages comprime application/octet-stream, y sin esto
  // se miden bytes gzip donde se esperan datos y se diagnostica el problema equivocado.
  const bin = `${base}/datos/cbn_puntos.bin?${clave}`
  const identidad = { 'Accept-Encoding': 'identity' }
  const rango = await pedir(bin, { headers: { ...identidad, Range: 'bytes=0-15' } }, opciones)
  revisarRango(rango.status, (await bytesDe(rango)).length)
  log('--- cbn_puntos.bin: rango 0-15 → 206, 16 B')

  const entero = await pedir(bin, { headers: identidad }, opciones)
  if (entero.status !== 200) throw new Error(`el .bin devolvió ${entero.status}`)
  revisarTamano(declarado, (await bytesDe(entero)).length)
  log(`--- cbn_puntos.bin: servido ${declarado} B = declarado`)

  // El identificador se inyecta: las negativas no pueden depender del de sitio.js.
  revisarUmami(htmlPortada, 'umamiId' in io ? io.umamiId : UMAMI.id)
  await revisarImagen(imagenDe(htmlPortada), 'la portada', clave, opciones)
  await revisarPaginas(base, man, clave, opciones)
  await revisarRobotsRaiz(base, opciones)
}

/**
 * Umami en la portada publicada (DECISIONES §M.11): sin identificador, ninguna etiqueta;
 * con él, una sola y con el rastreo automático apagado, o cada paneo sería una visita.
 */
export function revisarUmami(html, id = UMAMI.id) {
  const n = (html.match(/conaf\.js/g) ?? []).length
  if (!id && n) throw new Error('la portada publicada trae Umami y el sitio no tiene identificador')
  if (id && n !== 1) throw new Error(`la portada publicada trae ${n} etiquetas de Umami; tiene que ser una`)
  if (id && !html.includes('data-auto-track="false"')) throw new Error('Umami con rastreo automático en la app')
}

/** Una og:image tiene que servirse como PNG: si no, la vista previa sale sin tarjeta. */
async function revisarImagen(url, de, clave, opciones) {
  if (!url) throw new Error(`${de} no declara og:image`)
  const r = await pedir(`${url}${url.includes('?') ? '&' : '?'}${clave}`, undefined, opciones)
  const tipo = r.headers.get('content-type') ?? ''
  if (r.status !== 200 || !tipo.startsWith('image/png')) throw new Error(`la og:image de ${de} (${url}) devolvió ${r.status} ${tipo}`)
  opciones.log(`--- og:image de ${de}: 200 image/png`)
}

/** Las páginas por región y comuna: el sitemap entero y una muestra servida. */
async function revisarPaginas(base, man, clave, opciones) {
  const { log } = opciones
  const rs = await pedir(`${base}/sitemap.xml?${clave}`, undefined, opciones)
  if (rs.status !== 200) throw new Error(`el sitemap devolvió ${rs.status}`)
  const locs = [...(await rs.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  const esperadas = urlsEsperadas(man)
  if (locs.length !== esperadas) throw new Error(`el sitemap tiene ${locs.length} URL y el manifest pide ${esperadas}`)
  let conImagen = null
  for (const u of muestra(locs)) {
    const r = await pedir(`${u}?${clave}`, undefined, opciones)
    const tipo = r.headers.get('content-type') ?? ''
    if (r.status !== 200 || !tipo.startsWith('text/html')) throw new Error(`${u} devolvió ${r.status} ${tipo}`)
    const html = await r.text()
    if (u.includes('/comuna/') || u.includes('/region/')) conImagen ??= [u, imagenDe(html)]
  }
  if (conImagen) await revisarImagen(conImagen[1], conImagen[0], clave, opciones)
  log(`--- sitemap.xml: ${locs.length} URL (= manifest); muestra de ${muestra(locs).length} en 200 text/html`)

  const ri = await pedir(`${base}/web/indice.json?${clave}`, undefined, opciones)
  if (ri.status !== 200) throw new Error(`web/indice.json devolvió ${ri.status}`)
  const indice = JSON.parse(await ri.text())
  const slug = Object.values(indice.comunas ?? {})[0]
  const sin = await pedir(`${base}/comuna/${slug}`, { redirect: 'manual' }, opciones)
  if (sin.status !== 301) throw new Error(`/comuna/${slug} sin barra final devolvió ${sin.status}, no 301`)
  log(`--- /comuna/${slug} sin barra: 301`)
}

/**
 * El robots.txt de la raíz del host. Es de la organización (DECISIONES §M.2): si no existe,
 * AVISO y no rojo, porque crearlo no es de este repositorio; si existe, tiene que dejar pasar
 * a quien cita y cerrar el paso a quien entrena.
 */
async function revisarRobotsRaiz(base, opciones) {
  const { log } = opciones
  const url = `${new URL(base).origin}/robots.txt`
  const r = await pedir(url, undefined, opciones)
  if (r.status === 404) {
    log(`::warning::${url} no existe: todo bot, incluidos los de entrenamiento, puede leer el visor (ABIERTO, DECISIONES §M.2)`)
    return
  }
  if (r.status !== 200) throw new Error(`${url} devolvió ${r.status}`)
  const p = problemasRobots(await r.text())
  if (p.length) throw new Error(`${url}: ${p[0]}${p.length > 1 ? ` (y ${p.length - 1} más)` : ''}`)
  log(`--- ${url}: los que citan pasan, los de entrenamiento no`)
}

// ------------------------------------------------------------------------ negativas

/**
 * Un sitio falso en memoria. `rutas` asocia un path (sin query) a una lista de respuestas: se
 * entregan en orden y la última se repite, así «503, 503, 200» se escribe tal cual.
 */
function sitioFalso(rutas) {
  const visitas = new Map()
  return async (url, init) => {
    const { pathname } = new URL(url)
    const lista = rutas[pathname]
    if (!lista) return new Response('no existe', { status: 404 })
    const n = visitas.get(pathname) ?? 0
    visitas.set(pathname, n + 1)
    const r = lista[Math.min(n, lista.length - 1)]
    if (r === 'red') throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })
    const { status = 200, cuerpo = '', tipo = 'text/html; charset=utf-8', a } = r
    if (a && init?.redirect === 'manual') return new Response(null, { status, headers: { Location: a } })
    const bytes = Buffer.from(cuerpo)
    const rango = init?.headers?.Range?.match(/^bytes=(\d+)-(\d+)$/)
    if (rango && status === 200) {
      return new Response(bytes.subarray(Number(rango[1]), Number(rango[2]) + 1), { status: 206 })
    }
    return new Response(status === 204 || status === 404 ? cuerpo || null : bytes, { status, headers: { 'Content-Type': tipo } })
  }
}

const BIN = 'x'.repeat(64)
const MAN = JSON.stringify({
  capas: { cbn_puntos: { bytes: BIN.length } },
  regiones: [{ cod: '14', nombre: 'Los Ríos' }],
  comunas: [{ cod: '14101', etiqueta: 'Valdivia', n: 5 }, { cod: '14999', etiqueta: 'Vacía', n: 0 }],
})
const B = 'https://ejemplo.invalid/visor'
const INDEX = `<!doctype html><title>visor</title><meta property="og:image" content="${B}/og.png" />`
const PAGINA = `<!doctype html><title>p</title><meta property="og:image" content="${B}/tarjetas/s/comuna-valdivia.png" />`
const PNG = '\x89PNG'
const LOCS = [`${B}/`, `${B}/regiones/`, `${B}/region/los-rios/`, `${B}/comuna/valdivia/`]
const SITEMAP = LOCS.map((u) => `<url><loc>${u}</loc></url>`).join('\n')
const ROBOTS = `User-agent: GPTBot\nUser-agent: ClaudeBot\nUser-agent: CCBot\nUser-agent: Applebot-Extended
User-agent: meta-externalagent\nUser-agent: Bytespider\nDisallow: /\n\nUser-agent: *\nAllow: /
Sitemap: https://sud-austral.github.io/coipo_vista_catastro/sitemap.xml\n`
const bueno = (extra = {}) => ({
  '/visor/': [{ cuerpo: INDEX }],
  '/visor/datos/manifest.json': [{ cuerpo: MAN, tipo: 'application/json' }],
  '/visor/datos/cbn_puntos.bin': [{ cuerpo: BIN, tipo: 'application/octet-stream' }],
  '/visor/sitemap.xml': [{ cuerpo: SITEMAP, tipo: 'application/xml' }],
  '/visor/regiones/': [{ cuerpo: INDEX }],
  '/visor/region/los-rios/': [{ cuerpo: PAGINA }],
  '/visor/comuna/valdivia/': [{ cuerpo: PAGINA }],
  '/visor/og.png': [{ cuerpo: PNG, tipo: 'image/png' }],
  '/visor/tarjetas/s/comuna-valdivia.png': [{ cuerpo: PNG, tipo: 'image/png' }],
  '/visor/comuna/valdivia': [{ status: 301, a: `${B}/comuna/valdivia/` }],
  '/visor/web/indice.json': [{ cuerpo: JSON.stringify({ esquema: 1, regiones: { 14: 'los-rios' }, comunas: { 14101: 'valdivia' } }), tipo: 'application/json' }],
  '/robots.txt': [{ cuerpo: ROBOTS, tipo: 'text/plain' }],
  '/visor/web/huella.txt': [{ cuerpo: `${H}\n`, tipo: 'text/plain' }],
  ...extra,
})
const H = 'a'.repeat(64)

const CON_UMAMI = (extra) => `${INDEX}<script defer src="https://prueba5.conaf.cl/conaf.js" data-website-id="x"${extra}></script>`

// [nombre, rutas, opciones extra, true si tiene que pasar o el trozo del error que TIENE que
// salir: que un caso roto caiga por otra regla no prueba la suya]
const CASOS = [
  ['sitio sano', bueno(), {}, true],
  ['sitio sano, esperando su huella', bueno(), { huella: H }, true],
  ['503, 503 y luego 200: los reintentos lo absorben', bueno({
    '/visor/datos/cbn_puntos.bin': [{ status: 503 }, { status: 503 }, { cuerpo: BIN }],
  }), {}, true],
  ['un corte de red y luego 200', bueno({ '/visor/': ['red', { cuerpo: INDEX }] }), {}, true],
  ['503 permanente en el .bin', bueno({ '/visor/datos/cbn_puntos.bin': [{ status: 503 }] }), {}, 'HTTP 503 tras'],
  ['la huella nunca coincide (Pages sirve el build viejo)', bueno(), { huella: 'f'.repeat(64) }, 'sigue sin servir'],
  ['sin archivo de huella publicado', bueno({ '/visor/web/huella.txt': [{ status: 404 }] }), { huella: H }, 'HTTP 404'],
  ['el .bin servido mide distinto de lo declarado', bueno({
    '/visor/datos/cbn_puntos.bin': [{ cuerpo: BIN.slice(1) }],
  }), {}, 'el .bin servido mide'],
  ['el manifest no es JSON', bueno({ '/visor/datos/manifest.json': [{ cuerpo: '<html>404</html>' }] }), {}, 'no es JSON'],
  ['la portada da 404', bueno({ '/visor/': [{ status: 404 }] }), {}, 'la portada devolvió 404'],
  ['el manifest no declara el tamaño', bueno({ '/visor/datos/manifest.json': [{ cuerpo: '{}' }] }), {}, 'no declara capas'],
  ['la og:image de la portada no existe', bueno({ '/visor/og.png': [{ status: 404 }] }), {}, 'og:image de la portada'],
  ['la tarjeta de una página no existe', bueno({ '/visor/tarjetas/s/comuna-valdivia.png': [{ status: 404 }] }), {}, 'comuna-valdivia.png'],
  ['Umami en la portada sin identificador', bueno({ '/visor/': [{ cuerpo: CON_UMAMI('') }] }), { umamiId: '' }, 'no tiene identificador'],
  ['Umami con identificador y rastreo automático apagado', bueno({ '/visor/': [{ cuerpo: CON_UMAMI(' data-auto-track="false"') }] }), { umamiId: 'x' }, true],
  ['Umami con identificador y rastreo automático', bueno({ '/visor/': [{ cuerpo: CON_UMAMI('') }] }), { umamiId: 'x' }, 'rastreo automático'],
  ['Umami con identificador y sin etiqueta', bueno(), { umamiId: 'x' }, '0 etiquetas'],
  ['sin robots.txt en la raíz: aviso, no rojo', bueno({ '/robots.txt': [{ status: 404 }] }), {}, true],
  ['al sitemap le falta una comuna', bueno({ '/visor/sitemap.xml': [{ cuerpo: SITEMAP.replace(/<url><loc>[^<]*valdivia[^<]*<\/loc><\/url>/, '') }] }), {}, 'el sitemap tiene 3 URL'],
  ['una página del sitemap da 404', bueno({ '/visor/comuna/valdivia/': [{ status: 404 }] }), {}, 'devolvió 404 text/html'],
  ['sin barra final no redirige', bueno({ '/visor/comuna/valdivia': [{ cuerpo: INDEX }] }), {}, 'no 301'],
  ['el robots.txt raíz bloquea a un asistente', bueno({ '/robots.txt': [{ cuerpo: `User-agent: OAI-SearchBot\nDisallow: /\n\n${ROBOTS}`, tipo: 'text/plain' }] }), {}, 'OAI-SearchBot no puede leer'],
  ['el robots.txt raíz deja entrenar', bueno({ '/robots.txt': [{ cuerpo: ROBOTS.replace('User-agent: GPTBot\n', ''), tipo: 'text/plain' }] }), {}, 'GPTBot (entrenamiento)'],
]

async function negativas() {
  let rotas = 0
  for (const [nombre, rutas, extra, esperado] of CASOS) {
    let error = null
    try {
      await humo(B, {
        fetch: sitioFalso(rutas), dormir: async () => {}, intentos: 4, intentosHuella: 3, umamiId: '', ...extra,
      })
    } catch (e) {
      error = e
    }
    const debePasar = esperado === true
    const paso = error === null
    const porSuRegla = !debePasar && !paso && error.message.includes(esperado)
    const ok = debePasar ? paso : porSuRegla
    if (!ok) rotas++
    const veredicto = debePasar
      ? (paso ? 'VERDE, como debe' : `ROJO sin motivo (${error.message})`)
      : paso ? 'VERDE: LA GUARDA NO SIRVE'
        : porSuRegla ? `ROJO, como debe (${error.message})` : `ROJO POR OTRA REGLA (${error.message})`
    console.log(`  ${ok ? 'ok ' : 'MAL'} ${nombre}: ${veredicto}`)
  }
  if (rotas) {
    console.log(`\n${rotas} caso(s) mal: el humo no distingue un sitio roto de uno sano.`)
    process.exit(1)
  }
  console.log(`\n${CASOS.length} casos: el humo aprueba lo sano y caza cada defecto.`)
}

// ------------------------------------------------------------------------------ CLI

function argumento(nombre) {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? process.argv[i + 1] : undefined
}

// Sólo como programa: importar este módulo (para reutilizar `huella` o las comprobaciones) no
// puede ejecutar el CLI. Pasó: un `import` desde `node -e` leía los argv de otro proceso.
const comoPrograma = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (!comoPrograma) {
  // importado: nada que hacer
} else if (process.argv.includes('--negativas')) {
  await negativas()
} else if (argumento('--huella-de')) {
  // Se escribe DENTRO del sitio, para que el humo la pida publicada; y se imprime, para el
  // `outputs.huella` del job build. Va al final del build: después de páginas y tarjetas.
  const dist = argumento('--huella-de')
  const h = huellaDeDist(dist)
  const destino = join(dist, ...ARCHIVO_HUELLA.split('/'))
  mkdirSync(join(destino, '..'), { recursive: true })
  writeFileSync(`${destino}.tmp`, `${h}\n`, 'utf8')
  renameSync(`${destino}.tmp`, destino)
  console.log(h)
} else if (argumento('--base')) {
  const base = argumento('--base').replace(/\/$/, '')
  try {
    await humo(base, {
      huella: argumento('--huella'),
      run: argumento('--run') ?? 'local',
      fetch: globalThis.fetch,
      dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
      log: (m) => console.log(m),
    })
    console.log('humo OK')
  } catch (e) {
    console.log(`FALLA: ${e.message}`)
    process.exit(1)
  }
} else {
  console.log('uso: humo.mjs --base URL [--huella H] [--run ID] | --huella-de DIST | --negativas')
  process.exit(2)
}

