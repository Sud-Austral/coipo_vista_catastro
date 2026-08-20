/**
 * Descarga del ámbito activo: CSV para Excel y GeoJSON para SIG.
 *
 * Sin dependencias: Blob + URL.createObjectURL + un <a download> sintético.
 *
 * DECISIONES DE FORMATO, y ninguna es de gusto:
 *
 *  - Separador ';' y coma decimal. Es lo que Excel en es-CL parsea al doble
 *    clic. Con ',' de separador y '.' de decimal, cada superficie se parte en
 *    dos columnas o se lee como texto, y este archivo existe para abrirse en
 *    Excel.
 *  - BOM UTF-8. Sin él, Windows lee el archivo en su página de códigos ANSI y
 *    «Biobío», «Ñuble» y «Aysén» salen rotos. Es el detalle que decide si el
 *    archivo sirve o no.
 *  - `anio_catastro` va ANTES de la primera columna de hectáreas. No es un
 *    capricho de orden: quien abre el CSV y ordena por superficie tiene el año
 *    delante de los ojos, y esa columna hace sola el trabajo de la advertencia
 *    de que el Catastro no es una serie temporal.
 */

import { DATA } from './config'

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const SEP = ';'
const BOM = '﻿'

/**
 * Escapado RFC 4180 más guardia contra inyección de fórmulas: un campo que
 * empieza por = + @ TAB o CR lo EJECUTA Excel al abrir. Los datos vienen de
 * planillas de terceros, así que la guardia no es teórica.
 * El '-' NO se prefija: los números negativos son legítimos.
 */
function celda(v) {
  if (v == null) return ''
  let s = String(v)
  if (/^[=+@\t\r]/.test(s)) s = `'${s}`
  return /[";\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Número con coma decimal. Nulo se queda VACÍO, nunca 0: «sin dato» es una
 *  categoría real y escribir 0 sería inventar una medición. */
const num = (v, dec = 2) => (v == null ? '' : v.toFixed(dec).replace('.', ','))

export function aCSV(cabeceras, filas) {
  const lineas = [cabeceras.map(celda).join(SEP)]
  for (const f of filas) lineas.push(f.map(celda).join(SEP))
  return BOM + lineas.join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------------------
// Nombres de archivo
// ---------------------------------------------------------------------------

export const slug = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

/** Fecha LOCAL en ISO. `toISOString()` daría UTC y en Chile adelantaría el día
 *  durante las últimas horas de la tarde. */
export const hoy = () => new Date().toLocaleDateString('en-CA')

export function nombreArchivo(que, ambitoTxt, ext) {
  return `catastro_${slug(que)}_${slug(ambitoTxt) || 'nacional'}_${hoy()}.${ext}`
}

// ---------------------------------------------------------------------------
// Guardar
// ---------------------------------------------------------------------------

export function guardar(nombre, contenido, tipo) {
  const blob = new Blob([contenido], { type: tipo })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  // Firefox exige que el <a> esté EN el documento para que el clic descargue.
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revocar de inmediato aborta la descarga en Chrome: el navegador aún no ha
  // leído el blob cuando el clic vuelve.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return blob.size
}

// ---------------------------------------------------------------------------
// Las dos descargas
// ---------------------------------------------------------------------------

/**
 * Las cifras que el panel muestra, tal cual, con TODOS los decimales.
 *
 * El panel abrevia («15,5 M ha») porque a dos decimales una columna de nueve
 * filas es inescaneable; el CSV es justo donde vive la precisión de auditoría.
 */
export function csvCifras(resumen, manifest, ambitoTxt) {
  const filas = []
  const bloque = (titulo, lista, extra = () => []) => {
    for (const d of lista) {
      filas.push([titulo, d.cod ?? '', d.etiqueta ?? d.nombre ?? '', ...extra(d),
                  d.n, num(d.ha)])
    }
  }
  // El año va antes de las hectáreas, a propósito (ver la cabecera del módulo).
  const anioDe = (cod) => manifest.regiones.find((r) => r.cod === cod)?.anio ?? ''

  bloque('Uso de suelo', resumen.usos, () => [''])
  bloque('Subuso', resumen.subusos, () => [''])
  bloque('Estructura', resumen.estructuras, () => [''])
  bloque('Tipo forestal', resumen.tiposForestales, () => [''])
  bloque('Área protegida', resumen.snaspe, (d) => [d.categoria ?? ''])
  for (const r of resumen.regiones) {
    filas.push(['Región', r.cod, r.nombre, r.anio, r.n, num(r.ha)])
  }
  for (const c of resumen.comunas) {
    filas.push(['Comuna', c.cod, c.etiqueta, anioDe(c.region), c.n, num(c.ha)])
  }

  const cabecera = [
    `# Catastro de Usos de la Tierra y Recursos Vegetacionales · CONAF`,
    `# Ámbito: ${ambitoTxt}`,
    `# ADVERTENCIA: cada región se catastró en un año distinto, entre 2014 y 2024.`,
    `# El Catastro no es una serie temporal: comparar regiones compara años distintos.`,
    `# Datos sha256 ${manifest.capas.cbn_puntos.sha256}`,
    `# Descargado el ${hoy()}`,
  ].join('\r\n')

  return (
    BOM +
    cabecera +
    '\r\n' +
    aCSV(
      ['dimension', 'codigo', 'etiqueta', 'anio_catastro', 'poligonos', 'hectareas'],
      filas,
    ).slice(1) // el BOM ya va arriba
  )
}

/**
 * Los polígonos del ámbito, punto a punto.
 *
 * GeoJSON con ETIQUETA Y CÓDIGO a la vez: la etiqueta para leerlo, el código
 * para cruzarlo. Y SIN miembro `crs`: la RFC 7946 obliga a WGS84 y prohíbe
 * declararlo, así que ponerlo es un error, no una precaución.
 */
export function geojsonPuntos(datos, mascara, manifest, ambitoTxt, tope = 200000) {
  const m = manifest
  const et = (lista, i, sin) => (i === sin ? null : lista[i]?.etiqueta ?? null)
  const feats = []
  for (let i = 0; i < datos.n && feats.length < tope; i++) {
    if (mascara && !mascara[i]) continue
    const com = datos.comuna[i] === 65535 ? null : m.comunas[datos.comuna[i]]
    const reg = com ? m.regiones.find((r) => r.cod === com.region) : null
    feats.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        // 6 decimales ≈ 0,11 m. Más no significa nada: el dato es un centroide
        // en float32, cuyo error de cuantización ya es de ~0,5 m.
        coordinates: [Number(datos.lon[i].toFixed(6)), Number(datos.lat[i].toFixed(6))],
      },
      properties: {
        uso: m.usos[datos.uso[i]]?.etiqueta ?? null,
        uso_cod: m.usos[datos.uso[i]]?.cod ?? null,
        subuso: et(m.subusos, datos.subuso[i], 255),
        estructura: et(m.estructuras, datos.estruc[i], 255),
        tipo_forestal: et(m.tipos_forestales, datos.tifo[i], 255),
        area_protegida: et(m.snaspe, datos.snaspe[i], 255),
        comuna: com?.etiqueta ?? null,
        comuna_cod: com?.cod ?? null,
        provincia: com?.provincia ?? null,
        region: reg?.nombre ?? null,
        region_cod: reg?.cod ?? null,
        anio_catastro: reg?.anio ?? null,
        superficie_ha: Number(datos.ha[i].toFixed(2)),
      },
    })
  }
  return {
    type: 'FeatureCollection',
    // Miembro foráneo con la procedencia: lo permite la RFC y es lo que hace
    // que el archivo siga sabiendo de dónde salió tres meses después.
    catastro: {
      fuente: 'Catastro de Usos de la Tierra y Recursos Vegetacionales · CONAF',
      ambito: ambitoTxt,
      aviso:
        'Cada punto es el centroide de un polígono, no una parcela ni un predio. ' +
        'Cada región se catastró en un año distinto entre 2014 y 2024. ' +
        'El Catastro no registra propiedad.',
      sha256: manifest.capas.cbn_puntos.sha256,
      descargado: hoy(),
      url: typeof window !== 'undefined' ? window.location.href : null,
      truncado: feats.length >= tope,
    },
    features: feats,
  }
}

export const urlPublicada = (archivo) => `${DATA}/${archivo}`
