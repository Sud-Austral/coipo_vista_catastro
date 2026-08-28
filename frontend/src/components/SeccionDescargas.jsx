import { useState } from 'react'
import { fmt } from '../formato'
import { csvCifras, geojsonPuntos, guardar, nombreArchivo, urlPublicada } from '../descargas'

const TOPE_GEOJSON = 200000

/**
 * Descargas del ámbito activo.
 *
 * Se inyecta como `children` de PanelLateral y no como diez props más: el panel
 * de control sigue sin saber nada de exportar.
 *
 * NUNCA SE CALLA POR QUÉ UN BOTÓN NO FUNCIONA. Un botón gris y mudo se
 * convierte en un ticket de soporte; el motivo va escrito al lado.
 */
export default function SeccionDescargas({
  datos, filtro, resumen, manifest, ambitoTxt, nFiltrado, onReporte,
}) {
  const [estado, setEstado] = useState('')
  const [error, setError] = useState('')

  const listo = Boolean(datos && resumen && manifest)
  const motivo = !listo ? 'los datos aún se están descargando' : null

  const avisar = (texto) => {
    setEstado(texto)
    setError('')
    setTimeout(() => setEstado(''), 2500)
  }

  const bajarCifras = () => {
    try {
      const texto = csvCifras(resumen, manifest, ambitoTxt)
      const bytes = guardar(
        nombreArchivo('cifras', ambitoTxt, 'csv'),
        texto,
        'text/csv;charset=utf-8',
      )
      avisar(`Descargado · ${Math.round(bytes / 1024)} KB`)
    } catch (e) {
      setError(String(e.message ?? e))
    }
  }

  const bajarPuntos = (formato) => {
    try {
      if (formato === 'geojson') {
        const gj = geojsonPuntos(datos, filtro, manifest, ambitoTxt, TOPE_GEOJSON)
        const bytes = guardar(
          nombreArchivo('poligonos', ambitoTxt, 'geojson'),
          JSON.stringify(gj),
          'application/geo+json',
        )
        // El tamaño se dice siempre: quien está con datos móviles decide con
        // ese número, y aquí un GeoJSON de 200.000 puntos pasa de 40 MB.
        const peso = `${Math.round(bytes / 1048576)} MB`
        avisar(
          gj.catastro.truncado
            ? `Descargado · ${fmt.format(gj.features.length)} de ${fmt.format(nFiltrado)} · ${peso} (recortado)`
            : `Descargado · ${fmt.format(gj.features.length)} polígonos · ${peso}`,
        )
        return
      }
      // CSV punto a punto: se arma con el mismo recorrido, pero sin construir
      // objetos por fila.
      const m = manifest
      const et = (lista, i, sin) => (i === sin ? '' : (lista[i]?.etiqueta ?? ''))
      const filas = []
      for (let i = 0; i < datos.n && filas.length < TOPE_GEOJSON; i++) {
        if (filtro && !filtro[i]) continue
        const com = datos.comuna[i] === 65535 ? null : m.comunas[datos.comuna[i]]
        const reg = com ? m.regiones.find((r) => r.cod === com.region) : null
        filas.push([
          m.usos[datos.uso[i]]?.etiqueta ?? '',
          et(m.subusos, datos.subuso[i], 255),
          et(m.estructuras, datos.estruc[i], 255),
          et(m.tipos_forestales, datos.tifo[i], 255),
          et(m.snaspe, datos.snaspe[i], 255),
          com?.etiqueta ?? '',
          com?.provincia ?? '',
          reg?.nombre ?? '',
          reg?.anio ?? '',
          datos.ha[i].toFixed(2).replace('.', ','),
          datos.lat[i].toFixed(6).replace('.', ','),
          datos.lon[i].toFixed(6).replace('.', ','),
        ])
      }
      const cab = [
        'uso', 'subuso', 'estructura', 'tipo_forestal', 'area_protegida',
        'comuna', 'provincia', 'region',
        // El año ANTES de las hectáreas: quien ordene por superficie lo tiene
        // delante de los ojos.
        'anio_catastro',
        'superficie_ha', 'latitud', 'longitud',
      ]
      const SEP = ';'
      const texto =
        '﻿' + [cab.join(SEP), ...filas.map((f) => f.join(SEP))].join('\r\n') + '\r\n'
      const bytes = guardar(
        nombreArchivo('poligonos', ambitoTxt, 'csv'),
        texto,
        'text/csv;charset=utf-8',
      )
      avisar(`Descargado · ${fmt.format(filas.length)} filas · ${Math.round(bytes / 1024)} KB`)
    } catch (e) {
      setError(String(e.message ?? e))
    }
  }

  const recortado = nFiltrado > TOPE_GEOJSON

  return (
    <section>
      <h2>Descargar</h2>
      <p className="nota">
        Todo lo que se descarga respeta el ámbito activo: <strong>{ambitoTxt}</strong>.
      </p>

      {/* EL REPORTE VA EL PRIMERO de la sección, y no al final con los CSV: es
          lo que se lleva a una reunión. Los otros dos botones sacan datos para
          seguir trabajando; éste saca un documento para leer.

          No se deshabilita por «los datos aún se descargan» de la misma forma
          que los demás: el reporte se arma del RESUMEN, que ya existe desde el
          manifest antes de que baje el .bin. */}
      <button type="button" className="compartir" onClick={onReporte} disabled={!resumen || !manifest}>
        Reporte del ámbito (PDF)
      </button>

      <button type="button" className="limpiar" onClick={bajarCifras} disabled={!listo}>
        Cifras del ámbito (CSV)
      </button>
      {motivo && <p className="nota">No disponible: {motivo}.</p>}

      <div className="fila-descarga">
        <span>Polígonos ({fmt.format(nFiltrado)})</span>
        <span>
          <button type="button" onClick={() => bajarPuntos('csv')} disabled={!listo}>
            CSV
          </button>
          <button type="button" onClick={() => bajarPuntos('geojson')} disabled={!listo}>
            GeoJSON
          </button>
        </span>
      </div>
      {recortado && (
        // Se dice ANTES de pulsar, no después: descubrir que el archivo estaba
        // recortado al abrirlo es peor que no poder bajarlo.
        <p className="nota">
          Son más de {fmt.format(TOPE_GEOJSON)} polígonos y el archivo se recortará a esa
          cantidad. Filtra por región o comuna para llevártelos todos.
        </p>
      )}

      <p className="nota">
        El CSV usa punto y coma como separador y coma decimal, que es lo que Excel en español
        de Chile abre al doble clic. En pandas:{' '}
        <code>pd.read_csv(…, sep=&quot;;&quot;, decimal=&quot;,&quot;)</code>.
      </p>
      <p className="nota">
        También puedes descargar los datos completos sin filtrar:{' '}
        <a href={urlPublicada('manifest.json')} download>
          manifest.json
        </a>
      </p>
      <span className="aviso-copia" aria-live="polite">{estado}</span>
      {error && (
        <p className="nota aviso-error" role="alert">
          No se pudo generar el archivo: {error}
        </p>
      )}
    </section>
  )
}
