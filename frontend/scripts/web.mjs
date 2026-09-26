/**
 * Genera las páginas estáticas por región y por comuna, el índice, el sitemap y
 * web/indice.json, dentro de dist/. Corre DESPUÉS de `npm run build`:
 *
 *     npm run build && npm run build:web
 *
 * Por qué existen (DECISIONES §M.9). Un asistente de IA no ejecuta JavaScript y
 * un enlace al visor con `?com=14101` muestra la vista previa de la portada: no
 * había ninguna URL que dijera las cifras de una comuna. Ahora hay una por región
 * y una por comuna, con su frase citable, sus tablas, su JSON-LD y su vista previa.
 *
 * LAS CIFRAS SON LAS DEL PANEL POR CONSTRUCCIÓN: salen de `resumenYMarginales`
 * con `filtroDelAmbito`, las mismas funciones que usa el visor, sobre el .bin
 * commiteado. Para no recorrer 1,8 M de filas 359 veces se le pasa a cada región
 * el SUBCONJUNTO de sus filas, en el mismo orden: las sumas son las mismas, en el
 * mismo orden, así que el resultado es idéntico bit a bit. No se supone: se
 * comprueba en cada corrida contra la pasada completa (controlSubconjunto).
 *
 * Aparte, `npm run build` no lo hace: tarda unos segundos y mutaciones-visor.py
 * compila una vez por mutación.
 *
 * Uso:  node scripts/web.mjs [--negativas] [--registrar]
 *   --negativas  antes de generar, rompe cada control a propósito y exige que salte.
 *   --registrar  da de alta en scripts/slugs-publicados.json las URL nuevas.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cargarDatos, DATOS } from './datos-node.mjs'
import { construirServidor, urlOgGenerica, versionVista } from './prerender.mjs'
import { filtroDelAmbito, resumenYMarginales } from '../src/indicadores.js'
import { haPlantacionEspecie, mayorPoligono, oficialesPorRegion, rangoAnios } from '../src/hechos.js'
import { slugDePagina } from '../src/web/textos.js'
import { ORIGEN, URL_PUBLICA } from '../src/web/sitio.js'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(RAIZ, '..')
const DIST = join(RAIZ, 'dist')
const SSR = join(RAIZ, '.prerender-web')
export const REGISTRO = join(RAIZ, 'scripts', 'slugs-publicados.json')
const WEB = join(RAIZ, '.web')

/**
 * El sello de la carpeta de las tarjetas: sha256[:12] de tarjetas.json crudo, de
 * scripts/tarjetas.py con saltos LF, de la tipografía y de requirements.txt. Cambia
 * exactamente cuando puede cambiar un píxel. LA MISMA RECETA que `sello()` en
 * tarjetas.py, que la recalcula y se niega a dibujar si no coincide.
 */
export function selloTarjetas(bytesJson) {
  const lf = (ruta) => Buffer.from(readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n'), 'utf8')
  return createHash('sha256')
    .update(bytesJson)
    .update(lf(join(RAIZ, 'scripts', 'tarjetas.py')))
    .update(readFileSync(join(RAIZ, 'scripts', 'fuentes', 'AtkinsonHyperlegibleNext-wght.ttf')))
    .update(lf(join(RAIZ, 'scripts', 'requirements.txt')))
    .digest('hex')
    .slice(0, 12)
}

// Tolerancia de las hectáreas contra el manifest: la de marginales.mjs. El
// manifest suma en float64 los valores originales y aquí se suma la columna
// float32 del .bin; medido, ninguna comuna difiere en más de 0,059 ha.
const casi = (a, b) => Math.abs(a - b) <= 0.02 + 1e-7 * Math.abs(a)
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// ------------------------------------------------------------------ las fechas

/**
 * La fecha de lo publicado: la del último commit que tocó los datos o lo que
 * genera las páginas. Determinista (dos corridas del mismo commit dan la misma) y
 * sin hora. En un clon SUPERFICIAL `git log -- <ruta>` devuelve la fecha del HEAD
 * sin ningún error, así que eso se prohíbe en vez de publicar una fecha falsa.
 */
export function fechaDeLoPublicado({ git = gitReal } = {}) {
  if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    throw new Error('el repositorio es superficial: la fecha de los datos saldría mal (en el CI, fetch-depth: 0)')
  }
  // Todo lo que cambia los bytes de una página: los datos, TODO src/ (las cifras salen
  // de indicadores.js, el formato de formato.js, el pie de CitaVisor, la Metodología del
  // índice…), los scripts (web.mjs, el dibujante y su sello, el registro de URL) y las
  // dependencias (renderToStaticMarkup cambia con React). Con sólo tres rutas, un
  // arreglo en formato.js cambiaba las 359 páginas y publicaba la fecha de antes.
  const rutas = ['frontend/public/datos', 'frontend/src', 'frontend/scripts', 'frontend/package-lock.json']
  const fechas = rutas.map((r) => git(['log', '-1', '--format=%cs', '--', r]).trim()).filter(Boolean)
  if (!fechas.length) throw new Error('git no da ninguna fecha para los datos')
  return {
    datos: git(['log', '-1', '--format=%cs', '--', 'frontend/public/datos']).trim(),
    paginas: fechas.sort().at(-1),
  }
}

function gitReal(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' })
}

// -------------------------------------------------------------- las cifras

/** Las filas de `datos` en `filas`, en ese orden, con las mismas columnas. */
export function subconjunto(datos, filas) {
  const sub = { n: filas.length, manifest: datos.manifest }
  for (const [k, v] of Object.entries(datos)) {
    if (ArrayBuffer.isView(v) && v.length === datos.n) {
      const col = new v.constructor(filas.length)
      for (let i = 0; i < filas.length; i++) col[i] = v[filas[i]]
      sub[k] = col
    }
  }
  return sub
}

/** Índices de fila por región, en el orden del .bin. */
function filasPorRegion(datos) {
  const listas = datos.manifest.regiones.map(() => [])
  for (let i = 0; i < datos.n; i++) listas[datos.region[i]]?.push(i)
  return listas
}

/** Resumen de cada región y de cada comuna con polígonos, como lo daría el panel. */
export function calcular(datos) {
  const man = datos.manifest
  const filas = filasPorRegion(datos)
  const regiones = new Map()
  const comunas = new Map()
  man.regiones.forEach((r, i) => {
    const sub = subconjunto(datos, filas[i])
    regiones.set(r.cod, resumenYMarginales(sub, filtroDelAmbito({ region: r.cod }, man)).resumen)
    for (const c of man.comunas) {
      if (c.region !== r.cod || !(c.n > 0)) continue
      comunas.set(c.cod, resumenYMarginales(sub, filtroDelAmbito({ region: r.cod, comuna: c.cod }, man)).resumen)
    }
  })
  return { regiones, comunas, filas }
}

/**
 * El atajo del subconjunto tiene que dar EXACTAMENTE lo mismo que la pasada
 * completa. Se compara en tres ámbitos elegidos por lo que tienen de raro:
 * Valdivia (una comuna grande), Santiago (un solo polígono) y Magallanes (con
 * polígonos sin comuna).
 */
export function controlSubconjunto(datos, calc, { resumenDe = resumenYMarginales } = {}) {
  const man = datos.manifest
  for (const [region, comuna] of [['14', '14101'], ['13', '13101'], ['12', null]]) {
    const i = man.regiones.findIndex((r) => r.cod === region)
    const ambito = comuna ? { region, comuna } : { region }
    const completo = JSON.stringify(resumenYMarginales(datos, filtroDelAmbito(ambito, man)).resumen)
    const sub = subconjunto(datos, calc.filas[i])
    const atajo = JSON.stringify(resumenDe(sub, filtroDelAmbito(ambito, man)).resumen)
    if (completo !== atajo) throw new Error(`el subconjunto de ${comuna ?? region} no da lo mismo que la pasada completa`)
  }
}

/** Cada región y comuna tiene que cuadrar con el manifest: `n` exacto, `ha` con tolerancia. */
export function controlManifest(calc, man) {
  for (const r of man.regiones) {
    const s = calc.regiones.get(r.cod)
    if (!s || s.n !== r.n || !casi(s.ha, r.ha)) throw new Error(`la región ${r.cod} no cuadra con el manifest (${s?.n} de ${r.n})`)
  }
  for (const c of man.comunas.filter((x) => x.n > 0)) {
    const s = calc.comunas.get(c.cod)
    if (!s || s.n !== c.n || !casi(s.ha, c.ha)) throw new Error(`la comuna ${c.cod} no cuadra con el manifest (${s?.n} de ${c.n})`)
  }
}

// ---------------------------------------------------------------- las URL

/** `nivel/slug` → código, de lo que hay hoy. Lanza ante un slug repetido o mal formado. */
export function slugsActuales(man) {
  const salida = new Map()
  const alta = (clave, cod) => {
    if (!SLUG.test(clave.split('/')[1])) throw new Error(`slug mal formado: ${clave}`)
    if (salida.has(clave)) throw new Error(`slug repetido: ${clave} (${salida.get(clave)} y ${cod})`)
    salida.set(clave, cod)
  }
  for (const r of man.regiones) alta(`region/${slugDePagina(r.nombre)}`, r.cod)
  for (const c of man.comunas.filter((x) => x.n > 0)) alta(`comuna/${slugDePagina(c.etiqueta)}`, c.cod)
  return salida
}

/**
 * El registro de URL publicadas es SÓLO DE ALTA. Una URL que ya se publicó no puede
 * desaparecer: la tienen los buscadores, los asistentes y quien la compartió. Si
 * CONAF resuelve una grafía en disputa (14_REVISAR: Coihaique, Calera…) y cambia un
 * nombre, la URL vieja pasa a ser un ALIAS que lleva a la nueva por su código.
 *
 * Devuelve los alias a generar. Lanza si hay una URL nueva sin registrar (con
 * `registrar` la da de alta) o si una registrada ya no corresponde a nada.
 */
export function revisarRegistro(registro, actuales, { registrar = false } = {}) {
  const porCodigo = new Map([...actuales].map(([clave, cod]) => [`${clave.split('/')[0]}:${cod}`, clave]))
  const nuevas = [...actuales.keys()].filter((k) => !(k in registro))
  if (nuevas.length && !registrar) {
    throw new Error(`${nuevas.length} URL sin registrar (${nuevas.slice(0, 3).join(', ')}…): node scripts/web.mjs --registrar`)
  }
  const alias = []
  for (const [clave, cod] of Object.entries(registro)) {
    if (actuales.has(clave)) {
      // Que la URL exista no basta: tiene que seguir siendo del MISMO territorio. Si otra
      // comuna hereda el nombre, los enlaces compartidos citarían cifras ajenas.
      if (actuales.get(clave) !== cod) {
        throw new Error(`la URL publicada ${clave} era de ${cod} y ahora sería de ${actuales.get(clave)}`)
      }
      continue
    }
    const destino = porCodigo.get(`${clave.split('/')[0]}:${cod}`)
    if (!destino) throw new Error(`la URL publicada ${clave} (${cod}) ya no corresponde a ninguna página`)
    alias.push([clave, destino])
  }
  const actualizado = { ...registro }
  for (const k of nuevas) actualizado[k] = actuales.get(k)
  return { alias, registro: actualizado, nuevas }
}

// ------------------------------------------------------------- la escritura

async function escribir(ruta, texto) {
  await mkdir(dirname(ruta), { recursive: true })
  await writeFile(`${ruta}.tmp`, texto, 'utf8')
  await rename(`${ruta}.tmp`, ruta)
}

const ordenado = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))

function sitemap(urls, fecha) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `  <url><loc>${u}</loc><lastmod>${fecha}</lastmod></url>`),
    '</urlset>',
    '',
  ].join('\n')
}

function paginaAlias(srv, destino) {
  const url = ORIGEN + srv.BASE + destino + '/'
  return [
    '<!doctype html>',
    '<html lang="es-CL">',
    '<head>',
    '<meta charset="utf-8" />',
    '<title>Esta página cambió de dirección</title>',
    `<link rel="canonical" href="${url}" />`,
    `<meta http-equiv="refresh" content="0; url=${url}" />`,
    '<meta name="robots" content="noindex" />',
    '</head>',
    `<body><p>Esta página está ahora en <a href="${url}">${url}</a>.</p></body>`,
    '</html>',
    '',
  ].join('\n')
}

// ------------------------------------------------------------------- la corrida

async function generar({ registrar }) {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('falta dist/: corre `npm run build` antes')
  const t0 = performance.now()
  const fecha = fechaDeLoPublicado()
  const datos = cargarDatos()
  const man = datos.manifest
  const oficiales = JSON.parse(readFileSync(join(DATOS, 'oficiales.json'), 'utf8'))
  const simef = JSON.parse(readFileSync(join(DATOS, 'simef.json'), 'utf8'))
  const oficialDe = oficialesPorRegion(man, oficiales)

  const calc = calcular(datos)
  controlSubconjunto(datos, calc)
  controlManifest(calc, man)
  const tCalc = performance.now() - t0

  const actuales = slugsActuales(man)
  const previo = existsSync(REGISTRO) ? JSON.parse(readFileSync(REGISTRO, 'utf8')) : {}
  const { alias, registro, nuevas } = revisarRegistro(previo, actuales, { registrar })
  if (nuevas.length) {
    await escribir(REGISTRO, JSON.stringify(ordenado(registro), null, 2) + '\n')
    console.log(`  registradas ${nuevas.length} URL nuevas en scripts/slugs-publicados.json`)
  }

  const srv = await construirServidor(SSR)
  try {
    for (const d of ['regiones', 'region', 'comuna', 'web', 'tarjetas']) await rm(join(DIST, d), { recursive: true, force: true })
    const abs = (ruta) => ORIGEN + ruta
    const urlIndice = abs(srv.URL_INDICE)
    const urls = [abs(srv.BASE), urlIndice]
    const pagina = async (ruta, { titulo, descripcion, ld, cuerpo, imagen }) => {
      const canonical = abs(ruta)
      const cabeza = srv.cabezaPagina({
        canonical, titulo, descripcion, imagen, version: versionVista(titulo, descripcion, imagen?.url), ld,
      })
      await escribir(join(DIST, ruta.slice(srv.BASE.length), 'index.html'), srv.documento({ base: srv.BASE, titulo, cabeza, cuerpo }))
    }
    // Las páginas de región y comuna esperan hasta tener el sello de sus tarjetas:
    // su og:image lo lleva en la ruta.
    const pendientes = []

    // Regiones
    const discrepancias = new Map((oficiales.anio_discrepante ?? []).map((d) => [d.region, d]))
    for (const r of man.regiones) {
      const resumen = calc.regiones.get(r.cod)
      const comunas = man.comunas.filter((c) => c.region === r.cod && c.n > 0)
        .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'))
      const sumaComunas = resumen.comunas.reduce((a, c) => a + c.ha, 0)
      const sinComuna = { n: resumen.sinDato?.comuna ?? 0, ha: Math.max(0, resumen.ha - sumaComunas) }
      const titulo = srv.tituloRegion(r)
      const descripcion = srv.descripcionEntidad(r.oficial, r.anio, resumen)
      const ruta = srv.urlRegion(r)
      urls.push(abs(ruta))
      pendientes.push([ruta, {
        titulo, descripcion,
        tarjeta: srv.tarjetaDe({
          archivo: `region-${srv.slugDePagina(r.nombre)}.png`, titulo: r.oficial,
          subtitulo: `Chile · código regional ${r.cod}`, anio: r.anio, resumen, url: abs(ruta),
        }),
        ld: srv.datosPagina({ url: abs(ruta), titulo, descripcion, fecha: fecha.paginas, urlIndice, lugar: { nombre: r.oficial, cut: r.cod } }),
        cuerpo: srv.renderRegion({
          region: r, resumen, manifest: man, oficial: oficialDe.get(r.cod),
          discrepancia: discrepancias.get(r.nombre), comunas, sinComuna,
        }),
      }])
    }

    // Comunas
    const regionDe = new Map(man.regiones.map((r) => [r.cod, r]))
    for (const c of man.comunas.filter((x) => x.n > 0)) {
      const r = regionDe.get(c.region)
      const resumen = calc.comunas.get(c.cod)
      const titulo = srv.tituloComuna(c, r)
      const descripcion = srv.descripcionEntidad(`Comuna de ${c.etiqueta} (${r.nombre})`, r.anio, resumen)
      const ruta = srv.urlComuna(c)
      urls.push(abs(ruta))
      pendientes.push([ruta, {
        titulo, descripcion,
        tarjeta: srv.tarjetaDe({
          archivo: `comuna-${srv.slugDePagina(c.etiqueta)}.png`, titulo: `Comuna de ${c.etiqueta}`,
          subtitulo: r.oficial, anio: r.anio, resumen, url: abs(ruta),
        }),
        ld: srv.datosPagina({
          url: abs(ruta), titulo, descripcion, fecha: fecha.paginas, urlIndice,
          lugar: { nombre: `Comuna de ${c.etiqueta}`, cut: c.cod, dentroDe: r.oficial },
        }),
        cuerpo: srv.renderComuna({ comuna: c, region: r, resumen, manifest: man }),
      }])
    }

    // Las tarjetas: los textos ya formateados van a .web/tarjetas.json (fuera de
    // dist/: es un insumo, no se publica) y el sello a su lado. tarjetas.py dibuja.
    const bytesTarjetas = Buffer.from(JSON.stringify({ tarjetas: pendientes.map(([, p]) => p.tarjeta) }) + '\n', 'utf8')
    const sello = selloTarjetas(bytesTarjetas)
    await escribir(join(WEB, 'tarjetas.json'), bytesTarjetas.toString('utf8'))
    await escribir(join(WEB, 'tarjetas.sello'), sello + '\n')
    for (const [ruta, { tarjeta, ...p }] of pendientes) {
      await pagina(ruta, {
        ...p,
        imagen: {
          url: `${URL_PUBLICA}tarjetas/${sello}/${tarjeta.archivo}`, ancho: 1200, alto: 630,
          alt: `${tarjeta.titulo}: ${tarjeta.renglones.join(' · ')}`,
        },
      })
    }

    // Índice, con el Dataset
    const cap = man.capas.cbn_puntos
    const bytesManifest = statSync(join(DATOS, 'manifest.json')).size
    const descripcionIndice = srv.fraseNacional(man)
    await pagina(srv.URL_INDICE, {
      imagen: { url: urlOgGenerica(URL_PUBLICA), ancho: 1200, alto: 630, alt: 'Catastro de Usos de la Tierra y Recursos Vegetacionales de CONAF' },
      titulo: srv.TITULO_INDICE,
      // «de las 16 regiones y 343 comunas de Chile» diría que Chile tiene 343: tiene 346, y
      // el Catastro publicado no trae Juan Fernández, Isla de Pascua ni la Antártica.
      descripcion: `Superficie por uso de la tierra y bosques de las ${man.regiones.length} regiones de Chile y de ` +
        `${actuales.size - man.regiones.length} comunas con polígonos en el Catastro, según el Visor del Catastro de CONAF.`,
      ld: srv.datosDataset({
        urlIndice, descripcion: descripcionIndice, rango: rangoAnios(man), fecha: fecha.datos,
        archivos: [
          { formato: 'application/json', url: abs(`${srv.BASE}datos/manifest.json`), tamano: `${Math.round(bytesManifest / 1024)} kB` },
          { formato: 'application/octet-stream', url: abs(`${srv.BASE}datos/${cap.archivo}`), tamano: `${Math.round(cap.bytes / 1e6)} MB` },
        ],
      }),
      cuerpo: srv.renderIndice({
        manifest: man, bytesManifest, oficiales, simef,
        pinus: haPlantacionEspecie(datos, man, 'PR'), mayor: mayorPoligono(datos),
      }),
    })

    // Alias de URL viejas, el sitemap y el índice para Compartir
    for (const [viejo, nuevo] of alias) await escribir(join(DIST, viejo, 'index.html'), paginaAlias(srv, nuevo))
    await escribir(join(DIST, 'sitemap.xml'), sitemap(urls, fecha.paginas))
    const indice = { esquema: srv.ESQUEMA_INDICE, regiones: {}, comunas: {} }
    for (const [clave, cod] of actuales) indice[clave.startsWith('region/') ? 'regiones' : 'comunas'][cod] = clave.split('/')[1]
    indice.regiones = ordenado(indice.regiones)
    indice.comunas = ordenado(indice.comunas)
    await escribir(join(DIST, 'web', 'indice.json'), JSON.stringify(indice) + '\n')

    const ms = Math.round(performance.now() - t0)
    console.log(`✓ build:web: ${urls.length} URL en el sitemap (${man.regiones.length} regiones, ` +
      `${actuales.size - man.regiones.length} comunas), ${alias.length} alias, ${pendientes.length} tarjetas por ` +
      `dibujar con sello ${sello}; cifras ${Math.round(tCalc)} ms, total ${ms} ms`)
  } finally {
    await rm(SSR, { recursive: true, force: true })
  }
}

// ------------------------------------------------------------------ negativas

/** Rompe cada control a propósito; si alguno no salta, el generador no protege nada. */
async function negativas() {
  const datos = cargarDatos()
  const man = datos.manifest
  const calc = calcular(datos)
  const copia = (x) => JSON.parse(JSON.stringify(x))
  const casos = [
    // En Magallanes el control compara la región ENTERA; en Los Ríos sólo Valdivia,
    // así que una fila perdida de otra comuna de Los Ríos no la ve este control
    // (la ve controlManifest, por el `n` exacto: caso de abajo).
    ['el subconjunto de una región pierde una fila', () => {
      const i = man.regiones.findIndex((r) => r.cod === '12')
      const roto = { ...calc, filas: calc.filas.map((f, k) => (k === i ? f.slice(1) : f)) }
      controlSubconjunto(datos, roto)
    }],
    ['una región pierde una fila y el manifest lo nota', () => {
      const i = man.regiones.findIndex((r) => r.cod === '14')
      const sub = subconjunto(datos, calc.filas[i].slice(1))
      const regiones = new Map(calc.regiones)
      regiones.set('14', resumenYMarginales(sub, filtroDelAmbito({ region: '14' }, man)).resumen)
      controlManifest({ ...calc, regiones }, man)
    }],
    ['el filtro del atajo ignora la comuna', () =>
      controlSubconjunto(datos, calc, { resumenDe: (d, f) => resumenYMarginales(d, { region: f.region }) })],
    ['una comuna no cuadra con el manifest', () => {
      const m = copia(man)
      m.comunas.find((c) => c.cod === '14101').n += 1
      controlManifest(calc, m)
    }],
    ['dos comunas con el mismo slug', () => {
      const m = copia(man)
      m.comunas.find((c) => c.cod === '14102').etiqueta = m.comunas.find((c) => c.cod === '14101').etiqueta
      slugsActuales(m)
    }],
    ['repo superficial', () => fechaDeLoPublicado({ git: () => 'true\n' })],
    ['una URL publicada desaparece', () =>
      revisarRegistro({ 'comuna/no-existe': '99999' }, slugsActuales(man), { registrar: true })],
    ['una URL nueva sin registrar', () => revisarRegistro({}, slugsActuales(man))],
    ['una URL publicada pasa a otro territorio', () =>
      revisarRegistro({ 'comuna/valdivia': '14102' }, slugsActuales(man), { registrar: true })],
  ]
  let rotas = 0
  for (const [nombre, romper] of casos) {
    try {
      romper()
      rotas++
      console.log(`  MAL  «${nombre}»: no saltó ningún control`)
    } catch {
      // saltó, como debe
    }
  }
  // Y el alias: una URL registrada con otro nombre para el mismo código tiene que
  // dar un alias hacia la actual, no un error.
  const { alias } = revisarRegistro({ 'comuna/valdivia-vieja': '14101' }, slugsActuales(man), { registrar: true })
  if (alias.length !== 1 || alias[0][1] !== 'comuna/valdivia') {
    rotas++
    console.log('  MAL  un nombre cambiado no produce su alias')
  }
  if (rotas) {
    console.log(`\nbuild:web: ${rotas} control(es) no saltan: el generador no protege lo que publica.`)
    process.exit(1)
  }
  console.log(`✓ build:web --negativas: ${casos.length} controles saltan y el alias se genera`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--negativas')) await negativas()
  await generar({ registrar: process.argv.includes('--registrar') })
}
