/**
 * Hornea la portada en dist/index.html. Parte de `npm run build`, después de
 * `vite build`:
 *
 *     vite build && node scripts/prerender.mjs
 *
 * Qué hace:
 *   1. Una construcción SSR APARTE de src/web/servidor.jsx en .prerender/, con la
 *      misma configuración de Vite (así hereda `base`, y el banner sale con la
 *      misma URL con hash que en el paquete del navegador).
 *   2. Lee el manifest publicado (con su esquema comprobado) y escribe:
 *        - en `<!--cabeza-->` de index.html: descripción, canonical y vista previa,
 *          generadas del manifest; ninguna cifra a mano (mejoras M8);
 *        - dentro del único `<div id="root"></div>`: la portada.
 *      Es un reemplazo de TEXTO, no un reparseo: el resto de index.html queda byte
 *      a byte. Cada marca tiene que aparecer exactamente una vez.
 *   3. Escribe con .tmp + rename y borra .prerender/.
 *
 * Sólo la portada, que sale del manifest sin recorrer el .bin: `npm run build`
 * tiene que seguir siendo rápido, porque mutaciones-visor.py compila una vez por
 * mutación. Las páginas por región y comuna las genera otro paso.
 *
 * scripts/validar-html.mjs (postbuild) comprueba el resultado, con sus negativas.
 */
import { createHash } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import { leerManifest } from './datos-node.mjs'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SALIDA = resolve(RAIZ, '.prerender')
const INDEX = resolve(RAIZ, 'dist', 'index.html')
export const VACIO = '<div id="root"></div>'
export const MARCA_CABEZA = '<!--cabeza-->'

/**
 * La versión de una vista previa: cambia exactamente cuando cambia lo que se ve
 * (título, descripción, imagen), que es lo que Facebook y LinkedIn guardan por URL.
 */
export function versionVista(titulo, descripcion, imagen) {
  return createHash('sha256').update(`${titulo}\n${descripcion}\n${imagen ?? ''}`).digest('hex').slice(0, 12)
}

/** Reemplaza `marca` por `por`, exigiendo que aparezca exactamente una vez. */
export function reemplazarUnaVez(html, marca, por) {
  const veces = html.split(marca).length - 1
  if (veces !== 1) throw new Error(`prerender: dist/index.html tiene ${veces} «${marca}»; tiene que haber exactamente una`)
  return html.replace(marca, () => por)
}

/** Construye el paquete SSR y devuelve el módulo importado. Lo reusa el generador de páginas. */
export async function construirServidor(salida = SALIDA) {
  await build({
    root: RAIZ,
    configFile: resolve(RAIZ, 'vite.config.js'),
    logLevel: 'warn',
    build: {
      ssr: resolve(RAIZ, 'src', 'web', 'servidor.jsx'),
      outDir: salida,
      emptyOutDir: true,
      copyPublicDir: false,
      rollupOptions: { output: { entryFileNames: 'servidor.mjs' } },
    },
  })
  return import(pathToFileURL(resolve(salida, 'servidor.mjs')).href)
}

async function principal() {
  const t0 = performance.now()
  try {
    const srv = await construirServidor()
    const manifest = leerManifest()
    const descripcion = srv.descripcionPortada(manifest)
    const cabeza = srv.cabezaPortada({
      canonical: srv.URL_PUBLICA,
      descripcion,
      imagen: null,
      version: versionVista(srv.TITULO, descripcion, null),
    })
    const cuerpo = srv.renderPortada({ manifest })

    let html = await readFile(INDEX, 'utf8')
    html = reemplazarUnaVez(html, MARCA_CABEZA, cabeza.join('\n    '))
    html = reemplazarUnaVez(html, VACIO, `<div id="root">${cuerpo}</div>`)
    // Atómico: un index.html a medio escribir es el sitio entero caído.
    await writeFile(`${INDEX}.tmp`, html, 'utf8')
    await rename(`${INDEX}.tmp`, INDEX)
    const ms = Math.round(performance.now() - t0)
    console.log(`✓ prerender: ${cuerpo.length.toLocaleString('es-CL')} caracteres en #root, cabeza de ${cabeza.length} etiquetas, ${ms} ms`)
  } finally {
    await rm(SALIDA, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal()
