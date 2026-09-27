import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// leaflet.css PRIMERO, y el orden importa: su hoja trae
// `.leaflet-container { background: #ddd }`, que con la misma especificidad que
// la nuestra gana por venir despues. El sintoma es sutil y feo: la interfaz en
// modo oscuro y el hueco del mapa en gris claro. Visto en captura.
import 'leaflet/dist/leaflet.css'
import './index.css'
import './App.css'
import App from './App.jsx'

import { DATA } from './config'

// #root trae la portada HORNEADA al construir (scripts/prerender.mjs). createRoot
// no hidrata: en su primer commit vacía el contenedor y pone la app, que mientras
// baja el .bin dibuja la MISMA portada encima (App.jsx). Hidratar no serviría: el
// primer render depende del tema, del ancho de la ventana, de localStorage y de la
// URL, que en Node no existen.
//
// SE MONTA CON EL MANIFEST YA EN LA MANO. Montando antes, la portada de la app salía
// sin la frase, la tabla ni los enlaces —todo sale del manifest— hasta que llegaba, y
// en una conexión lenta el texto horneado desaparecía durante segundos (revisión del
// 2026-09-26). Se pide aquí, antes de montar, y la app lo reutiliza en vez de pedirlo
// otra vez. Si tarda más de 4 s se monta igual. También se conserva el scroll: quien
// había bajado hasta la tabla no vuelve arriba.
const scrollInicial = window.scrollY
const manifestPromesa = fetch(`${DATA}/manifest.json`, { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null)
const plazo = new Promise((listo) => setTimeout(() => listo(null), 4000))

Promise.race([manifestPromesa, plazo]).then((manifest) => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App manifestInicial={manifest} manifestPromesa={manifestPromesa} scrollInicial={scrollInicial} />
    </StrictMode>,
  )
})
