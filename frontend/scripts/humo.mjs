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
 *   1. Si recibe --huella, ESPERA a que Pages sirva lo recién construido: pide index.html y el
 *      manifest con `?humo=<run>-<i>` (una clave nueva cada vez, así Fastly no contesta desde su
 *      caché de 600 s) hasta que el sha256 de los dos coincide con el que calculó el job build.
 *      Sin esto, el humo podía aprobar el sitio de AYER.
 *   2. Comprueba portada, manifest (tiene que ser JSON), una petición de rango del .bin (206 y
 *      16 B) y el .bin entero, que tiene que medir exactamente lo que declara el manifest.
 *   3. Reintenta ante error de red, 429 y 5xx. Un 404 NO se reintenta: es una respuesta.
 *
 * Las comprobaciones son funciones puras y `fetch` se inyecta, así que --negativas monta sitios
 * rotos en memoria y exige que cada uno se ponga ROJO, sin red. Una guarda que nunca se ha visto
 * fallar no es una guarda.
 *
 * Uso:
 *   node scripts/humo.mjs --base https://sud-austral.github.io/coipo_vista_catastro [--huella H] [--run ID]
 *   node scripts/humo.mjs --huella-de dist     imprime la huella de un build (la usa el job build)
 *   node scripts/humo.mjs --negativas          sin red; sale con 1 si alguna guarda no caza su defecto
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// ------------------------------------------------------------------ comprobaciones puras

/** sha256 de index.html seguido del manifest: cambia con cualquier cambio de interfaz o de datos. */
export function huella(index, manifest) {
  return createHash('sha256').update(index).update(manifest).digest('hex')
}

/** El manifest tiene que ser JSON y declarar cuánto mide el .bin. Devuelve los bytes declarados. */
export function bytesDeclarados(texto) {
  let man
  try {
    man = JSON.parse(texto)
  } catch {
    throw new Error(`el manifest publicado no es JSON (empieza por ${JSON.stringify(texto.slice(0, 40))})`)
  }
  const bytes = man?.capas?.cbn_puntos?.bytes
  if (!Number.isInteger(bytes) || bytes <= 0) throw new Error('el manifest no declara capas.cbn_puntos.bytes')
  return bytes
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
    const clave = `humo=${run}-${i}`
    const index = await pedir(`${base}/?${clave}`, undefined, io)
    const manifest = await pedir(`${base}/datos/manifest.json?${clave}`, undefined, io)
    if (index.status === 200 && manifest.status === 200) {
      vista = huella(await bytesDe(index), await bytesDe(manifest))
      if (vista === esperada) {
        log(`--- huella ${esperada.slice(0, 12)} servida (intento ${i})`)
        return
      }
    } else {
      vista = `HTTP ${index.status}/${manifest.status}`
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
  log(`--- index.html: HTTP 200, ${(await bytesDe(index)).length} B`)

  const man = await pedir(`${base}/datos/manifest.json?${clave}`, undefined, opciones)
  if (man.status !== 200) throw new Error(`el manifest devolvió ${man.status}`)
  const declarado = bytesDeclarados(new TextDecoder().decode(await bytesDe(man)))
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
    const { status = 200, cuerpo = '' } = r
    const bytes = Buffer.from(cuerpo)
    const rango = init?.headers?.Range?.match(/^bytes=(\d+)-(\d+)$/)
    if (rango && status === 200) {
      return new Response(bytes.subarray(Number(rango[1]), Number(rango[2]) + 1), { status: 206 })
    }
    return new Response(status === 204 ? null : bytes, { status })
  }
}

const BIN = 'x'.repeat(64)
const MAN = JSON.stringify({ capas: { cbn_puntos: { bytes: BIN.length } } })
const INDEX = '<!doctype html><title>visor</title>'
const bueno = (extra = {}) => ({
  '/visor/': [{ cuerpo: INDEX }],
  '/visor/datos/manifest.json': [{ cuerpo: MAN }],
  '/visor/datos/cbn_puntos.bin': [{ cuerpo: BIN }],
  ...extra,
})
const H = huella(Buffer.from(INDEX), Buffer.from(MAN))

// [nombre, rutas, opciones extra, ¿tiene que pasar?]
const CASOS = [
  ['sitio sano', bueno(), {}, true],
  ['sitio sano, esperando su huella', bueno(), { huella: H }, true],
  ['503, 503 y luego 200: los reintentos lo absorben', bueno({
    '/visor/datos/cbn_puntos.bin': [{ status: 503 }, { status: 503 }, { cuerpo: BIN }],
  }), {}, true],
  ['un corte de red y luego 200', bueno({ '/visor/': ['red', { cuerpo: INDEX }] }), {}, true],
  ['503 permanente en el .bin', bueno({ '/visor/datos/cbn_puntos.bin': [{ status: 503 }] }), {}, false],
  ['la huella nunca coincide (Pages sirve el build viejo)', bueno(), { huella: 'f'.repeat(64) }, false],
  ['el .bin servido mide distinto de lo declarado', bueno({
    '/visor/datos/cbn_puntos.bin': [{ cuerpo: BIN.slice(1) }],
  }), {}, false],
  ['el manifest no es JSON', bueno({ '/visor/datos/manifest.json': [{ cuerpo: '<html>404</html>' }] }), {}, false],
  ['la portada da 404', bueno({ '/visor/': [{ status: 404 }] }), {}, false],
  ['el manifest no declara el tamaño', bueno({ '/visor/datos/manifest.json': [{ cuerpo: '{}' }] }), {}, false],
]

async function negativas() {
  let rotas = 0
  for (const [nombre, rutas, extra, debePasar] of CASOS) {
    let error = null
    try {
      await humo('https://ejemplo.invalid/visor', {
        fetch: sitioFalso(rutas), dormir: async () => {}, intentos: 4, intentosHuella: 3, ...extra,
      })
    } catch (e) {
      error = e
    }
    const paso = error === null
    const ok = paso === debePasar
    if (!ok) rotas++
    const veredicto = debePasar ? (paso ? 'VERDE, como debe' : 'ROJO sin motivo') : (paso ? 'VERDE: LA GUARDA NO SIRVE' : 'ROJO, como debe')
    console.log(`  ${ok ? 'ok ' : 'MAL'} ${nombre}: ${veredicto}${error && !debePasar ? ` (${error.message})` : ''}`)
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
  const dist = argumento('--huella-de')
  console.log(huella(readFileSync(join(dist, 'index.html')), readFileSync(join(dist, 'datos', 'manifest.json'))))
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

