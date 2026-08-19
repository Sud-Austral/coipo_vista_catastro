import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { Deck, MapView } from '@deck.gl/core'
import { ScatterplotLayer } from '@deck.gl/layers'
import { DataFilterExtension } from '@deck.gl/extensions'

/**
 * Capa de 1.827.933 puntos del Catastro, pintada por deck.gl DENTRO del armazon
 * de Leaflet.
 *
 * POR QUE NO circleMarker DE LEAFLET, que es lo que usa el visor de prevencion:
 * porque alli son 14.705 puntos y aqui 1.827.933. Medido con el mismo arnes, la
 * misma GPU y los mismos datos, con el renderer compartido
 * L.canvas({padding:0.5, tolerance:8}) y el patron "pool" del otro visor
 * (spike/spike_leaflet.html, reproducible con spike/medir.py):
 *
 *      puntos     1er pintado    fps     refiltrado
 *      15.000        251 ms     64,2        35 ms   <- la escala del otro visor
 *     100.000        405 ms      9,5       270 ms
 *     500.000      1.099 ms      1,6     1.634 ms
 *   1.827.933      5.834 ms      0,8     6.227 ms   <- la escala de este
 *   1.827.933 deck   616 ms     26,7        14 ms   <- spike_hibrido.html
 *
 * Entre 15.000 y 100.000 puntos los fps caen de 64 a 9,5: el limite practico de
 * este patron esta por ahi, y no es culpa de Leaflet, es que 1,83 M de objetos
 * con estado propio no caben en el bucle de repintado de la CPU.
 *
 * O sea: Leaflet no esta mal, esta fuera de escala. El armazon sigue siendo
 * suyo --mapas base, controles, atribucion, EtiquetaImagen-- y solo esta capa
 * cambia de motor. Cuesta un 7% de fps frente a deck.gl a solas (26,7 contra
 * 28,6) y a cambio no hay que reescribir nada del resto.
 *
 * Devuelve null: dirige a deck.gl y a Leaflet por efectos, como los Capa* del
 * visor de referencia.
 */
export default function CapaPuntos({ map, datos, paleta, filtro, onPunto }) {
  const deckRef = useRef(null)
  const contRef = useRef(null)
  const canvasRef = useRef(null)

  // --- montaje: un unico Deck que vive mientras viva el mapa ---------------
  useEffect(() => {
    if (!map || !datos) return

    const cont = L.DomUtil.create('div', 'deck-overlay', map.getPanes().overlayPane)
    const canvas = document.createElement('canvas')
    cont.appendChild(canvas)
    contRef.current = cont
    canvasRef.current = canvas

    function vista() {
      const s = map.getSize()
      L.DomUtil.setPosition(cont, map.containerPointToLayerPoint([0, 0]))

      // EL CONTENEDOR TIENE QUE TENER CAJA, y esto no es defensivo: deck.gl
      // pisa el tamano en linea del lienzo con width/height:100%, asi que si el
      // padre no mide, el canvas queda a 0x0 -- y deck sigue pintando en su
      // bufer WebGL tan tranquilo. Medido: 57.511 pixeles no transparentes
      // dentro de un elemento invisible, con onAfterRender disparando y CERO
      // errores. El sintoma es un mapa base perfecto y ni un punto encima.
      cont.style.width = s.x + 'px'
      cont.style.height = s.y + 'px'

      const dpr = window.devicePixelRatio || 1
      const w = Math.round(s.x * dpr)
      const h = Math.round(s.y * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const c = map.getCenter()
      return {
        longitude: c.lng,
        latitude: c.lat,
        // Leaflet cuenta con teselas de 256 px (mundo = 256 * 2^z) y deck.gl con
        // 512, asi que para la MISMA escala zoomDeck = zoomLeaflet - 1.
        // Equivocarse aqui no lanza ningun error: dibuja los puntos al doble o a
        // la mitad de escala sobre un mapa base correcto.
        zoom: map.getZoom() - 1,
        pitch: 0,
        bearing: 0,
      }
    }

    const deckgl = new Deck({
      canvas,
      views: new MapView({ repeat: false }),
      // El controlador sigue siendo Leaflet: arrastre, zoom, inercia y teclado
      // los maneja el, y deck solo obedece la vista resultante.
      controller: false,
      viewState: vista(),
      layers: [],
      getCursor: () => '',
    })
    deckRef.current = deckgl

    const resync = () => deckgl.setProps({ viewState: vista() })
    map.on('move zoom moveend zoomend viewreset resize', resync)

    return () => {
      map.off('move zoom moveend zoomend viewreset resize', resync)
      deckgl.finalize()
      cont.remove()
      deckRef.current = null
      contRef.current = null
      canvasRef.current = null
    }
  }, [map, datos])

  // --- capa: se reconstruye al cambiar filtro o paleta ---------------------
  useEffect(() => {
    const deckgl = deckRef.current
    if (!deckgl || !datos) return

    const capa = new ScatterplotLayer({
      id: 'catastro-puntos',
      data: {
        length: datos.n,
        attributes: {
          // size:3 es el tamano nativo de getPosition en LNGLAT. Con size:2
          // deck.gl 9.3.10 tambien funciona --medido, render identico-- pero se
          // deja en 3 porque no cuesta nada y evita depender de ese detalle.
          getPosition: { value: datos.pos, size: 3 },
          // normalized:true OBLIGATORIO con Uint8Array. Con false el shader
          // recibe 0..255 donde espera 0..1 y satura: pinta TODO BLANCO, sin
          // un solo aviso de deck.gl. Es un defecto que ya ocurrio y que la
          // verificacion caza midiendo el porcentaje de pixeles casi-blancos.
          getFillColor: { value: paleta, size: 4, normalized: true },
          getFilterValue: { value: filtro, size: 1 },
        },
      },
      radiusUnits: 'pixels',
      // Escalar y no funcion: como funcion, deck.gl reserva 4 B por punto de
      // mas para un valor que no varia.
      getRadius: 1.2,
      radiusMinPixels: 0.6,
      radiusMaxPixels: 4,
      stroked: false,
      pickable: true,
      // uint8 medido identico a float32 en render, y ocupa 1 byte por punto en
      // vez de 4: 1,8 MB por cambio de filtro en lugar de 7,3 MB.
      extensions: [new DataFilterExtension({ filterSize: 1 })],
      filterRange: [0.5, 1.5],
      onClick: (info) => {
        // Con datos binarios deck.gl devuelve info.index y `info.object` es
        // undefined: la ficha se arma desde el indice, no desde el objeto.
        if (info && info.index >= 0 && onPunto) onPunto(info.index)
      },
      updateTriggers: { getFilterValue: filtro, getFillColor: paleta },
    })
    deckgl.setProps({ layers: [capa] })
  }, [datos, paleta, filtro, onPunto])

  return null
}
