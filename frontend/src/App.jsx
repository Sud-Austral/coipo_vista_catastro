import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  AVISO_PUNTOS,
  AVISO_SERIE,
  BASEMAPS,
  LIMITES,
  VISTA_INICIAL,
  fmt,
  fmt1,
  paletaRGB,
} from './config'
import { canalFiltro, cargarPuntos, tablaColor } from './datos/binario'
import CapaPuntos from './mapa/CapaPuntos'
import EtiquetaImagen from './components/EtiquetaImagen'
import ModalFicha from './components/ModalFicha'
import { useFechaImagen } from './hooks/useFechaImagen'

const temaOscuro = () =>
  window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches

export default function App() {
  const contenedor = useRef(null)
  const [map, setMap] = useState(null)
  const [base, setBase] = useState('Claro')
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [usos, setUsos] = useState(() => new Set())      // vacio = todos
  const [ficha, setFicha] = useState(null)
  const [oscuro, setOscuro] = useState(temaOscuro)

  // ---------- mapa ----------
  useEffect(() => {
    if (!contenedor.current) return
    const m = L.map(contenedor.current, {
      preferCanvas: true,
      // UN SOLO renderer de canvas para todas las capas vectoriales de Leaflet.
      // Con un canvas por capa solo la de encima recibe los clics, y cual queda
      // encima lo decide el orden en que terminan de descargarse las capas.
      // tolerance:8 es la brocha de acierto para el dedo.
      renderer: L.canvas({ padding: 0.5, tolerance: 8 }),
      // deck.gl obedece la vista de Leaflet, y durante la animacion de zoom
      // Leaflet informa del zoom DESTINO mientras el mapa base aun se escala:
      // los puntos se adelantarian. Es el coste conocido de este patron.
      zoomAnimation: false,
      center: VISTA_INICIAL.center,
      zoom: VISTA_INICIAL.zoom,
      minZoom: 3,
      maxBounds: LIMITES,
      maxBoundsViscosity: 0.5,
      zoomControl: false,
      attributionControl: true,
    })
    L.control.zoom({ position: 'topleft', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(m)
    L.control.scale({ imperial: false }).addTo(m)
    setMap(m)
    return () => {
      m.remove()
      setMap(null) // el cleanup DEBE dejarlo en null: StrictMode monta dos veces
    }
  }, [])

  // ---------- mapa base ----------
  useEffect(() => {
    if (!map) return
    const cfg = BASEMAPS[base] ?? BASEMAPS.Claro
    const capa = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
      maxNativeZoom: cfg.maxNativeZoom,
    })
    capa.addTo(map)
    return () => capa.remove()
  }, [map, base])

  // ---------- tema ----------
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const alCambiar = (e) => setOscuro(e.matches)
    mq.addEventListener('change', alCambiar)
    return () => mq.removeEventListener('change', alCambiar)
  }, [])

  // ---------- datos ----------
  useEffect(() => {
    const ctrl = new AbortController()
    cargarPuntos(paletaRGB(oscuro ? 'oscuro' : 'claro'), ctrl.signal)
      .then(setDatos)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e)
      })
    return () => ctrl.abort()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const paleta = useMemo(() => {
    if (!datos) return null
    return tablaColor(datos.uso, datos.n, paletaRGB(oscuro ? 'oscuro' : 'claro'))
  }, [datos, oscuro])

  const filtro = useMemo(() => {
    if (!datos) return null
    return canalFiltro(datos.uso, datos.n, usos)
  }, [datos, usos])

  const fuenteFecha = BASEMAPS[base]?.fecha ?? null
  const fechaEsri = useFechaImagen(map, fuenteFecha?.tipo === 'esri')
  const imagen =
    fuenteFecha?.tipo === 'fijo' ? { estado: 'fijo', texto: fuenteFecha.texto } : fechaEsri

  // ---------- interaccion ----------
  const alternarUso = useCallback((i) => {
    setUsos((prev) => {
      const s = new Set(prev)
      if (s.has(i)) s.delete(i)
      else s.add(i)
      return s
    })
  }, [])

  const alPunto = useCallback(
    (i) => {
      if (!datos) return
      const cat = datos.manifest.usos[datos.uso[i]]
      setFicha({
        capa: 'Catastro de Bosque Nativo',
        titulo: cat?.etiqueta ?? 'Sin clasificar',
        color: (oscuro ? paletaRGB('oscuro') : paletaRGB('claro'))[datos.uso[i]]
          ? `rgb(${(oscuro ? paletaRGB('oscuro') : paletaRGB('claro'))[datos.uso[i]].join(',')})`
          : undefined,
        coord: [datos.lat[i].toFixed(6), datos.lon[i].toFixed(6)],
        filas: [
          ['Uso de suelo', cat?.etiqueta ?? '—'],
          ['Código oficial', cat?.id ?? '—'],
          ['Clase IPCC', cat?.ipcc ?? '—'],
          ['Superficie del polígono', `${fmt1.format(datos.ha[i])} ha`],
          ['Latitud', datos.lat[i].toFixed(6)],
          ['Longitud', datos.lon[i].toFixed(6)],
        ],
      })
    },
    [datos, oscuro],
  )

  const resumen = useMemo(() => {
    if (!datos) return null
    const activos = usos.size ? datos.manifest.usos.filter((_, i) => usos.has(i)) : datos.manifest.usos
    return {
      n: activos.reduce((a, u) => a + u.n, 0),
      ha: activos.reduce((a, u) => a + u.ha, 0),
    }
  }, [datos, usos])

  if (error) {
    return (
      <main className="pantalla-error">
        <h1>No se pudieron cargar los datos del Catastro</h1>
        <p>El visor no puede mostrar nada sin ellos, así que prefiere decirlo a fingir.</p>
        <details>
          <summary>Detalle técnico</summary>
          <pre>{String(error.message ?? error)}</pre>
        </details>
      </main>
    )
  }

  return (
    <div className="app" data-cargando={datos ? 'no' : 'si'}>
      <header className="banner">
        <div className="banner-txt">
          <h1>Catastro de Usos de la Tierra y Recursos Vegetacionales</h1>
          <p>
            Catastro de Bosque Nativo · CONAF ·{' '}
            {datos ? `${fmt.format(datos.n)} polígonos` : 'cargando…'}
          </p>
        </div>
      </header>

      <aside className="panel" aria-label="Leyenda y filtros">
        <section>
          <h2>Uso de suelo</h2>
          <p className="bajada">
            Pulsa una clase para aislarla en el mapa. El color no es la única marca: la leyenda,
            el nombre al pasar por encima y esta tabla dicen lo mismo.
          </p>
          <ul className="leyenda">
            {datos?.manifest.usos.map((u, i) => {
              const activo = usos.size === 0 || usos.has(i)
              const rgb = (oscuro ? paletaRGB('oscuro') : paletaRGB('claro'))[i]
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    className={activo ? 'clase' : 'clase apagada'}
                    aria-pressed={usos.has(i)}
                    onClick={() => alternarUso(i)}
                  >
                    <span className="chip" style={{ background: `rgb(${rgb.join(',')})` }} />
                    <span className="nombre">{u.etiqueta}</span>
                    <span className="cifra">{fmt.format(Math.round(u.ha))} ha</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {usos.size > 0 && (
            <button type="button" className="limpiar" onClick={() => setUsos(new Set())}>
              Ver todas las clases
            </button>
          )}
        </section>

        <section>
          <h2>Mapa base</h2>
          <label className="campo">
            <span>Imagen de fondo</span>
            <select value={base} onChange={(e) => setBase(e.target.value)}>
              {Object.keys(BASEMAPS).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          {base === 'Sentinel-2' && (
            <p className="nota">
              Compuesto anual sin nubes a 10 m de resolución, no la última pasada del satélite.
              Licencia CC BY-NC-SA 4.0 (no comercial).
            </p>
          )}
        </section>

        <section>
          <h2>Ámbito</h2>
          <p className="cifra-grande">{resumen ? fmt.format(Math.round(resumen.ha)) : '—'} ha</p>
          <p className="bajada">{resumen ? fmt.format(resumen.n) : '—'} polígonos</p>
          <p className="nota">{AVISO_PUNTOS}</p>
          <p className="nota">{AVISO_SERIE}</p>
        </section>
      </aside>

      <main className="mapa" ref={contenedor} aria-label="Mapa del Catastro" />

      {map && datos && paleta && filtro && (
        <CapaPuntos map={map} datos={datos} paleta={paleta} filtro={filtro} onPunto={alPunto} />
      )}
      <EtiquetaImagen map={map} info={imagen} />
      <ModalFicha ficha={ficha} onCerrar={() => setFicha(null)} />

      {!datos && (
        <p className="descargando" role="status">
          Descargando 1.827.933 polígonos del Catastro nacional…
        </p>
      )}
    </div>
  )
}
