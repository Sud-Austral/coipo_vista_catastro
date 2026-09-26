/**
 * Guarda de `npm run build` (postbuild): lo que se hornea en dist/index.html es lo
 * que leen los asistentes de IA, las vistas previas y Googlebot antes de ejecutar
 * nada. Si esto sale mal no falla ningún test de la app, porque la app lo borra al
 * montar: por eso se comprueba el ARTEFACTO.
 *
 * Qué exige (cada regla con su negativa abajo):
 *   - #root con la portada: un solo <h1>, «Qué es» (#que-es), la frase citable
 *     ([data-frase]) con las cifras nacionales RECALCULADAS AQUÍ desde el manifest
 *     publicado y por otro camino, y el aviso #arranque-lento;
 *   - que no vuelva #arranque, la capa position:fixed que tapaba #root (ocultación);
 *   - ninguna clase que el arnés use para saber que la app montó;
 *   - todo asset con ruta absoluta y existente en dist/;
 *   - un solo canonical, https y = URL_PUBLICA; og:url = canonical + ?v=<12 hex>;
 *     og:title = <title>; description = og:description; og:image, si está, existe;
 *   - ninguna marca del prerender sin reemplazar;
 *   - los tokens de public/paginas.css iguales a los de src/index.css;
 *   - Umami: sin identificador, ninguna etiqueta; con él, una sola y sin autotrack.
 *
 * PRIMERO LAS NEGATIVAS: altera el HTML real de una forma conocida y exige que cada
 * alteración produzca un problema. Si alguna pasa, el validador está roto y sale 1
 * antes de mirar nada. Una guarda que nunca se ha visto fallar no es una guarda.
 *
 * Uso: node scripts/validar-html.mjs     (lo corre npm después de `npm run build`)
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { leerManifest } from './datos-node.mjs'
import { BASE, UMAMI, URL_PUBLICA } from '../src/web/sitio.js'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(RAIZ, 'dist')

// Lo que el arnés de navegador toma por «la app montó». El HTML horneado no puede
// traerlo o haría pasar aserciones antes de tiempo.
const CLASES_DE_LA_APP = ['app', 'grupo-filtro', 'cifra-num', 'seccion', 'descargando', 'mapa',
  'panel', 'modal-filtro', 'ficha']
const PREFIJOS_DE_LA_APP = ['gf-', 'leaflet-']

// Miles con punto, SIN Intl: otro camino que el de formato.js.
const miles = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const desescapar = (s) => s.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')

/** (ancho, alto) de la cabecera IHDR de un PNG, o null si no es un PNG. */
export function medidasPng(bytes) {
  const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!bytes || bytes.length < 24 || firma.some((b, i) => bytes[i] !== b)) return null
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

/** Lo que exige WhatsApp de una vista previa: 1200×630 y menos de 300 kB (guía §8.1). */
export function problemaPng(bytes, nombre) {
  const m = medidasPng(bytes)
  if (!m) return `${nombre} no es un PNG`
  if (m[0] !== 1200 || m[1] !== 630) return `${nombre} mide ${m[0]}×${m[1]} y no 1200×630`
  if (bytes.length >= 300_000) return `${nombre} pesa ${bytes.length} B: WhatsApp descarta desde 300.000`
  return null
}

export function raiz(html) {
  const i = html.indexOf('<div id="root">')
  if (i < 0) return null
  const fin = html.indexOf('</body>', i)
  return html.slice(i + '<div id="root">'.length, fin < 0 ? undefined : fin)
}

const cabeza = (html) => html.slice(0, Math.max(0, html.indexOf('</head>')))
const metas = (html, atr, nombre) =>
  [...cabeza(html).matchAll(new RegExp(`<meta ${atr}="${nombre}" content="([^"]*)"`, 'g'))].map((m) => desescapar(m[1]))

/** Variables de :root, claro y oscuro, de una hoja de estilos. */
export function tokens(css) {
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const bloques = [...sinComentarios.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1])
  const oscuro = sinComentarios.indexOf('prefers-color-scheme: dark')
  const salida = {}
  for (const m of sinComentarios.matchAll(/:root\s*\{([^}]*)\}/g)) {
    const modo = oscuro >= 0 && m.index > oscuro ? 'oscuro' : 'claro'
    for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) salida[`${modo} ${d[1]}`] = d[2].trim()
  }
  return bloques.length ? salida : {}
}

/**
 * Los problemas del HTML horneado. `ctx`: { manifest, existe(rutaEnDist), indexCss,
 * paginasCss }. Devuelve una lista de textos; vacía es que está bien.
 */
export function problemas(html, { manifest, existe, leer, indexCss, paginasCss }) {
  const p = []
  const r = raiz(html)
  if (r == null) return ['no hay <div id="root">']
  if (!r.trim() || r.trimStart().startsWith('</div>')) p.push('#root vacío: la portada no se horneó')

  const h1 = (r.match(/<h1[\s>]/g) ?? []).length
  if (h1 !== 1) p.push(`#root tiene ${h1} <h1> y tiene que tener uno`)
  if (!r.includes('id="que-es"')) p.push('#root sin la sección «Qué es» (#que-es)')
  if (!r.includes('id="arranque-lento"')) p.push('#root sin el aviso #arranque-lento')
  if (html.includes('id="arranque"')) p.push('volvió #arranque: una capa encima de #root es texto que ven los robots y no las personas')

  const frase = r.match(/<p[^>]*data-frase[^>]*>([\s\S]*?)<\/p>/)?.[1]
  if (!frase) {
    p.push('#root sin la frase citable ([data-frase])')
  } else {
    const nativo = manifest.subusos.find((s) => s.cod === '0402')?.ha ?? 0
    const esperadas = [
      ['polígonos', miles(manifest.total.filas)],
      ['hectáreas del país', `${miles(Math.round(manifest.total.ha))} ha`],
      ['bosque nativo', `${miles(Math.round(nativo))} ha de bosque nativo`],
    ]
    for (const [que, cifra] of esperadas) {
      if (!frase.includes(cifra)) p.push(`la frase citable no dice ${que} = ${cifra}`)
    }
    if (!frase.includes('publicado por CONAF')) p.push('la frase citable no dice quién la publica')
    if (!frase.includes('pueden diferir levemente de las oficiales')) p.push('la frase citable no trae la salvedad')
  }

  for (const m of r.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/).filter(Boolean)) {
      if (CLASES_DE_LA_APP.includes(c) || PREFIJOS_DE_LA_APP.some((x) => c.startsWith(x))) {
        p.push(`#root usa la clase «${c}», que el arnés toma por la app montada`)
      }
    }
  }

  // Assets: src= en todo el documento y los <link> que se descargan.
  const refs = [
    ...[...html.matchAll(/\ssrc="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link\s[^>]*rel="(?:stylesheet|icon|apple-touch-icon|modulepreload|preload)"[^>]*>/g)]
      .map((m) => m[0].match(/href="([^"]+)"/)?.[1]).filter(Boolean),
  ]
  for (const ref of refs) {
    let enDist
    if (ref.startsWith(URL_PUBLICA)) enDist = ref.slice(URL_PUBLICA.length)
    else if (/^https?:\/\//.test(ref)) continue // de terceros: no es nuestro
    else if (ref.startsWith(BASE)) enDist = ref.slice(BASE.length)
    else if (ref.startsWith('/')) {
      p.push(`«${ref}» no está bajo ${BASE}: en Pages pediría la raíz del dominio`)
      continue
    } else {
      p.push(`ruta relativa «${ref}»: desde una página anidada pediría otra cosa`)
      continue
    }
    if (!existe(decodeURIComponent(enDist.split(/[?#]/)[0]))) p.push(`«${ref}» no existe en dist/`)
  }

  const canon = [...cabeza(html).matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1])
  if (canon.length !== 1) p.push(`${canon.length} canonical; tiene que haber uno`)
  else if (canon[0] !== URL_PUBLICA) p.push(`canonical «${canon[0]}» ≠ ${URL_PUBLICA}`)
  const ogUrl = metas(html, 'property', 'og:url')
  if (ogUrl.length !== 1 || !new RegExp(`^${URL_PUBLICA.replaceAll('.', '\\.')}\\?v=[0-9a-f]{12}$`).test(ogUrl[0])) {
    p.push(`og:url «${ogUrl.join(' | ')}» no es el canonical con ?v=<12 hex>`)
  }
  const titulo = desescapar(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '')
  const ogTitle = metas(html, 'property', 'og:title')
  if (ogTitle.length !== 1 || ogTitle[0] !== titulo) p.push(`og:title «${ogTitle.join(' | ')}» ≠ <title> «${titulo}»`)
  const desc = metas(html, 'name', 'description')
  const ogDesc = metas(html, 'property', 'og:description')
  if (desc.length !== 1 || ogDesc.length !== 1 || desc[0] !== ogDesc[0]) {
    p.push('la meta description y og:description no son una sola y la misma')
  }
  const ogImg = metas(html, 'property', 'og:image')
  if (ogImg.length) {
    const img = ogImg[0]
    if (!img.startsWith(URL_PUBLICA)) p.push(`og:image «${img}» no es absoluta bajo ${URL_PUBLICA}`)
    else if (!existe(img.slice(URL_PUBLICA.length))) p.push(`og:image «${img}» no existe en dist/`)
    else {
      const malo = problemaPng(leer(img.slice(URL_PUBLICA.length)), 'og:image')
      if (malo) p.push(malo)
    }
    if (metas(html, 'name', 'twitter:card')[0] !== 'summary_large_image') p.push('con og:image la tarjeta tiene que ser summary_large_image')
  } else if (metas(html, 'name', 'twitter:card')[0] !== 'summary') {
    p.push('sin og:image la tarjeta tiene que ser twitter:card=summary')
  }
  if (html.includes('<!--cabeza-->')) p.push('la marca <!--cabeza--> quedó sin reemplazar')
  if (html.includes('<div id="root"></div>')) p.push('#root quedó sin hornear')

  const tIndex = tokens(indexCss)
  for (const [k, v] of Object.entries(tokens(paginasCss))) {
    if (tIndex[k] !== v) p.push(`paginas.css ${k} = ${v} y index.css dice ${tIndex[k] ?? '(nada)'}`)
  }

  const umami = (html.match(/conaf\.js/g) ?? []).length
  if (!UMAMI.id && umami) p.push('hay una etiqueta de Umami y el sitio no tiene identificador')
  if (UMAMI.id) {
    if (umami !== 1) p.push(`${umami} etiquetas de Umami; tiene que haber una`)
    else if (!cabeza(html).includes(`data-website-id="${UMAMI.id}"`)) p.push('la etiqueta de Umami no está en <head> con su identificador')
    else if (!cabeza(html).includes('data-auto-track="false"')) p.push('Umami con autotrack en la app: contaría una visita por cada paneo')
  }
  return p
}

// ------------------------------------------------------------------ negativas

/** [nombre, alterar(html, ctx) -> [html, ctx]] — cada una tiene que dar al menos un problema. */
function negativas(html, ctx) {
  const reemplazo = (de, a) => (h) => {
    if (!h.includes(de)) throw new Error(`la negativa no encaja: no aparece ${JSON.stringify(de.slice(0, 50))}`)
    return h.replace(de, a)
  }
  const frase = html.match(/<p[^>]*data-frase[^>]*>[\s\S]*?<\/p>/)?.[0] ?? ''
  const total = `${miles(Math.round(ctx.manifest.total.ha))} ha`
  const canon = html.match(/<link rel="canonical"[^>]*>/)?.[0] ?? ''
  const banner = html.match(/src="(\/coipo_vista_catastro\/assets\/banner[^"]+)"/)?.[1] ?? ''
  const soloHtml = (f) => (h, c) => [f(h), c]
  return [
    ['#root vacío', soloHtml((h) => h.replace(/<div id="root">[\s\S]*<\/body>/, '<div id="root"></div></body>'))],
    ['sin <h1>', soloHtml(reemplazo('<h1', '<p'))],
    ['sin «Qué es»', soloHtml(reemplazo('id="que-es"', 'id="otra"'))],
    ['sin #arranque-lento', soloHtml(reemplazo('id="arranque-lento"', 'id="x"'))],
    ['vuelve #arranque', soloHtml(reemplazo('<body>', '<body><div id="arranque"></div>'))],
    ['la frase cita otro total', soloHtml(reemplazo(frase, frase.replace(total, '1 ha')))],
    ['la frase sin la salvedad', soloHtml(reemplazo(frase, frase.replace('pueden diferir levemente de las oficiales', 'son las oficiales')))],
    ['una clase de la app en #root', soloHtml(reemplazo('<div id="root">', '<div id="root"><div class="grupo-filtro"></div>'))],
    ['un asset que no existe', (h, c) => [h, { ...c, existe: (r) => !banner.endsWith(r) && c.existe(r) }]],
    ['un favicon con ruta relativa', soloHtml((h) => h.replace(/href="\/coipo_vista_catastro\/favicon-32\.png"/, 'href="./favicon-32.png"'))],
    ['dos canonical', soloHtml(reemplazo(canon, canon + canon))],
    ['og:url sin versión', soloHtml((h) => h.replace(/(og:url" content="[^"?]*)\?v=[0-9a-f]+/, '$1'))],
    ['og:title distinto de <title>', soloHtml((h) => h.replace(/(og:title" content=")/, '$1Otro '))],
    ['description distinta de og:description', soloHtml((h) => h.replace(/(name="description" content=")/, '$1Otra '))],
    ['marca sin reemplazar', soloHtml(reemplazo('</head>', '<!--cabeza--></head>'))],
    ['og:image que no existe', soloHtml((h) => h.replace(/(og:image" content="[^"]*)og\.png/, '$1no-existe.png'))],
    ['og:image que no es de 1200×630', (h, c) => [h, { ...c, leer: () => Buffer.concat([c.leer('og.png').subarray(0, 16), Buffer.from([0, 0, 4, 176, 0, 0, 2, 119]), c.leer('og.png').subarray(24)]) }]],
    ['sin tarjeta grande con og:image', soloHtml((h) => h.replace('content="summary_large_image"', 'content="summary"'))],
    ['un token de paginas.css distinto', (h, c) => [h, { ...c, paginasCss: c.paginasCss.replace('--verde-institucional: #064928', '--verde-institucional: #000000') }]],
    ['Umami sin identificador', soloHtml(reemplazo('</head>', '<script defer src="https://prueba5.conaf.cl/conaf.js"></script></head>'))],
  ]
}

function principal() {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8')
  const ctx = {
    manifest: leerManifest(join(DIST, 'datos')),
    existe: (ruta) => existsSync(join(DIST, ruta)),
    leer: (ruta) => readFileSync(join(DIST, ruta)),
    indexCss: readFileSync(join(RAIZ, 'src', 'index.css'), 'utf8'),
    paginasCss: readFileSync(join(DIST, 'paginas.css'), 'utf8'),
  }

  let rotas = 0
  const casos = negativas(html, ctx)
  for (const [nombre, alterar] of casos) {
    let caza
    try {
      const [h, c] = alterar(html, ctx)
      caza = problemas(h, c)
    } catch (e) {
      caza = null
      console.log(`  MAL  negativa «${nombre}»: ${e.message}`)
    }
    if (!caza?.length) {
      rotas++
      if (caza) console.log(`  MAL  negativa «${nombre}»: VERDE, el validador no la caza`)
    }
  }
  if (rotas) {
    console.log(`\nvalidar-html: ${rotas} negativa(s) sin cazar: el validador está roto.`)
    process.exit(1)
  }

  const p = problemas(html, ctx)
  if (p.length) {
    console.log('validar-html: dist/index.html NO sirve:')
    for (const x of p) console.log(`  - ${x}`)
    process.exit(1)
  }
  console.log(`✓ validar-html: portada horneada correcta; ${casos.length} negativas cazadas`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) principal()
