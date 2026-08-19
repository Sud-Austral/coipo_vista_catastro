import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// El repo no se llama <org>.github.io, asi que Pages sirve la app bajo el
// subpath /coipo_vista_catastro/. Sin este `base` los assets se piden a la raiz
// del dominio y la app sale en blanco al desplegar, aunque funcione en dev.
// Todas las rutas de datos deben usar import.meta.env.BASE_URL (ver src/config.js).
//
// Y va AQUI, fijo, en vez de pasarse por linea de comandos: Git Bash reescribe
// cualquier argumento que empiece por '/' a una ruta de Windows, asi que
// `--base=/coipo_vista_catastro/` llega como
// `/C:/Program Files/Git/coipo_vista_catastro/` y el build NO falla: emite
// rutas rotas y termina con codigo 0. La asercion de verificacion comprueba
// que dist/index.html contenga literalmente '/coipo_vista_catastro/assets/'.
export default defineConfig({
  base: '/coipo_vista_catastro/',
  plugins: [react()],
  build: {
    // El .bin de 23,8 MB no puede acabar en linea dentro del bundle.
    assetsInlineLimit: 0,
  },
})
