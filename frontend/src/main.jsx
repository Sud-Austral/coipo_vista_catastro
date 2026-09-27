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

// #root trae la portada HORNEADA al construir (scripts/prerender.mjs). createRoot
// no hidrata: en su primer commit vacía el contenedor y pone la app, que mientras
// baja el .bin dibuja la MISMA portada encima (App.jsx), así que no cambia lo que
// se lee. Hidratar no serviría: el primer render depende del tema, del ancho de
// la ventana, de localStorage y de la URL, que en Node no existen.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
