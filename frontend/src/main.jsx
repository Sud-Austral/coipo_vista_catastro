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

// El cascaron de arranque de index.html se quita ANTES del primer render, no
// dentro de un efecto: si se quitara despues habria un frame con el cascaron y
// la app pintados a la vez.
document.getElementById('arranque')?.remove()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
