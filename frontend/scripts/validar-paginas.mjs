/**
 * Guarda de las páginas generadas (scripts/web.mjs): lo que un asistente cita y lo
 * que un buscador indexa, comprobado sobre el ARTEFACTO en dist/.
 *
 * LAS CIFRAS SE RECALCULAN AQUÍ POR OTRO CAMINO. Un oráculo tonto recorre el .bin y
 * suma polígonos y hectáreas por región y comuna leyendo las columnas a pelo, sin
 * indicadores.js; esos enteros tienen que aparecer en la frase de cada página. Si
 * el generador y el oráculo compartieran código compartirían sus errores.
 *
 * Qué exige, por página: un canonical absoluto igual a su dirección; og:url =
 * canonical + ?v=<12 hex>; og:title = <title>; description = og:description; la
 * frase citable con quién lo dice, la salvedad, «la comuna de <nombre>» en las
 * comunas, la región con su nombre oficial y las cifras del oráculo; hectáreas
 * enteras en la frase y las tablas; JSON-LD que parsea, sin «<», y cuyo código
 * (CUT) y archivos se VEN en la página; enlaces internos y assets que existen; y
 * nada de la app (ni su paquete ni el .bin fuera de «Datos publicados»). Del
 * sitio: el sitemap con exactamente las páginas que tienen que existir —cuántas,
 * derivado del manifest—, y el registro de URL publicadas cubierto.
 *
 * PRIMERO LAS NEGATIVAS, como validar-html.mjs.
 *
 * Uso:  node scripts/validar-paginas.mjs     (después de npm run build:web)
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cargarDatos } from './datos-node.mjs'
import { BASE, ORIGEN, UMAMI, URL_PUBLICA } from '../src/web/sitio.js'
import { QUIEN, SALVEDAD, slugDePagina } from '../src/web/textos.js'
import { escaparHtml } from '../src/web/cabeza.js'
import { problemaPng } from './validar-html.mjs'
import { readdirSync } from 'node:fs'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(RAIZ, 'dist')

const miles = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const desescapar = (s) => s.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
const cabeza = (h) => h.slice(0, Math.max(0, h.indexOf('</head>')))
const cuerpo = (h) => h.slice(h.indexOf('<body>'))
const metas = (h, atr, nombre) =>
  [...cabeza(h).matchAll(new RegExp(`<meta ${atr}="${nombre}" content="([^"]*)"`, 'g'))].map((m) => desescapar(m[1]))
const texto = (h) => desescapar(cuerpo(h).replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')

/** El oráculo: n y ha por región y comuna, a pelo sobre las columnas del .bin. */
export function oraculo(datos) {
  const man = datos.manifest
  const reg = man.regiones.map(() => ({ n: 0, ha: 0 }))
  const com = man.comunas.map(() => ({ n: 0, ha: 0 }))
  const SIN_COMUNA = 65535
  for (let i = 0; i < datos.n; i++) {
    const r = reg[datos.region[i]]
    r.n += 1
    r.ha += datos.ha[i]
    const c = datos.comuna[i]
    if (c !== SIN_COMUNA) {
      com[c].n += 1
      com[c].ha += datos.ha[i]
    }
  }
  return {
    region: new Map(man.regiones.map((r, i) => [r.cod, reg[i]])),
    comuna: new Map(man.comunas.map((c, i) => [c.cod, com[i]])),
  }
}

/** Las páginas que TIENEN que existir, derivadas del manifest (nunca un número escrito). */
export function paginasEsperadas(man) {
  const regionDe = new Map(man.regiones.map((r) => [r.cod, r]))
  return [
    { tipo: 'portada', ruta: BASE },
    { tipo: 'indice', ruta: `${BASE}regiones/` },
    ...man.regiones.map((r) => ({ tipo: 'region', ruta: `${BASE}region/${slugDePagina(r.nombre)}/`, r })),
    ...man.comunas.filter((c) => c.n > 0)
      .map((c) => ({ tipo: 'comuna', ruta: `${BASE}comuna/${slugDePagina(c.etiqueta)}/`, c, r: regionDe.get(c.region) })),
  ]
}

const enDist = (ruta) => {
  const limpia = decodeURIComponent(ruta.split(/[?#]/)[0]).slice(BASE.length)
  return !limpia || limpia.endsWith('/') ? join(limpia, 'index.html') : limpia
}

/** Los problemas de UNA página generada (región, comuna o índice). */
export function problemasPagina(html, pag, { existe, leer, oraculo: o }) {
  const p = []
  const canonical = ORIGEN + pag.ruta
  const canon = [...cabeza(html).matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1])
  if (canon.length !== 1 || canon[0] !== canonical) p.push(`canonical «${canon.join(' | ')}» ≠ ${canonical}`)
  const ogUrl = metas(html, 'property', 'og:url')
  if (ogUrl.length !== 1 || !ogUrl[0].startsWith(`${canonical}?v=`) || !/\?v=[0-9a-f]{12}$/.test(ogUrl[0])) {
    p.push(`og:url «${ogUrl.join(' | ')}» no es el canonical con ?v=<12 hex>`)
  }
  const titulo = desescapar(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '')
  if (metas(html, 'property', 'og:title')[0] !== titulo) p.push('og:title ≠ <title>')
  const d = metas(html, 'name', 'description')
  // Un cero se lee como ausencia comprobada: la frase lo evita, y la descripción —que es
  // lo que muestran el buscador y la vista previa— también tiene que evitarlo.
  if (d.some((x) => /(^|[^\d.])0 ha\b/.test(x))) p.push('la descripción dice «0 ha»: se leería como ausencia comprobada')
  if (d.length !== 1 || d[0] !== metas(html, 'property', 'og:description')[0]) p.push('description ≠ og:description')
  const img = metas(html, 'property', 'og:image')[0]
  if (!img) p.push('sin og:image: la vista previa saldría sin tarjeta')
  else if (!img.startsWith(URL_PUBLICA) || !existe(enDist(img.slice(ORIGEN.length)))) p.push(`og:image «${img}» no existe`)
  else {
    const malo = problemaPng(leer(enDist(img.slice(ORIGEN.length))), 'og:image')
    if (malo) p.push(malo)
  }

  // JSON-LD: parsea, sin «<», y lo que declara se ve.
  const vis = texto(html)
  const bloques = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1])
  if (bloques.length !== 1) p.push(`${bloques.length} bloques JSON-LD; tiene que haber uno`)
  for (const b of bloques) {
    if (b.includes('<')) p.push('el JSON-LD contiene «<»')
    let ld = null
    try { ld = JSON.parse(b) } catch { p.push('el JSON-LD no parsea') }
    const id = ld?.about?.identifier
    // En su forma EXACTA, «(CUT) 15»: el código suelto de una región son dos dígitos que
    // aparecen en cualquier año o cifra («2015», «100 %»), y la regla no probaba nada.
    if (id && !vis.includes(`(CUT) ${id}`)) p.push(`el JSON-LD declara el código ${id} y la página no lo muestra`)
    for (const dist of ld?.distribution ?? []) {
      const nombre = dist.contentUrl.split('/').at(-1)
      if (!vis.includes(nombre)) p.push(`el Dataset declara ${nombre} y la página no lo muestra`)
    }
    if (ld?.['@type'] === 'Dataset') {
      const n = ld.description?.length ?? 0
      if (n < 50 || n > 5000) p.push(`la descripción del Dataset tiene ${n} caracteres (50 a 5000)`)
      if ('license' in ld) p.push('el Dataset declara una licencia que CONAF no ha definido')
    }
  }

  // La frase citable.
  const fraseHtml = html.match(/<p[^>]*data-frase[^>]*>([\s\S]*?)<\/p>/)?.[1]
  const frase = fraseHtml && desescapar(fraseHtml)
  if (!frase) p.push('sin la frase citable ([data-frase])')
  else {
    if (!frase.includes(QUIEN)) p.push('la frase no dice quién la publica')
    if (!frase.includes(SALVEDAD)) p.push('la frase no trae la salvedad')
    if (/\d,\d+ ha/.test(frase)) p.push('la frase lleva hectáreas con decimales')
    const cifras = pag.tipo === 'comuna' ? o.comuna.get(pag.c.cod) : pag.tipo === 'region' ? o.region.get(pag.r.cod) : null
    if (cifras) {
      const pol = `${miles(cifras.n)} ${cifras.n === 1 ? 'polígono' : 'polígonos'}`
      if (!frase.includes(`${miles(Math.round(cifras.ha))} ha catastradas en ${pol}`)) {
        p.push(`la frase no dice lo que da el oráculo: ${miles(Math.round(cifras.ha))} ha en ${pol}`)
      }
    }
    if (pag.tipo === 'comuna') {
      if (!frase.startsWith(`La comuna de ${pag.c.etiqueta} (${pag.r.oficial})`)) p.push('la frase de comuna no empieza por «La comuna de <nombre> (<región oficial>)»')
      if (!fraseHtml.includes(escaparHtml(pag.c.etiqueta))) p.push('el nombre no sale escapado en el HTML')
    }
    if (pag.tipo === 'region' && !frase.startsWith(`${pag.r.oficial}:`)) p.push('la frase de región no empieza por su nombre oficial')
  }
  if (pag.tipo !== 'indice') {
    for (const t of html.matchAll(/<table class="est-tabla">([\s\S]*?)<\/table>/g)) {
      if (/\d,\d+ ha/.test(desescapar(t[1].replace(/<[^>]+>/g, ' ')))) p.push('una tabla lleva hectáreas con decimales')
    }
  }

  // Enlaces, assets y nada de la app.
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const ref = m[1]
    if (/^https?:\/\//.test(ref) || ref.startsWith('#')) continue
    if (!ref.startsWith(BASE)) { p.push(`ruta fuera de ${BASE}: «${ref}»`); continue }
    if (!existe(enDist(ref))) p.push(`enlace roto: «${ref}»`)
  }
  if (/<script type="module"/.test(html) || html.includes('/assets/index-')) p.push('la página carga el paquete de la app')
  if (/(?:src|href)="[^"]*\.bin[^"]*"/.test(html.replace(/<li>\s*<a href="[^"]*\.bin"/g, ''))) p.push('el .bin se enlaza fuera de «Datos publicados»')
  if (/<link[^>]*rel="preload"[^>]*\.bin/.test(html)) p.push('la página precarga el .bin')
  const umami = (html.match(/conaf\.js/g) ?? []).length
  if (!UMAMI.id && umami) p.push('etiqueta de Umami sin identificador')
  if (UMAMI.id && (umami !== 1 || html.includes('data-auto-track="false"'))) p.push('Umami: una etiqueta, con autotrack, en cada página')
  return p
}

/** Los problemas del conjunto: el sitemap y el registro de URL publicadas. */
export function problemasSitio({ man, sitemap, registro, existe, tarjetas, citadas }) {
  const p = []
  // Cada tarjeta dibujada se cita y cada citada existe: una PNG huérfana es trabajo que
  // nadie ve, y suele delatar que las páginas citan OTRA carpeta.
  const huerfanas = tarjetas.filter((t) => !citadas.has(t))
  if (huerfanas.length) p.push(`${huerfanas.length} tarjetas que ninguna página cita (${huerfanas[0]})`)
  if (!tarjetas.length) p.push('no hay tarjetas en dist/tarjetas/: ¿corriste scripts/tarjetas.py?')
  const esperadas = paginasEsperadas(man).map((x) => ORIGEN + x.ruta)
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  if (locs.length !== esperadas.length) p.push(`el sitemap tiene ${locs.length} URL y tienen que ser ${esperadas.length}`)
  const faltan = esperadas.filter((u) => !locs.includes(u))
  if (faltan.length) p.push(`faltan en el sitemap: ${faltan.slice(0, 3).join(', ')}`)
  if (locs.some((l) => !l.startsWith(URL_PUBLICA))) p.push('el sitemap tiene URL que no son absolutas bajo el sitio')
  const lastmods = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1])
  if (lastmods.length !== locs.length || lastmods.some((f) => !/^\d{4}-\d{2}-\d{2}$/.test(f))) p.push('lastmod ausente o no es una fecha AAAA-MM-DD')
  for (const clave of Object.keys(registro)) {
    if (!existe(join(clave, 'index.html'))) p.push(`la URL publicada ${clave} no tiene página ni alias`)
  }
  return p
}

// ------------------------------------------------------------------ negativas

function negativas(pags, ctx) {
  const comuna = pags.find((x) => x.pag.tipo === 'comuna' && x.pag.c.cod === '14108')
  const indice = pags.find((x) => x.pag.tipo === 'indice')
  const reemplazo = (h, de, a) => {
    if (!h.includes(de)) throw new Error(`la negativa no encaja: ${JSON.stringify(de.slice(0, 40))}`)
    return h.replace(de, a)
  }
  const unaPagina = (x, alterar, extra = {}) => () => problemasPagina(alterar(x.html), x.pag, { ...ctx, ...extra })
  const frase = comuna.html.match(/<p[^>]*data-frase[^>]*>[\s\S]*?<\/p>/)[0]
  const arica = pags.find((x) => x.pag.tipo === 'region' && x.pag.r.cod === '15')
  // Un asset que SÍ existe: la regla del paquete de la app no puede saltar por «enlace roto».
  const paquete = ctx.assetDeLaApp
  // Cada negativa: [nombre, trozo del problema que TIENE que salir, correr]. Que salte por
  // otra regla no prueba la suya.
  return [
    ['sin canonical', 'canonical', unaPagina(comuna, (h) => h.replace(/<link rel="canonical"[^>]*>/, ''))],
    ['canonical de otra página', 'canonical', unaPagina(comuna, (h) => h.replace(/(rel="canonical" href="[^"]*)panguipulli/, '$1valdivia'))],
    ['og:url sin versión', 'og:url', unaPagina(comuna, (h) => h.replace(/(og:url" content="[^"?]*)\?v=[0-9a-f]+/, '$1'))],
    ['la frase no empieza por «La comuna de»', 'no empieza por «La comuna de', unaPagina(comuna, (h) => reemplazo(h, frase, frase.replace('La comuna de ', '')))],
    ['la frase cita otra superficie', 'oráculo', unaPagina(comuna, (h) => reemplazo(h, frase, frase.replace(/\d{1,3}(\.\d{3})* ha catastradas/, '1 ha catastradas')))],
    ['la frase sin la salvedad', 'salvedad', unaPagina(comuna, (h) => reemplazo(h, frase, frase.replace('Las cifras del visor', 'Las cifras oficiales')))],
    ['hectáreas con decimales en la frase', 'la frase lleva hectáreas con decimales',
      unaPagina(comuna, (h) => reemplazo(h, frase, frase.replace(/ ha de bosque nativo/, ',5 ha de bosque nativo')))],
    ['hectáreas con decimales en una tabla', 'una tabla lleva',
      unaPagina(comuna, (h) => h.replace(/(<td class="num">[\d.]+) ha<\/td>/, '$1,5 ha</td>'))],
    ['el CUT de una región no se ve', 'no lo muestra', unaPagina(arica, (h) => h.replace(/\(CUT\) 15/, ''))],
    ['la descripción dice «0 ha»', '0 ha', unaPagina(comuna, (h) => h.replace(/(name="description" content="[^"]*?)\d[\d.]* ha de bosque nativo/, '$10 ha de bosque nativo'))],
    ['el CUT no se ve', 'no lo muestra', unaPagina(comuna, (h) => h.replace(/Código comunal \(CUT\) \d+/, 'Código comunal'))],
    ['JSON-LD con «<»', 'contiene «<»', unaPagina(comuna, (h) => h.replace('"@type":"WebPage"', '"@type":"WebPage","x":"</b>"'))],
    ['un enlace interno roto', 'enlace roto', unaPagina(comuna, (h) => h, { existe: (r) => !r.includes('region') && ctx.existe(r) })],
    ['la página carga la app', 'carga el paquete',
      unaPagina(comuna, (h) => h.replace('</body>', `<script type="module" src="${paquete}"></script></body>`))],
    ['el Dataset con licencia', 'licencia', unaPagina(indice, (h) => h.replace('"@type":"Dataset"', '"@type":"Dataset","license":"CC-BY"'))],
    ['el Dataset declara un archivo que no se ve', 'declara manifest.json', unaPagina(indice, (h) => h.replace(/>manifest\.json<\/a>/, '>índice</a>'))],
    ['falta una comuna en el sitemap', 'sitemap', () => problemasSitio({ ...ctx, sitemap: ctx.sitemap.replace(/<url><loc>[^<]*panguipulli[^<]*<\/loc>[^\n]*\n/, '') })],
    ['una URL publicada sin página', 'no tiene página', () => problemasSitio({ ...ctx, registro: { ...ctx.registro, 'comuna/no-existe': '99999' } })],
    ['una tarjeta que nadie cita', 'ninguna página cita', () => problemasSitio({ ...ctx, tarjetas: [...ctx.tarjetas, `${BASE}tarjetas/x/huerfana.png`] })],
    ['la página no cita su tarjeta', 'sin og:image', unaPagina(comuna, (h) => h.replace(/<meta property="og:image" [^>]*>/, ''))],
    ['la tarjeta citada no es de 1200×630', 'no es un PNG', unaPagina(comuna, (h) => h, { leer: () => Buffer.from('no es un png') })],
  ]
}

function principal() {
  const datos = cargarDatos()
  const man = datos.manifest
  const existe = (r) => existsSync(join(DIST, r))
  const leer = (ruta) => readFileSync(join(DIST, enDist(ruta)), 'utf8')
  const esperadas = paginasEsperadas(man).filter((x) => x.tipo !== 'portada')
  const falta = esperadas.filter((x) => !existe(enDist(x.ruta)))
  if (falta.length) {
    console.log(`validar-paginas: faltan ${falta.length} páginas (¿corriste npm run build:web?): ${falta.slice(0, 3).map((x) => x.ruta).join(', ')}`)
    process.exit(1)
  }
  const pags = esperadas.map((pag) => ({ pag, html: leer(pag.ruta) }))
  const dirTarjetas = join(DIST, 'tarjetas')
  const tarjetas = existsSync(dirTarjetas)
    ? readdirSync(dirTarjetas).flatMap((s) => readdirSync(join(dirTarjetas, s)).map((f) => `${BASE}tarjetas/${s}/${f}`))
    : []
  const citadas = new Set(pags.map(({ html }) => metas(html, 'property', 'og:image')[0]?.slice(ORIGEN.length)).filter(Boolean))
  const ctx = {
    man,
    existe,
    assetDeLaApp: `${BASE}assets/${readdirSync(join(DIST, 'assets')).find((f) => /^index-.*\.js$/.test(f))}`,
    leer: (r) => readFileSync(join(DIST, r)),
    tarjetas,
    citadas,
    oraculo: oraculo(datos),
    sitemap: readFileSync(join(DIST, 'sitemap.xml'), 'utf8'),
    registro: JSON.parse(readFileSync(join(RAIZ, 'scripts', 'slugs-publicados.json'), 'utf8')),
  }

  let rotas = 0
  const casos = negativas(pags, ctx)
  for (const [nombre, esperado, correr] of casos) {
    let caza
    try { caza = correr() } catch (e) { caza = null; console.log(`  MAL  negativa «${nombre}»: ${e.message}`) }
    if (!caza) rotas++
    else if (!caza.some((m) => m.includes(esperado))) {
      rotas++
      console.log(`  MAL  negativa «${nombre}»: ${caza.length ? `salta por otra regla (${caza[0]})` : 'VERDE, el validador no la caza'}`)
    }
  }
  if (rotas) {
    console.log(`\nvalidar-paginas: ${rotas} negativa(s) sin cazar: el validador está roto.`)
    process.exit(1)
  }

  const problemas = []
  for (const { pag, html } of pags) for (const x of problemasPagina(html, pag, ctx)) problemas.push(`${pag.ruta}: ${x}`)
  problemas.push(...problemasSitio(ctx))
  if (problemas.length) {
    console.log(`validar-paginas: ${problemas.length} problema(s):`)
    for (const x of problemas.slice(0, 40)) console.log(`  - ${x}`)
    process.exit(1)
  }
  console.log(`✓ validar-paginas: ${pags.length} páginas y el sitemap correctos; ${casos.length} negativas cazadas`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) principal()
