/**
 * El .bin commiteado, cargado en Node: la misma forma de `datos` que arma
 * src/datos/binario.js en el navegador, sin fetch ni import.meta.env.
 *
 * Vivía copiado dentro de verificacion/marginales.mjs. Salió aquí porque ahora lo
 * usan tres: el oráculo del cruce, las pruebas de las cifras de la prosa y el
 * generador de páginas. Tres copias de un lector de offsets son tres sitios donde
 * un cambio de esquema abre vistas tipadas válidas sobre bytes corridos.
 *
 * Y por eso COMPRUEBA EL ESQUEMA, que la copia de marginales.mjs no hacía. Un
 * manifest de otra versión se lee sin error y da cifras PLAUSIBLES y falsas, y el
 * generador de páginas las publicaría (CLAUDE.md §4). El número vive en cuatro
 * sitios que suben juntos: ETL/build_bin.py, ETL/verificar_datos.py (D1),
 * src/datos/binario.js y este.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { derivarDeColumnas, derivarDeEspecie } from '../src/datos/derivadas.js'

export const ESQUEMA = 5
export const DATOS = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'datos')
const CTOR = { f32: Float32Array, u16: Uint16Array, u8: Uint8Array }

/** Lanza si el manifest no es del esquema que este lector entiende. */
export function exigirEsquema(man) {
  if (man?.esquema !== ESQUEMA) {
    throw new Error(`manifest.json declara esquema ${man?.esquema} y este lector entiende el ${ESQUEMA}`)
  }
}

export function leerManifest(dir = DATOS) {
  const man = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  exigirEsquema(man)
  return man
}

/** `datos` completo: columnas del .bin, las derivadas y el manifest. */
export function cargarDatos(dir = DATOS) {
  const man = leerManifest(dir)
  const capa = man.capas.cbn_puntos
  const b = readFileSync(join(dir, capa.archivo))
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  const n = capa.filas
  const datos = { n, manifest: man }
  for (const [nombre, c] of Object.entries(capa.campos)) {
    datos[nombre] = new CTOR[c.tipo](ab, c.offset, n)
  }
  // Las derivadas de la especie NO están en el .bin: las construye el mismo módulo
  // que usa el visor, para que quien lea aquí mida lo que se publica.
  Object.assign(datos, derivarDeEspecie(datos.especie, n, man))
  Object.assign(datos, derivarDeColumnas(datos, n, man))
  return datos
}
