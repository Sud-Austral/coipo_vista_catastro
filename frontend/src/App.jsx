import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import {
  ANCHO_KPI,
  DATA,
  ANCHO_PANEL,
  BASEMAPS,
  COLOR_USO,
  CORTE_KPI,
  CORTE_PANEL,
  AVISO_PUNTOS,
  LIMITES,
  MAX_KPI,
  MAX_PANEL,
  MIN_MAPA,
  MIN_PANEL,
  VISTA_INICIAL,
  paletaRGB,
} from './config'
import { cargarPuntos, mascaraTodo, tablaColor } from './datos/binario'
import { ambitoTexto, resumenNacional, resumenYMarginales } from './indicadores'
import { alternar, filtrosAURL, filtrosDesdeURL } from './filtros'
import { guardarDisposicion, leerDisposicion } from './preferencias'
import { escribirURL, leerURL } from './urlState'
import CapaPuntos from './mapa/CapaPuntos'
import EtiquetaImagen from './components/EtiquetaImagen'
import ModalFicha from './components/ModalFicha'
import Banner from './components/Banner'
import CartelContexto from './components/CartelContexto'
import PaginaMetodologia from './components/PaginaMetodologia'
import PanelIndicadores from './components/PanelIndicadores'
import PanelLateral from './components/PanelLateral'
import SeccionDescargas from './components/SeccionDescargas'
import Tirador from './components/Tirador'
import { IconoIndicadores } from './components/graficos'
import { useFechaImagen } from './hooks/useFechaImagen'
import { haExacta } from './formato'

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

// El estado compartible se lee UNA vez, al arrancar. A partir de ahí manda el
// estado de React y la URL sólo lo refleja.
const inicial = leerURL()

const temaOscuro = () =>
  window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches

/**
 * Quien pidió menos movimiento en su sistema lo pidió para todo, no sólo para el
 * CSS. Las animaciones de Leaflet son JS y no las apaga ninguna media query, así
 * que hay que consultarlo aquí y pasárselo al mapa.
 */
const menosMovimiento = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Tope de acercamiento del encuadre automatico. 123 clases del vocabulario
 * devuelven un solo punto y su caja tiene area cero: sin tope el mapa se iria al
 * zoom maximo de la capa sobre un centroide suelto, y los fondos se quedan sin
 * tesela nativa entre z13 y z16.
 */
const MAX_ZOOM_ENCUADRE = 11
/** Margen del encuadre, en pixeles. */
const PADDING_ENCUADRE = [24, 24]
/**
 * Cuanto se puede desplazar el centro sin que valga la pena volar. Son los
 * mismos 24 px del margen a proposito: por debajo del margen que el encuadre
 * deja, el encuadre no esta afirmando nada.
 */
const HOLGURA_ENCUADRE = 24

export default function App() {
  const contenedor = useRef(null)
  const [map, setMap] = useState(null)
  const [base, setBase] = useState(inicial.base ?? 'Claro')
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [oscuro, setOscuro] = useState(temaOscuro)
  const [ambito, setAmbito] = useState(inicial.ambito)
  const [usosActivos, setUsosActivos] = useState(() => new Set())
  // Las OTRAS ocho dimensiones, en un solo objeto {columna: Set de índices}.
  // Aparte de `usosActivos` porque el uso tiene control propio —la leyenda, que
  // es la única dimensión con color— y comparten destino pero no origen.
  const [filtros, setFiltros] = useState(() => ({}))
  const [ficha, setFicha] = useState(null)
  // Aviso hablado para la ruta de teclado. Lleva CONTADOR porque una región
  // aria-live no vuelve a anunciar un texto idéntico: dos Enter seguidos en
  // vacío serían mudos, que se lee igual que «el teclado no hace nada».
  const [aviso, setAviso] = useState(null)
  const [simef, setSimef] = useState(null)
  const [cartel, setCartel] = useState(true)
  const [metodologia, setMetodologia] = useState(false)
  const [oficiales, setOficiales] = useState(null)

  // SIMEF es OTRA FUENTE y se carga aparte a proposito: si su archivo falta o
  // falla, el resto del visor sigue entero y solo esa seccion lo dice.
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`${DATA}/simef.json`, { signal: ctrl.signal, cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setSimef)
      .catch(() => {})
    fetch(`${DATA}/oficiales.json`, { signal: ctrl.signal, cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setOficiales)
      .catch(() => {})
    return () => ctrl.abort()
  }, [])

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
    const quieto = menosMovimiento()
    const m = L.map(contenedor.current, {
      preferCanvas: true,
      fadeAnimation: !quieto,
      markerZoomAnimation: !quieto,
      inertia: !quieto,
      // UN SOLO renderer de canvas para todas las capas vectoriales de Leaflet.
      // Con un canvas por capa sólo la de encima recibe los clics, y cuál queda
      // encima lo decide el orden en que terminan de descargarse las capas.
      renderer: L.canvas({ padding: 0.5, tolerance: 8 }),
      // deck.gl obedece la vista de Leaflet, y durante la animación de zoom
      // Leaflet informa del zoom DESTINO mientras el mapa base aún se escala:
      // los puntos se adelantarían. Es el coste conocido de este patrón.
      zoomAnimation: false,
      center: inicial.centro ?? VISTA_INICIAL.center,
      zoom: inicial.zoom ?? VISTA_INICIAL.zoom,
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

  // Los usos viajan en la URL como CÓDIGOS y en el estado como índices: un
  // índice depende del orden del manifest, y un enlace guardado en un correo
  // tiene que sobrevivir a un reproceso del ETL. La conversión sólo se puede
  // hacer cuando el manifest ya está, así que va aquí y una sola vez.
  const usosDeLaUrl = useRef(inicial.usos ?? null)
  // Los filtros temáticos llegan de la URL como CÓDIGOS y sólo se pueden
  // traducir a índices cuando el manifest ya está cargado, igual que los usos.
  const filtrosDeLaUrl = useRef(inicial.filtros ?? null)
  useEffect(() => {
    if (!manifest || !usosDeLaUrl.current) return
    const s = new Set()
    for (const cod of usosDeLaUrl.current) {
      const i = manifest.usos.findIndex((u) => u.cod === cod)
      if (i >= 0) s.add(i)
    }
    usosDeLaUrl.current = null
    setUsosActivos(s)
  }, [manifest])

  useEffect(() => {
    if (!manifest || !filtrosDeLaUrl.current) return
    const restaurados = filtrosDesdeURL(filtrosDeLaUrl.current, manifest)
    filtrosDeLaUrl.current = null
    // INCONDICIONAL, y la guarda que habia aqui era un cepo: si un enlace traia
    // codigos que un reproceso del ETL ya borro, `restaurados` sale vacio, no
    // habia setState, no habia re-render, y `restaurando` se quedaba clavado en
    // el true del ultimo commit. El encuadre no volvia a mirar nunca.
    setFiltros(restaurados)
  }, [manifest])

  // Cierto mientras queden codigos de la URL por traducir a indices. Se lee EN
  // EL RENDER, no se cuentan commits: predecir cuantos van a llegar y que llegue
  // uno menos deja un credito sin gastar que se come el primer filtro que haga
  // el usuario.
  const restaurando = Boolean(usosDeLaUrl.current || filtrosDeLaUrl.current)

  // La URL refleja el estado. pushState para lo que se reconoce como «hice
  // algo»; el paneo va con replaceState desde el efecto del mapa.
  useEffect(() => {
    if (!manifest) return
    escribirURL(
      {
        ambito,
        usos: [...usosActivos].map((i) => manifest.usos[i]?.cod).filter(Boolean),
        filtros: filtrosAURL(filtros, manifest),
        base,
        centro: map ? [map.getCenter().lat, map.getCenter().lng] : null,
        zoom: map ? map.getZoom() : null,
      },
      { push: true },
    )
  }, [manifest, ambito, usosActivos, filtros, base]) // eslint-disable-line react-hooks/exhaustive-deps

  // El encuadre se escribe agrupado y SIN entrada de historial.
  useEffect(() => {
    if (!map || !manifest) return
    const al = () =>
      escribirURL({
        ambito,
        usos: [...usosActivos].map((i) => manifest.usos[i]?.cod).filter(Boolean),
        filtros: filtrosAURL(filtros, manifest),
        base,
        centro: [map.getCenter().lat, map.getCenter().lng],
        zoom: map.getZoom(),
      })
    map.on('moveend', al)
    return () => map.off('moveend', al)
  }, [map, manifest, ambito, usosActivos, filtros, base])

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

  // Las tres fuentes de filtro se juntan en un solo objeto antes de bajar al
  // canal: el ámbito (territorio), la leyenda (uso) y los grupos temáticos. Se
  // cruzan con Y lógico, así que el mapa y TODAS las cifras del panel muestran
  // exactamente lo mismo — que es lo que impide citar una cifra que en pantalla
  // corresponde a otro recorte.
  const filtroCompleto = useMemo(() => {
    const f = { ...filtros }
    if (usosActivos.size) f.uso = usosActivos
    if (comunasDelAmbito.size) f.comuna = comunasDelAmbito
    return f
  }, [filtros, usosActivos, comunasDelAmbito])

  const hayFiltro = Object.keys(filtroCompleto).length > 0

  // UNA sola pasada por cambio de filtro, no dos. Antes el canal del mapa y las
  // cifras del panel se calculaban por separado, y cada clic de casilla costaba
  // dos recorridos completos de 1,8 M de filas.
  //
  // Devuelve además los MARGINALES: para cada dimensión, sus clases contadas
  // sobre las filas que pasan todas las DEMÁS. Es lo que hace que las listas de
  // filtro estén en cascada y que marcar una clase no vacíe a sus hermanas.
  const cruce = useMemo(() => {
    if (!datos || !hayFiltro) return null
    // performance.measure y no un console.log: queda en el timeline del
    // navegador, lo lee la verificación sin tocar nada, y es la única forma de
    // que el techo de coste sea una aserción y no una creencia. La cifra que el
    // repo se creía —«8-14 ms»— venía de otra función, con una dimensión y un
    // .bin de cuatro columnas.
    performance.mark('cruce-ini')
    const r = resumenYMarginales(datos, filtroCompleto)
    performance.mark('cruce-fin')
    performance.measure('cruce', 'cruce-ini', 'cruce-fin')
    return r
  }, [datos, filtroCompleto, hayFiltro])

  const filtro = useMemo(
    () => (datos ? (cruce?.mascara ?? mascaraTodo(datos.n)) : null),
    [datos, cruce],
  )

  const paleta = useMemo(
    () => (datos ? tablaColor(datos.uso, datos.n, paletaRGB(oscuro ? 'oscuro' : 'claro')) : null),
    [datos, oscuro],
  )

  // El resumen nacional sale del manifest y el filtrado de la pasada sobre el
  // .bin. Los dos tienen la MISMA forma, así que el panel tiene un solo camino.
  // Sin ningún filtro, el marginal de cada dimensión ES el nacional: no hay
  // nada de lo que dejar fuera.
  const nacional = useMemo(() => resumenNacional(manifest), [manifest])
  const resumen = cruce?.resumen ?? nacional
  const marginales = cruce?.marginales ?? nacional

  // ---------- encuadre ----------
  // El mapa VA a lo que se acaba de filtrar, sea un territorio, una clase o un
  // cruce de las dos. Sin esto el panel dice una cosa y el mapa muestra otra.
  //
  // UN SOLO EFECTO, y por construcción y no por convención: `comunasDelAmbito`
  // es una de las entradas de `filtroCompleto`, así que elegir una región cambia
  // el ámbito Y el filtro en el MISMO commit. Con dos efectos habría dos vuelos
  // en el mismo flush, Leaflet abortaría el primero al arrancar el segundo, y
  // cuál gana lo decidiría el orden de declaración en este archivo.
  //
  // El destino se decide POR PRIORIDAD y en un solo sitio, para que no haya dos
  // fuentes que arbitrar.
  const destino = useMemo(() => {
    if (!manifest) return null
    const cajaAmbito = cajaDelAmbito(ambito, manifest)

    // LOS RÍOS. La región 14 declara 79.727 filas y CERO comunas en el manifest
    // —sus filas llevan el centinela en la columna comuna, y de hecho el
    // `sin_dato.comuna` nacional son 79.731—, así que `comunasDelAmbito` sale
    // vacío y el cruce NO se entera de que hay un ámbito elegido. Sin esta rama,
    // marcar cualquier casilla con Los Ríos puesto mandaría el mapa a la caja
    // NACIONAL de esa casilla mientras el panel rotula «Los Ríos».
    const ambitoSinFiltrar = Boolean(ambito.region) && comunasDelAmbito.size === 0
    if (ambitoSinFiltrar && cajaAmbito) return cajaAmbito

    // Lo que de verdad pasó el filtro. Sale del cruce, que ya recorrió las filas.
    if (cruce?.caja) return cruce.caja
    // El filtro no dejó ni un punto, pero hay territorio: se queda en él en vez
    // de saltar al país. No es un caso raro: 834 de las 2.979 combinaciones de
    // uso × comuna devuelven cero filas.
    if (cajaAmbito) return cajaAmbito
    // Filtro sin puntos y sin territorio: NO se mueve nada. Irse al país entero
    // por un recorte vacío sería lo contrario de lo que el usuario pidió.
    if (hayFiltro) return null
    // Nada elegido: la vista inicial, igual que «volver a Chile».
    return 'inicial'
  }, [manifest, ambito, comunasDelAmbito, cruce, hayFiltro])

  // El objetivo del vuelo EN CURSO. A mitad de un flyTo Leaflet va actualizando
  // centro y zoom fotograma a fotograma, así que un segundo filtro dentro de los
  // 600 ms leería una vista interpolada que no es de nadie y decidiría mal si
  // hace falta moverse. Se limpia en moveend, que dispara tanto al aterrizar
  // como cuando el usuario arrastra y cancela el vuelo.
  const vuelo = useRef(null)
  useEffect(() => {
    if (!map) return
    const al = () => { vuelo.current = null }
    map.on('moveend', al)
    return () => { map.off('moveend', al) }
  }, [map])

  // Un enlace con ?lat=&lon= eligió deliberadamente un encuadre y manda sobre el
  // automático. El centinela se gasta en la PRIMERA evaluación con el estado ya
  // completo —de ahí la guarda de `restaurando`— y no vuelve a estorbar.
  const encuadreDeLaURL = useRef(Boolean(inicial.centro))
  useEffect(() => {
    if (!map || !manifest || restaurando) return
    if (encuadreDeLaURL.current) {
      encuadreDeLaURL.current = false
      return
    }
    if (!destino) return

    let centro
    let zoom
    if (destino === 'inicial') {
      centro = L.latLng(VISTA_INICIAL.center)
      zoom = VISTA_INICIAL.zoom
    } else {
      const caja = L.latLngBounds(
        [destino[1], destino[0]],
        [destino[3], destino[2]],
      )
      // El tope de zoom es obligatorio, no estético: 123 clases del vocabulario
      // devuelven UNA sola fila —107 especies, 15 comunas entre ellas Santiago, y
      // el MN Isla Cachagua— y su caja tiene área cero. Sin tope getBoundsZoom
      // devuelve el máximo de la capa, y los fondos tienen maxNativeZoom entre 13
      // y 16: el usuario aterrizaría en una tesela estirada sobre un punto suelto.
      zoom = Math.min(MAX_ZOOM_ENCUADRE, map.getBoundsZoom(caja, false, PADDING_ENCUADRE))
      centro = caja.getCenter()
    }

    // NO SE VUELA SI EL VUELO NO MUEVE NADA. Se compara el objetivo COMPLETO
    // —centro y zoom, ya capado— contra dónde va a estar el mapa, y no un
    // solapamiento de rectángulos, que dejaría quieto medio salto entre comunas
    // vecinas. El umbral son los mismos 24 px que el encuadre deja de margen: un
    // desplazamiento menor que ese margen está por debajo de la precisión que el
    // propio encuadre afirma tener.
    //
    // Sin esto, 8 de los 9 usos encuadran a algo casi idéntico al bbox nacional
    // —medido: Bosques da [-75,71 -55,97 -66,43 -17,65] contra el nacional
    // [-75,72 -56,52 -66,42 -17,50]— y marcar la leyenda clase a clase costaría
    // nueve vuelos de 600 ms para no moverse del sitio.
    const donde = vuelo.current ?? { centro: map.getCenter(), zoom: map.getZoom() }
    if (
      donde.zoom === zoom &&
      map.project(donde.centro, zoom).distanceTo(map.project(centro, zoom)) < HOLGURA_ENCUADRE
    ) {
      return
    }

    vuelo.current = { centro, zoom }
    // Sin animación para quien pidió menos movimiento: un vuelo de 600 ms en
    // cada clic de casilla es exactamente lo que esa preferencia evita.
    map.flyTo(centro, zoom, { animate: !menosMovimiento(), duration: 0.6 })
  }, [map, manifest, destino, restaurando])

  const fuenteFecha = BASEMAPS[base]?.fecha ?? null
  const fechaEsri = useFechaImagen(map, fuenteFecha?.tipo === 'esri')
  const imagen =
    fuenteFecha?.tipo === 'fijo' ? { estado: 'fijo', texto: fuenteFecha.texto } : fechaEsri

  const alFiltro = useCallback((col, i) => {
    setFiltros((prev) => alternar(prev, col, i))
  }, [])

  const limpiarFiltro = useCallback((col) => {
    setFiltros((prev) => {
      const s = { ...prev }
      delete s[col]
      return s
    })
  }, [])

  const limpiarFiltros = useCallback(() => setFiltros({}), [])

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
      // La especie se rotula con las DOS formas cuando las tiene. El nombre
      // común no identifica: «coihue» son varias especies distintas y
      // «Nothofagus dombeyi» es una sola. Quien copie esta ficha a un informe
      // necesita la que se puede citar.
      const esp = datos.especie[i] === 65535 ? null : m.especies[datos.especie[i]]
      const alt = datos.altura[i] === 255 ? null : m.alturas[datos.altura[i]]
      const filas = [
        ['Uso de suelo', uso?.etiqueta ?? '—'],
        ['Subuso', et(m.subusos, datos.subuso[i], 255) ?? '—'],
        ['Estructura', et(m.estructuras, datos.estruc[i], 255) ?? 'no aplica'],
        ['Tipo forestal', et(m.tipos_forestales, datos.tifo[i], 255) ?? 'no aplica'],
        ['Subtipo forestal', et(m.subtipos_forestales, datos.stifo[i], 255) ?? 'no aplica'],
        ['Densidad de copas', et(m.coberturas, datos.cober[i], 255) ?? 'sin dato'],
        // El tramo de altura viaja SIEMPRE con su escala: '<2' y '0 - 0.5' se
        // leen igual de bien y miden con reglas distintas.
        ['Altura del dosel', alt
          ? `${alt.etiqueta} m${alt.escala === 'gruesa' ? ' (escala gruesa)' : ''}`
          : 'sin dato'],
        ['Especie principal', esp
          ? (esp.cientifico && esp.cientifico !== esp.etiqueta
              ? `${esp.etiqueta} · ${esp.cientifico}`
              : esp.etiqueta)
          : 'sin dato'],
        ['Área protegida', et(m.snaspe, datos.snaspe[i], 255) ?? 'fuera del SNASPE'],
        ['Comuna', com ? `${com.etiqueta} (${com.provincia})` : 'sin dato'],
        ['Región', reg ? `${reg.nombre} · catastro ${reg.anio}` : '—'],
        ['Superficie del polígono', haExacta(datos.ha[i])],
      ]
      setFicha({
        capa: 'Catastro de Bosque Nativo',
        titulo: uso?.etiqueta ?? 'Sin clasificar',
        // El mismo color con el que ese punto está pintado en el mapa. Es lo
        // que ata la ficha a la mancha que el usuario acaba de pulsar; sin él
        // ModalFicha deja el chip sin pintar y la ficha podría ser de cualquier
        // clase.
        color: COLOR_USO[oscuro ? 'oscuro' : 'claro'][uso?.cod],
        coord: [datos.lat[i].toFixed(6), datos.lon[i].toFixed(6)],
        filas,
      })
    },
    [datos, oscuro],
  )

  // Enter sobre el mapa sin ninguna figura bajo la mira. No hay nada visible
  // que enseñar --el mapa no ha cambiado-- así que el único acuse posible es el
  // hablado.
  const alFallo = useCallback(() => {
    setAviso((a) => ({ n: (a?.n ?? 0) + 1, texto: 'No hay ninguna figura bajo la mira.' }))
  }, [])

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
      <Banner />

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
        marginales={marginales}
        ambito={ambito}
        onAmbito={setAmbito}
        base={base}
        onBase={setBase}
        usosActivos={usosActivos}
        onUso={alternarUso}
        filtros={filtros}
        onFiltro={alFiltro}
        onLimpiarFiltro={limpiarFiltro}
        onLimpiarFiltros={limpiarFiltros}
        onLimpiarUsos={() => setUsosActivos(new Set())}
        abierto={panelVisible}
        onCerrar={cerrarPanel}
        oscuro={oscuro}
        onMetodologia={() => setMetodologia(true)}
      >
        <SeccionDescargas
          datos={datos}
          filtro={filtro}
          resumen={resumen}
          manifest={manifest}
          ambitoTxt={manifest ? ambitoTexto(ambito, manifest) : 'todo Chile'}
          nFiltrado={resumen?.n ?? 0}
        />
      </PanelLateral>

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
          simef={simef}
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
        <CapaPuntos
          map={map}
          datos={datos}
          paleta={paleta}
          filtro={filtro}
          onPunto={alPunto}
          onFallo={alFallo}
        />
      )}

      {/* El <p> es ESTABLE y sólo cambia su texto: remontar la región en cada
          aviso hace que el lector se pierda el primero. El espacio duro alterna
          para que dos avisos idénticos seguidos sigan siendo dos anuncios. */}
      <p className="aviso-mapa visualmente-oculto" role="status" aria-live="polite">
        {aviso ? aviso.texto + ' '.repeat(aviso.n % 2) : ''}
      </p>
      {cartel && <CartelContexto texto={AVISO_PUNTOS} onCerrar={() => setCartel(false)} />}
      <EtiquetaImagen map={map} info={imagen} />
      <PaginaMetodologia
        abierta={metodologia}
        onCerrar={() => setMetodologia(false)}
        manifest={manifest}
        oficiales={oficiales}
        simef={simef}
      />
      <ModalFicha ficha={ficha} onCerrar={() => setFicha(null)} />

      {!datos && (
        <p className="descargando" role="status">
          Descargando el Catastro nacional…
        </p>
      )}
    </div>
  )
}


/**
 * El bbox del ámbito más profundo que tenga uno. Una provincia no tiene bbox
 * propio en el manifest —serían 55 entradas más— así que se compone de sus
 * comunas, que es exactamente lo mismo.
 */
function cajaDelAmbito(a, manifest) {
  if (!a?.region) return null
  if (a.comuna) {
    return manifest.comunas.find((c) => c.cod === a.comuna)?.bbox ?? null
  }
  if (a.provincia) {
    const cajas = manifest.comunas
      .filter((c) => c.region === a.region && c.provincia === a.provincia && c.bbox)
      .map((c) => c.bbox)
    if (!cajas.length) return null
    return [
      Math.min(...cajas.map((b) => b[0])),
      Math.min(...cajas.map((b) => b[1])),
      Math.max(...cajas.map((b) => b[2])),
      Math.max(...cajas.map((b) => b[3])),
    ]
  }
  return manifest.regiones.find((r) => r.cod === a.region)?.bbox ?? null
}
