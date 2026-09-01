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
/**
 * EL RADIO YA NO SE CALCULA AQUI: viene en su propia columna del .bin, en
 * metros, y este componente solo la pasa a deck.gl.
 *
 * Se calculaba, y era `sqrt(ha * 10000 / PI)` -- el radio del circulo de igual
 * area que el poligono. Esa regla es correcta y esta mal: circulos de la misma
 * area que celdas que TESELAN el territorio tienen que solaparse. Medido sobre
 * las 1.827.933 filas, el 56 % de los puntos invadia a su vecino mas cercano, y
 * en Valdivia a z13 el 45 % de los centros quedaba debajo de un disco mayor,
 * con la suma de areas en el 86 % de la pantalla.
 *
 * NINGUNA ESCALA UNIFORME LO ARREGLA, y se probaron: al 0,7 seguian solapando
 * 718.110 puntos; al 0,5, 456.162; al 0,1 --un decimo-- todavia 28.718. No era
 * un problema de calibracion.
 *
 * La regla nueva la aplica el ETL, que es donde se puede hacer:
 *
 *     r = min( sqrt(ha * 10000 / PI) , distancia al vecino mas cercano / 2 )
 *
 * Si r_i <= d_ij/2 y r_j <= d_ij/2 para todo par, entonces r_i + r_j <= d_ij:
 * cero solape, demostrable. Exige una consulta espacial sobre 1,8 M de puntos
 * --cKDTree, 0,9 s-- que no tiene sentido repetir en cada navegador, y que D26
 * comprueba desde fuera sobre el .bin publicado.
 *
 * EL PRECIO, que la interfaz dice: para el 56 % de los puntos el disco ya no
 * cubre el area de su poligono sino el sitio que tiene libre.
 *
 * Y EL LIMITE: por debajo de z11 la separacion mediana entre vecinos (185 m)
 * baja de los 2,4 px que necesitan dos discos en el suelo de radiusMinPixels,
 * asi que ahi vuelven a tocarse. Con 1,8 M de puntos sobre 733.000 pixeles eso
 * no es una decision de diseno, es una division.
 */

export default function CapaPuntos({ map, datos, paleta, filtro, onPunto, onFallo }) {
  const radio = datos.radio

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

  // --- la mira del recorrido por teclado -----------------------------------
  // Va en el CONTENEDOR del mapa y no como control de Leaflet --que es lo que
  // hace EtiquetaImagen-- porque los controles se anclan a las esquinas y esto
  // tiene que quedar en el centro exacto, que es donde pica Enter.
  //
  // Solo se ve cuando se esta navegando CON EL TECLADO, y el modo se lleva a
  // mano en vez de con :focus-visible. Se probo con :focus-visible y sale mal:
  // el manejador de teclado de Leaflet enfoca el contenedor POR SCRIPT en cada
  // mousedown, y la especificacion manda que un foco programatico herede
  // focus-visible cuando no habia elemento enfocado antes. O sea que, recien
  // cargada la pagina, el primer clic de raton ya sacaba la mira. Medido: la
  // asercion se puso roja con el CSS "correcto".
  //
  // Con dos escuchas en captura el modo es determinista y ademas se comporta
  // mejor: tras un clic la mira desaparece, y vuelve en cuanto se toca una
  // flecha, que es justo cuando hace falta.
  useEffect(() => {
    if (!map) return
    const cont = map.getContainer()
    const mira = L.DomUtil.create('div', 'mira', cont)
    mira.setAttribute('aria-hidden', 'true')
    const teclado = () => cont.classList.add('teclado')
    const raton = () => cont.classList.remove('teclado')
    document.addEventListener('keydown', teclado, true)
    document.addEventListener('pointerdown', raton, true)
    return () => {
      document.removeEventListener('keydown', teclado, true)
      document.removeEventListener('pointerdown', raton, true)
      mira.remove()
    }
  }, [map])

  // --- seleccion: del evento de Leaflet al picking de deck.gl --------------
  //
  // EL onClick DE LA CAPA NO SIRVE AQUI, y no hay que "restaurarlo": el
  // contenedor lleva pointer-events:none para que el arrastre y el zoom sigan
  // siendo de Leaflet, `pointer-events` SE HEREDA, y deck.gl engancha sus
  // escuchas al propio lienzo (eventRoot = props.parent?.querySelector(
  // '.deck-events-root') || canvas, y aqui no se pasa `parent`). O sea: el
  // lienzo no es blanco de ningun evento de puntero y ese onClick no se dispara
  // jamas. Se publico asi, con la ficha entera escrita e inalcanzable.
  //
  // Enrutar por Leaflet ademas sale MEJOR que el onClick de deck: Leaflet
  // suprime el click cuando el mapa se arrastro (_fireDOMEvent ->
  // _draggableMoved), asi que soltar el raton al final de un paneo no abre
  // ninguna ficha. deck.gl no distingue las dos cosas.
  useEffect(() => {
    if (!map) return

    // El radio es tolerancia de PICKING, no de dibujo: se SUMA al disco. Hace
    // falta a escala de pais, donde el suelo de radiusMinPixels deja los puntos
    // en 1,2 px y sin holgura habria que acertarle al pixel -- el sintoma seria
    // identico al de no tener ficha. Al acercarse el disco ya es grande y la
    // tolerancia deja de notarse, que es lo que se quiere: no roba clics a un
    // vecino porque el vecino tambien ha crecido.
    const picar = (x, y, radius) =>
      deckRef.current?.pickObject({ x, y, radius, layerIds: ['catastro-puntos'] })

    const alClic = (e) => {
      // containerPoint YA es el pixel CSS del lienzo: el contenedor se coloca en
      // containerPointToLayerPoint([0,0]) y mide getSize(), asi que las dos
      // esquinas superiores izquierdas coinciden y no hay nada que convertir.
      const info = picar(e.containerPoint.x, e.containerPoint.y, 6)
      // Con datos binarios deck.gl devuelve info.index y `info.object` es
      // undefined: la ficha se arma desde el indice, no desde el objeto.
      if (info && info.index >= 0) onPunto?.(info.index)
    }

    // Los 1,8 M de puntos viven en un lienzo, asi que no son nodos tabulables y
    // sin esto la ficha es inalcanzable sin raton. Las flechas ya desplazan el
    // mapa --manejador de teclado de Leaflet-- bajo la mira fija, y Enter pica
    // en el centro.
    const alTecla = (e) => {
      const ev = e.originalEvent
      if (ev.key !== 'Enter') return
      // OBLIGATORIO: los botones de zoom viven DENTRO del contenedor y
      // disableClickPropagation detiene click y mousedown, no keydown. Sin esta
      // guarda, pulsar Enter sobre «Acercar» abriria ademas una ficha.
      if (ev.target !== map.getContainer()) return
      // TAMBIEN OBLIGATORIO, y no es una precaucion: la ficha se abre en el
      // keydown y su <dialog> se lleva el foco al boton de cerrar, asi que el
      // keypress DEL MISMO PULSADO cae sobre ese boton y lo activa. Medido: la
      // ficha se abria y se cerraba dentro del mismo Enter --abre, click en
      // BUTTON, cierra-- y desde fuera parecia que la tecla no hacia nada.
      // preventDefault en el keydown es lo que impide que ese keypress exista.
      ev.preventDefault()
      const s = map.getSize()
      // Radio mayor que el del raton: no hay puntero fino que ajustar, y el
      // paso de las flechas de Leaflet es de 80 px.
      const info = picar(s.x / 2, s.y / 2, 12)
      if (info && info.index >= 0) onPunto?.(info.index)
      else onFallo?.()
    }

    map.on('click', alClic)
    map.on('keydown', alTecla)
    return () => {
      map.off('click', alClic)
      map.off('keydown', alTecla)
    }
  }, [map, onPunto, onFallo])

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
          // EL RADIO VA AQUI DENTRO, y no como prop de la capa. Estaba fuera,
          // junto a radiusUnits, y deck.gl lo IGNORABA en silencio: como prop,
          // un accessor admite una funcion o un numero, y un {value, size} no
          // es ninguna de las dos, asi que caia a su radio por defecto de 1 m.
          //
          // Consecuencia: el tamano por superficie NUNCA se aplico. Los
          // 1.827.933 puntos se pintaban todos del mismo tamano minimo, a
          // cualquier zoom -- que es exactamente la "viruela" que se reporto.
          // Medido con el punto de la fila 900.000 (7,64 ha, 156 m de radio
          // equivalente): a z16 el disco media 2 px, que es el suelo de
          // radiusMinPixels, cuando le tocaban 175. Con un radio CONSTANTE en
          // la misma prop salian 138 px, y esa fue la prueba que lo separo.
          getRadius: { value: radio, size: 1 },
        },
      },
      // METROS, no pixeles: el disco ocupa el terreno que el poligono declara,
      // asi que el tamano es PROPORCIONAL al area y crece con el zoom. Con
      // 'pixels' un punto medía lo mismo a z=4 que a z=18 -- la viruela.
      radiusUnits: 'meters',
      // LOS DOS TOPES AHORA HACEN FALTA DE VERDAD, y cada uno tapa un extremo
      // de un rango de 13 millones a uno (0 ha a 1.295.122 ha):
      //
      // - SUELO. A escala de pais el poligono mediano mide 0,2 px y el 25 % de
      //   ellos esta por debajo de 1 ha: sin suelo, tres cuartas partes del
      //   Catastro desaparecen al alejarse. Antes este numero era LETRA MUERTA
      //   --valia 0,6 y la formula ya no bajaba de 0,9--, asi que nunca se
      //   habia calibrado.
      // - TECHO. Los 418 poligonos de mas de 10.000 ha llegarian a 136.444 px
      //   de radio a z18; el mayor mide 64 km de radio equivalente. Sin techo,
      //   uno solo tapa la pantalla y esconde a todos sus vecinos.
      //
      // El techo es generoso a proposito (no los 12 px de antes): recortar a
      // z16 un poligono de 500 ha, que ahi ocupa de verdad media pantalla,
      // volveria a mentir sobre su tamano justo cuando se puede comprobar.
      // SEMITRANSPARENTES, y esto es consecuencia de lo anterior: con discos de
      // 1 px daba igual, pero al ocupar su area real se solapan y tapan el mapa
      // base. Con alfa se ve el fondo debajo, y donde dos poligonos se cruzan
      // el color se acumula -- que es informacion, no suciedad.
      opacity: 0.55,
      radiusMinPixels: 1.2,
      radiusMaxPixels: 120,
      stroked: false,
      pickable: true,
      // uint8 medido identico a float32 en render, y ocupa 1 byte por punto en
      // vez de 4: 1,8 MB por cambio de filtro en lugar de 7,3 MB.
      extensions: [new DataFilterExtension({ filterSize: 1 })],
      filterRange: [0.5, 1.5],
      // Sin onClick: no llegaria nunca. La seleccion la enruta el efecto de
      // arriba desde los eventos de Leaflet. `pickable: true` SI hace falta,
      // porque es lo que hace que la capa se dibuje en el bufer de picking que
      // lee pickObject.
      updateTriggers: { getFilterValue: filtro, getFillColor: paleta },
    })
    deckgl.setProps({ layers: [capa] })
  }, [datos, paleta, filtro, radio])

  return null
}
