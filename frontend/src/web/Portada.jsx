import Banner from '../components/Banner'
import QueEs from '../components/QueEs'
import { rangoAniosTexto } from '../hechos.js'
import { TablaUsos } from './piezas.jsx'
import { URL_INDICE, urlRegion } from './rutas.js'
import { fraseNacional } from './textos.js'

/**
 * La portada que ven quienes no ejecutan JavaScript: los asistentes de IA, las
 * vistas previas de las redes, y cualquier persona durante los segundos que tarda
 * en bajar el visor. Sin esto, recibían «Cargando el Catastro nacional…» y nada
 * más, y un asistente no podía citar una sola cifra (DECISIONES §M.0).
 *
 * SE DIBUJA EN TRES SITIOS, y ésa es la idea (guía §5.3):
 *   1. horneada en dist/index.html al construir (scripts/prerender.mjs);
 *   2. en la rama de CARGA de la app, mientras baja el .bin de 49 MB;
 *   3. en la rama de ERROR de la app.
 * Googlebot indexa el DOM que queda DESPUÉS de ejecutar el JavaScript, y no baja un
 * archivo de 49 MB: sin (2) y (3), `createRoot` borraba lo horneado y Google se
 * quedaba con la pantalla de error. Las tres salen del manifest (636 kB), que sí
 * baja; ninguna necesita el .bin.
 *
 * Pura: sin window, document ni efectos, porque se renderiza en Node. Y con clases
 * `est-*` propias: el HTML horneado NO puede llevar las clases que el arnés usa
 * para saber que la app montó (.app, .grupo-filtro, .descargando…).
 */
export default function Portada({ manifest, estado, conBanner = true, conAvisoLento = false, nivel = 1 }) {
  const Titulo = `h${nivel}`
  const Sub = `h${nivel + 1}`
  return (
    <div className="est-portada">
      {conBanner && <Banner />}
      <div className="est">
        {/* Con `conAvisoLento` (lo horneado) la línea lleva el id que busca el
            script de index.html, que CAMBIA SU TEXTO si la carga pasa de 15 s: la
            pantalla deja de mentir diciendo «cargando». Un párrafo oculto con el
            aviso ya escrito lo leería igual un asistente, y le diría que algo va
            lento. */}
        {estado && (
          <div className="est-estado" role="status" id={conAvisoLento ? 'arranque-lento' : undefined}>
            {estado}
          </div>
        )}
        <Titulo className="est-titulo">Catastro de Usos de la Tierra y Recursos Vegetacionales</Titulo>
        <p className="est-bajada">Visor de CONAF · Gerencia de Fiscalización Forestal y Evaluación Ambiental</p>

        {manifest && (
          <p className="est-cita" data-frase="">
            {fraseNacional(manifest)}
          </p>
        )}

        <section id="que-es">
          <Sub>Qué es este visor</Sub>
          <QueEs manifest={manifest} clase="est-parrafo" />
        </section>

        {manifest && (
          <TablaUsos
            usos={manifest.usos}
            ha={manifest.total.ha}
            n={manifest.total.filas}
            Sub={Sub}
            rotulo={`Todo Chile, según el Catastro (cada región actualizada en un año distinto, entre ${rangoAniosTexto(manifest)}).`}
          />
        )}

        {/* Los enlaces a las páginas por región y al índice, EN EL HTML CRUDO:
            por aquí las descubre un rastreador antes de leer el sitemap. */}
        {manifest && (
          <section id="regiones">
            <Sub>Cifras por región y comuna</Sub>
            <ul className="est-lista">
              {manifest.regiones.map((r) => (
                <li key={r.cod}>
                  <a href={urlRegion(r)}>{r.oficial}</a>
                </li>
              ))}
            </ul>
            <p>
              <a href={URL_INDICE}>Todas las regiones y sus comunas, los datos publicados y la metodología</a>
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
