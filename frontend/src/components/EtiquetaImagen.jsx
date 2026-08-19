import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { fechaLarga } from '../config'

/**
 * Etiqueta sobre el mapa con la fecha de captura de la imagen satelital.
 *
 * Va como CONTROL de Leaflet en la esquina topleft, y no como un elemento
 * posicionado a mano igual que .cartel o .descargando. La razon es que ahi
 * arriba ya viven el boton ☰ y la barra de zoom, y sus alturas cambian con el
 * ancho Y con el tipo de puntero --con (pointer: coarse) los botones de zoom
 * pasan de 26 a 44 px, o sea que la barra crece de 64 a 92 px--. Calcular ese
 * hueco a mano seria una constante que se rompe en silencio; como control,
 * Leaflet lo apila solo bajo el zoom, hereda el margin-left de 52 px que
 * App.css le da a la esquina para esquivar el ☰, y no hay nada que mantener.
 *
 * Devuelve null: dirige a Leaflet por efectos, como los Capa*.
 */
export default function EtiquetaImagen({ map, info }) {
  const control = useRef(null)

  useEffect(() => {
    if (!map) return
    const c = L.control({ position: 'topleft' })
    c.onAdd = () => {
      const d = L.DomUtil.create('div', 'leaflet-control fecha-imagen')
      // Sin esto, arrastrar encima de la etiqueta arrastra el mapa de debajo y
      // un doble clic hace zoom.
      L.DomEvent.disableClickPropagation(d)
      L.DomEvent.disableScrollPropagation(d)
      return d
    }
    c.addTo(map)
    control.current = c
    return () => {
      c.remove()
      control.current = null
    }
  }, [map])

  useEffect(() => {
    const el = control.current?.getContainer?.()
    if (!el) return
    const t = texto(info)
    el.textContent = t ?? ''
    // Sin texto no debe quedar una caja vacia ocupando su hueco en la esquina.
    el.style.display = t ? '' : 'none'
  }, [info])

  return null
}

/**
 * Compacta a proposito: es una etiqueta sobre la imagen, no una ficha. El
 * detalle --resolucion, proveedor y la advertencia de que la fecha vale para el
 * centro de la vista-- vive en el panel, donde hay sitio para leerlo.
 *
 * Mientras consulta y si el servicio falla no se pinta nada: un cartel rojo
 * parpadeando sobre el mapa en cada paneo seria peor que el silencio, y el
 * panel si reporta el error.
 */
function texto(info) {
  if (!info) return null
  if (info.estado === 'ok') return `Imagen del ${fechaLarga(info.iso)}`
  // Fecha conocida de antemano, no consultada: el mosaico anual de Sentinel-2.
  if (info.estado === 'fijo') return info.texto
  if (info.estado === 'sin-fecha') return 'Imagen sin fecha publicada'
  return null
}
