import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import {
  ANCHO_KPI,
  ANCHO_PANEL,
  BASEMAPS,
  CORTE_KPI,
  CORTE_PANEL,
  LIMITES,
  MAX_KPI,
  MAX_PANEL,
  MIN_MAPA,
  MIN_PANEL,
  VISTA_INICIAL,
  paletaRGB,
} from './config'
import { canalFiltro, cargarPuntos, tablaColor } from './datos/binario'
import { resumenFiltrado, resumenNacional } from './indicadores'
import { guardarDisposicion, leerDisposicion } from './preferencias'
import CapaPuntos from './mapa/CapaPuntos'
import EtiquetaImagen from './components/EtiquetaImagen'
import ModalFicha from './components/ModalFicha'
import PanelIndicadores from './components/PanelIndicadores'
import PanelLateral from './components/PanelLateral'
import Tirador from './components/Tirador'
import { IconoIndicadores } from './components/graficos'
import { useFechaImagen } from './hooks/useFechaImagen'
import { fmt, haExacta } from './formato'

/**
 * Régimen de disposición, que decide si la X pliega una pista o cierra un cajón:
 *   1 · los dos paneles anclados          (> CORTE_KPI)
 *   2 · izquierdo anclado, derecho cajón  (> CORTE_PANEL)
 *   3 · los dos en cajón
 * ACOPLADO a las media queries de App.css. La duplicación es inevitable —una
 * media query no puede leer una constante de JS—; lo que no es inevitable es que
 * se desincronicen, y por eso .app publica data-regimen.
 */
const regimenDe = (ancho) => (ancho > CORTE_KPI ? 1 : ancho > CORTE_PANEL ? 2 : 3)

// Objeto MUTABLE a propósito: guarda la última disposición elegida con los
// paneles anclados, para poder restaurarla al volver de un régimen de cajón.
const disposicion = leerDisposicion()

const temaOscuro = () =>
  window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches

export default function App() {
  const contenedor = useRef(null)
  const [map, setMap] = useState(null)
  const [base, setBase] = useState('Claro')
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [oscuro, setOscuro] = useState(temaOscuro)
  const [ambito, setAmbito] = useState({ region: null, provincia: null, comuna: null })
  const [usosActivos, setUsosActivos] = useState(() => new Set())
  const [ficha, setFicha] = useState(null)

  // ---------- disposición de los paneles ----------
  // Un solo booleano por panel para los dos regímenes: anclado significa que su
  // pista de la rejilla mide 0, y en cajón significa que el cajón está cerrado.
  // Anclado nace como quedó la última vez; en cajón nace SIEMPRE cerrado, o al
  // estrechar la ventana aparecerían dos cajones tapando el mapa sin pedirlo.
  const [regimen, setRegimen] = useState(() => regimenDe(window.innerWidth))
  const panelAnclado = regimen < 3
  const kpiAnclado = regimen < 2
  const [panelVisible, setPanelVisible] = useState(
    () => regimenDe(window.innerWidth) < 3 && disposicion.panel,
  )
  const [kpiVisible, setKpiVisible] = useState(
    () => regimenDe(window.innerWidth) < 2 && disposicion.kpi,
  )
  const [anchoPanel, setAnchoPanel] = useState(disposicion.ancho)
  const [anchoKpi, setAnchoKpi] = useState(disposicion.anchoKpi)
  const [redimensionando, setRedimensionando] = useState(false)

  // ---------- mapa ----------
  useEffect(() => {
    if (!contenedor.current) return
    const m = L.map(contenedor.current, {
      preferCanvas: true,
      // UN SOLO renderer de canvas para todas las capas vectoriales de Leaflet.
      // Con un canvas por capa sólo la de encima recibe los clics, y cuál queda
      // encima lo decide el orden en que terminan de descargarse las capas.
      renderer: L.canvas({ padding: 0.5, tolerance: 8 }),
      // deck.gl obedece la vista de Leaflet, y durante la animación de zoom
      // Leaflet informa del zoom DESTINO mientras el mapa base aún se escala:
      // los puntos se adelantarían. Es el coste conocido de este patrón.
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

  // El mapa tiene que recalcular su tamaño cuando la rejilla cambia de forma.
  // Sin esto, plegar un panel deja a Leaflet dibujando sobre el tamaño anterior
  // y aparecen bandas grises donde deberían estar las teselas.
  useEffect(() => {
    if (!map) return
    const t = setTimeout(() => map.invalidateSize(), 60)
    return () => clearTimeout(t)
  }, [map, panelVisible, kpiVisible, anchoPanel, anchoKpi, regimen])

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
    const al = (e) => setOscuro(e.matches)
    mq.addEventListener('change', al)
    return () => mq.removeEventListener('change', al)
  }, [])

  // ---------- régimen ----------
  // matchMedia y no un listener de resize: se despierta sólo al CRUZAR el corte,
  // no en cada píxel de un arrastre de ventana.
  useEffect(() => {
    const anclaKpi = window.matchMedia(`(min-width: ${CORTE_KPI + 1}px)`)
    const anclaPanel = window.matchMedia(`(min-width: ${CORTE_PANEL + 1}px)`)
    const al = () => setRegimen(anclaKpi.matches ? 1 : anclaPanel.matches ? 2 : 3)
    anclaKpi.addEventListener('change', al)
    anclaPanel.addEventListener('change', al)
    al()
    return () => {
      anclaKpi.removeEventListener('change', al)
      anclaPanel.removeEventListener('change', al)
    }
  }, [])

  // Al pasar a cajón se cierra; al volver a anclado se restaura lo que había.
  // Se salta el primer render, que ya nació coherente.
  const primerRegimen = useRef(true)
  useEffect(() => {
    if (primerRegimen.current) {
      primerRegimen.current = false
      return
    }
    setPanelVisible(panelAnclado && disposicion.panel)
    setKpiVisible(kpiAnclado && disposicion.kpi)
  }, [panelAnclado, kpiAnclado])

  // ---------- mostrar y ocultar ----------
  // Abrir y cerrar un CAJÓN no es una preferencia de disposición: sólo se
  // recuerda lo que se elige con el panel anclado.
  const mostrarPanel = useCallback((v) => {
    setPanelVisible(v)
    if (panelAnclado) {
      disposicion.panel = v
      guardarDisposicion(disposicion)
    }
  }, [panelAnclado])
  const mostrarKpi = useCallback((v) => {
    setKpiVisible(v)
    if (kpiAnclado) {
      disposicion.kpi = v
      guardarDisposicion(disposicion)
    }
  }, [kpiAnclado])

  // Ocultar un panel devuelve el foco al botón que lo recupera. Sin esto el foco
  // se queda dentro de un subárbol que acaba de volverse invisible y el
  // siguiente Tab reempieza desde el principio del documento.
  //
  // El foco NO se puede pedir en el mismo manejador: el botón está display:none
  // hasta que React aplica la clase, y focus() sobre un elemento sin caja no
  // hace nada. Por eso se apunta a quién enfocar y se hace en un efecto.
  const btnPanel = useRef(null)
  const btnKpi = useRef(null)
  const aEnfocar = useRef(null)
  useEffect(() => {
    if (!aEnfocar.current) return
    const boton = aEnfocar.current === 'panel' ? btnPanel.current : btnKpi.current
    aEnfocar.current = null
    boton?.focus()
  }, [panelVisible, kpiVisible])

  const cerrarPanel = useCallback(() => {
    aEnfocar.current = 'panel'
    mostrarPanel(false)
  }, [mostrarPanel])
  const cerrarKpi = useCallback(() => {
    aEnfocar.current = 'kpi'
    mostrarKpi(false)
  }, [mostrarKpi])

  // Escape cierra sólo CAJONES. Anclado, plegar un panel no es «salir» de nada y
  // hacerlo con Escape sería una sorpresa: el mapa se reordenaría bajo el cursor
  // al pulsar una tecla que se asocia a cancelar.
  useEffect(() => {
    const hayCajon = (!panelAnclado && panelVisible) || (!kpiAnclado && kpiVisible)
    if (!hayCajon) return
    const al = (e) => {
      if (e.key !== 'Escape') return
      // ModalFicha es un <dialog> modal: el navegador ya cierra con Escape y su
      // keydown burbujea hasta aquí. Sin esta guarda, un Escape cerraría la
      // ficha Y el cajón de debajo de una vez.
      if (document.querySelector('dialog[open]')) return
      if (!kpiAnclado && kpiVisible) cerrarKpi()
      else cerrarPanel()
    }
    window.addEventListener('keydown', al)
    return () => window.removeEventListener('keydown', al)
  }, [panelAnclado, kpiAnclado, panelVisible, kpiVisible, cerrarPanel, cerrarKpi])

  // ---------- ancho de los paneles ----------
  // El ancho de ventana entra como ESTADO y no se lee en el render: `regimen`
  // sólo cambia al cruzar un corte, así que estirar la ventana de 1300 a 1900
  // dejaría el techo del tirador congelado en el valor de 1300.
  const [anchoVentana, setAnchoVentana] = useState(() => window.innerWidth)
  useEffect(() => {
    let pendiente = 0
    const al = () => {
      cancelAnimationFrame(pendiente)
      pendiente = requestAnimationFrame(() => setAnchoVentana(window.innerWidth))
    }
    window.addEventListener('resize', al)
    return () => {
      cancelAnimationFrame(pendiente)
      window.removeEventListener('resize', al)
    }
  }, [])

  // El techo es DINÁMICO y no MAX_PANEL a secas: con los dos paneles anclados a
  // 1201 px, 560 de panel dejarían 321 px de mapa. Acotarlo aquí es lo que hace
  // que el tirador no pueda violar el suelo del mapa. Cada techo descuenta el
  // ancho REAL del otro panel: los dos tiradores comparten el mismo suelo y el
  // acuerdo entre ambos es este par de fórmulas.
  const maxPanel = Math.max(
    MIN_PANEL,
    Math.min(MAX_PANEL, anchoVentana - MIN_MAPA - (kpiAnclado && kpiVisible ? anchoKpi : 0)),
  )
  const maxKpi = Math.max(
    ANCHO_KPI,
    Math.min(MAX_KPI, anchoVentana - MIN_MAPA - (panelAnclado && panelVisible ? anchoPanel : 0)),
  )

  const cambiarAncho = useCallback((px) => {
    const v = Math.round(Math.min(maxPanel, Math.max(MIN_PANEL, px)))
    setAnchoPanel(v)
    disposicion.ancho = v
    guardarDisposicion(disposicion)
  }, [maxPanel])
  const cambiarAnchoKpi = useCallback((px) => {
    const v = Math.round(Math.min(maxKpi, Math.max(ANCHO_KPI, px)))
    setAnchoKpi(v)
    disposicion.anchoKpi = v
    guardarDisposicion(disposicion)
  }, [maxKpi])

  // Al encoger la ventana el techo baja, y un ancho guardado mayor dejaría el
  // mapa por debajo de su suelo sin que nadie haya tocado el tirador. Los dos
  // efectos sólo ENCOGEN, así que convergen.
  useEffect(() => setAnchoKpi((a) => Math.min(a, maxKpi)), [maxKpi])
  useEffect(() => setAnchoPanel((a) => Math.min(a, maxPanel)), [maxPanel])

  // ---------- datos ----------
  useEffect(() => {
    const ctrl = new AbortController()
    cargarPuntos(ctrl.signal)
      .then(setDatos)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e)
      })
    return () => ctrl.abort()
  }, [])

  const manifest = datos?.manifest ?? null

  // Índices de comuna que caen dentro del ámbito. Un Set vacío significa «todas»,
  // no «ninguna».
  const comunasDelAmbito = useMemo(() => {
    if (!manifest || !ambito.region) return new Set()
    const s = new Set()
    manifest.comunas.forEach((c, i) => {
      if (c.region !== ambito.region) return
      if (ambito.provincia && c.provincia !== ambito.provincia) return
      if (ambito.comuna && c.cod !== ambito.comuna) return
      s.add(i)
    })
    return s
  }, [manifest, ambito])

  const hayFiltro = usosActivos.size > 0 || comunasDelAmbito.size > 0

  const filtro = useMemo(
    () => (datos ? canalFiltro(datos, { usos: usosActivos, comunas: comunasDelAmbito }) : null),
    [datos, usosActivos, comunasDelAmbito],
  )

  const paleta = useMemo(
    () => (datos ? tablaColor(datos.uso, datos.n, paletaRGB(oscuro ? 'oscuro' : 'claro')) : null),
    [datos, oscuro],
  )

  // El resumen nacional sale del manifest y el filtrado de una pasada sobre el
  // .bin. Los dos tienen la MISMA forma, así que el panel tiene un solo camino.
  const nacional = useMemo(() => resumenNacional(manifest), [manifest])
  const resumen = useMemo(
    () => (hayFiltro ? resumenFiltrado(datos, filtro) : nacional),
    [datos, filtro, hayFiltro, nacional],
  )

  const fuenteFecha = BASEMAPS[base]?.fecha ?? null
  const fechaEsri = useFechaImagen(map, fuenteFecha?.tipo === 'esri')
  const imagen =
    fuenteFecha?.tipo === 'fijo' ? { estado: 'fijo', texto: fuenteFecha.texto } : fechaEsri

  const alternarUso = useCallback((i) => {
    setUsosActivos((prev) => {
      const s = new Set(prev)
      if (s.has(i)) s.delete(i)
      else s.add(i)
      return s
    })
  }, [])

  const alPunto = useCallback(
    (i) => {
      if (!datos) return
      const m = datos.manifest
      const et = (lista, idx, sin) => (idx === sin ? null : lista[idx]?.etiqueta ?? null)
      const uso = m.usos[datos.uso[i]]
      const com = datos.comuna[i] === 65535 ? null : m.comunas[datos.comuna[i]]
      const reg = com ? m.regiones.find((r) => r.cod === com.region) : null
      const filas = [
        ['Uso de suelo', uso?.etiqueta ?? '—'],
        ['Subuso', et(m.subusos, datos.subuso[i], 255) ?? '—'],
        ['Estructura', et(m.estructuras, datos.estruc[i], 255) ?? 'no aplica'],
        ['Tipo forestal', et(m.tipos_forestales, datos.tifo[i], 255) ?? 'no aplica'],
        ['Área protegida', et(m.snaspe, datos.snaspe[i], 255) ?? 'fuera del SNASPE'],
        ['Comuna', com ? `${com.etiqueta} (${com.provincia})` : 'sin dato'],
        ['Región', reg ? `${reg.nombre} · catastro ${reg.anio}` : '—'],
        ['Superficie del polígono', haExacta(datos.ha[i])],
      ]
      setFicha({
        capa: 'Catastro de Bosque Nativo',
        titulo: uso?.etiqueta ?? 'Sin clasificar',
        coord: [datos.lat[i].toFixed(6), datos.lon[i].toFixed(6)],
        filas,
      })
    },
    [datos],
  )

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

  const clases = [
    'app',
    panelVisible ? '' : 'sin-panel',
    kpiVisible ? '' : 'sin-kpi',
    redimensionando ? 'redimensionando' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={clases}
      // data-regimen lo publica JS para que la verificación pueda comprobar que
      // coincide con el número de pistas que resuelve el CSS: los cortes viven
      // en los dos sitios y esa duplicación es la que hay que vigilar.
      data-regimen={regimen}
      style={{
        // La variable en línea SÓLO cuando cada panel se ve. Plegar es cosa de
        // las clases .sin-panel/.sin-kpi, y un estilo en línea les ganaría en
        // especificidad: el panel no se plegaría nunca.
        ...(panelVisible && { '--pista-panel': `${anchoPanel}px` }),
        ...(kpiVisible && { '--pista-kpi': `${anchoKpi}px` }),
      }}
    >
      <header className="banner">
        <div className="banner-txt">
          <h2>Catastro de Usos de la Tierra y Recursos Vegetacionales</h2>
          <p>CONAF · {datos ? `${fmt.format(datos.n)} polígonos` : 'cargando…'}</p>
        </div>
      </header>

      <button
        ref={btnPanel}
        type="button"
        className="abrir"
        onClick={() => mostrarPanel(true)}
        aria-label="Abrir panel de control"
        aria-expanded={panelVisible}
        aria-controls="panel-control"
      >
        ☰
      </button>

      <PanelLateral
        manifest={manifest}
        resumen={resumen}
        ambito={ambito}
        onAmbito={setAmbito}
        base={base}
        onBase={setBase}
        usosActivos={usosActivos}
        onUso={alternarUso}
        onLimpiarUsos={() => setUsosActivos(new Set())}
        abierto={panelVisible}
        onCerrar={cerrarPanel}
        oscuro={oscuro}
      />

      {/* Hermano del panel y no hijo suyo: .panel scrollea, y dentro quedaba
          recortado por su overflow y se iba con el scroll. */}
      <Tirador
        ancho={anchoPanel}
        min={MIN_PANEL}
        max={maxPanel}
        onAncho={cambiarAncho}
        onArrastre={setRedimensionando}
        reposo={ANCHO_PANEL}
      />

      <main className="mapa" ref={contenedor} aria-label="Mapa del Catastro" />

      {/* DESPUÉS de .mapa a propósito: la rejilla coloca por orden del DOM y
          ésta es la tercera columna. */}
      <div className="funda-kpi">
        <PanelIndicadores
          resumen={resumen}
          manifest={manifest}
          ambito={ambito}
          abierto={kpiVisible}
          cargando={!datos}
          onCerrar={cerrarKpi}
          onUso={alternarUso}
          usosActivos={usosActivos}
          oscuro={oscuro}
        />
      </div>

      {/* El gemelo derecho: mismo componente con la geometría espejada. Sólo
          existe anclado; en cajón el ancho es fijo. */}
      <Tirador
        lado="der"
        objetivo="panel-indicadores"
        etiqueta="Ancho del panel de indicadores"
        ancho={anchoKpi}
        min={ANCHO_KPI}
        max={maxKpi}
        reposo={ANCHO_KPI}
        onAncho={cambiarAnchoKpi}
        onArrastre={setRedimensionando}
      />

      <button
        ref={btnKpi}
        type="button"
        className="abrir-kpi"
        onClick={() => mostrarKpi(true)}
        aria-label="Abrir indicadores"
        aria-expanded={kpiVisible}
        aria-controls="panel-indicadores"
      >
        <IconoIndicadores />
      </button>

      {map && datos && paleta && filtro && (
        <CapaPuntos map={map} datos={datos} paleta={paleta} filtro={filtro} onPunto={alPunto} />
      )}
      <EtiquetaImagen map={map} info={imagen} />
      <ModalFicha ficha={ficha} onCerrar={() => setFicha(null)} />

      {!datos && (
        <p className="descargando" role="status">
          Descargando el Catastro nacional…
        </p>
      )}
    </div>
  )
}
