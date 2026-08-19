import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Fecha de captura de la imagen satelital que se esta viendo.
 *
 * El mapa base Satelital son teselas de Esri World Imagery, que NO es una foto
 * unica: es un mosaico de miles de escenas de fechas distintas, y ademas cambia
 * de fuente con el zoom -- por debajo de z12 se ve un mosaico global de 15 m y
 * por encima, imagen de alta resolucion de proveedor comercial. Preguntar "de
 * cuando es esta imagen" solo tiene respuesta para UN punto y UN zoom.
 *
 * Esri publica esa metadata en el mismo servicio, con `identify`. Comprobado
 * contra el servicio real:
 *   - responde con Access-Control-Allow-Origin: *, asi que se puede consultar
 *     desde el navegador sin proxy (este sitio es estatico y no tiene backend);
 *   - `tolerance` va en PIXELES DE PANTALLA relativos a mapExtent/imageDisplay,
 *     asi que hay que mandar el encuadre real: con un extent de todo Chile y
 *     tolerancia 2 devuelve mas de cien huellas y ninguna corresponde a lo que
 *     se ve;
 *   - cada resultado trae MinMapLevel/MaxMapLevel, o sea el rango de zoom en el
 *     que ESA imagen es la que se dibuja. Ese es el filtro que hace honesta la
 *     respuesta.
 *
 * El servicio vive en services.arcgisonline.com, un host DISTINTO del de las
 * teselas (server.arcgisonline.com). Los dos estan bloqueados en la lista TILES
 * de scripts/verify-banner.mjs y scripts/verify-panel.mjs para que la
 * verificacion no salga a la red.
 */
const SERVICIO =
  'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/identify'

/**
 * `DATE (YYYYMMDD)` y no `SRC_DATE2`: el segundo viene como "3/23/2026", que es
 * M/D/YYYY y en un visor chileno se leeria al reves. El primero no es ambiguo.
 */
function fechaISO(a) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(a?.['DATE (YYYYMMDD)'] ?? ''))
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

const numero = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * @param {L.Map|null} map
 * @param {boolean} activo  solo consulta con el mapa base satelital encendido:
 *   con los otros dos la pregunta no tiene sentido y seria trafico regalado.
 * @returns {{estado:'cargando'|'ok'|'sin-fecha'|'error', ...}|null}
 */
export function useFechaImagen(map, activo) {
  const [info, setInfo] = useState(null)
  const abort = useRef(null)
  const temporizador = useRef(null)

  const consultar = useCallback(() => {
    if (!map) return
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setInfo({ estado: 'cargando' })

    const b = map.getBounds()
    const t = map.getSize()
    const c = map.getCenter()
    const z = map.getZoom()
    const q = new URLSearchParams({
      geometry: JSON.stringify({ x: c.lng, y: c.lat, spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryPoint',
      sr: '4326',
      layers: 'visible',
      tolerance: '1',
      mapExtent: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(','),
      imageDisplay: `${Math.max(1, Math.round(t.x))},${Math.max(1, Math.round(t.y))},96`,
      returnGeometry: 'false',
      f: 'json',
    })

    fetch(`${SERVICIO}?${q}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`identify: HTTP ${r.status}`)
        return r.json()
      })
      .then((j) => {
        // Solo las huellas que se dibujan en ESTE zoom. Sin este filtro, a z6 se
        // anunciaria la fecha de una imagen de alta resolucion que no se esta
        // viendo. Se exige ademas RESOLUTION porque las filas de «Citations»
        // vienen sin niveles y sin resolucion.
        const aplica = (j?.results ?? [])
          .map((r) => r.attributes ?? {})
          .filter((a) => {
            const min = numero(a.MinMapLevel)
            const max = numero(a.MaxMapLevel)
            return min != null && max != null && z >= min && z <= max && a['RESOLUTION (M)'] != null
          })
        // Con varias que aplican --el servicio devuelve la misma escena bajo
        // «World Imagery» y bajo su capa de resolucion-- se prefiere la que
        // trae fecha.
        const a = aplica.find((x) => fechaISO(x)) ?? aplica[0]
        if (!a) return setInfo({ estado: 'sin-fecha', motivo: 'sin-cobertura' })

        const iso = fechaISO(a)
        const comun = {
          resolucion: numero(a['RESOLUTION (M)']),
          fuente: [a.SOURCE, a.SOURCE_INFO].filter((s) => s && s !== 'Null').join(' · '),
          zoom: z,
        }
        // El mosaico global de 15 m (TerraColor) no publica fecha: viene con
        // SRC_DATE en Null. Se dice, en vez de callarlo o inventar una.
        setInfo(iso ? { estado: 'ok', iso, ...comun } : { estado: 'sin-fecha', motivo: 'mosaico', ...comun })
      })
      .catch((e) => {
        if (e.name === 'AbortError') return
        setInfo({ estado: 'error' })
      })
  }, [map])

  useEffect(() => {
    if (!map || !activo) {
      abort.current?.abort()
      clearTimeout(temporizador.current)
      setInfo(null)
      return
    }
    // Se agrupa igual que la escritura de la URL: moveend dispara muchas veces
    // durante un paneo y cada una seria una peticion a un servicio ajeno.
    const alMover = () => {
      clearTimeout(temporizador.current)
      temporizador.current = setTimeout(consultar, 400)
    }
    consultar()
    map.on('moveend', alMover)
    return () => {
      map.off('moveend', alMover)
      clearTimeout(temporizador.current)
      abort.current?.abort()
    }
  }, [map, activo, consultar])

  return info
}
