/* oxlint-disable react/only-export-components -- no es un módulo de la app: lo carga
   Node al construir y nunca pasa por el Fast Refresh de Vite, que es lo que esa regla
   protege. Exporta funciones y constantes a propósito. */
/**
 * Entrada del render en Node. La compila scripts/prerender.mjs con la API de Vite
 * (build SSR aparte) y la importa; el navegador nunca carga este archivo.
 *
 * Por qué una construcción aparte y no vite-prerender-plugin: con Vite 8 el plugin
 * metía el guion como una entrada más del paquete del navegador, lo partía en
 * trozos, dejaba react-dom/server (~200 kB) en dist/assets y el proceso no
 * terminaba nunca (medido en coipo_boton_rojo, 2026-09-25).
 *
 * El grafo que cuelga de aquí NO puede importar App.jsx, CapaPuntos.jsx,
 * EtiquetaImagen.jsx ni nada que traiga leaflet o deck.gl: en Node dan «window is
 * not defined». config.js sí se puede: el build SSR resuelve import.meta.env.
 *
 * No hidrata: main.jsx usa createRoot, que reemplaza este HTML por la app.
 */
import { StrictMode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Portada from './Portada.jsx'

export { cabezaPortada } from './cabeza.js'
export { descripcionPortada } from './textos.js'
export { TITULO, URL_PUBLICA } from './sitio.js'

export function renderPortada({ manifest }) {
  return renderToStaticMarkup(
    <StrictMode>
      <Portada manifest={manifest} estado="Cargando el visor del Catastro…" conAvisoLento />
    </StrictMode>,
  )
}
