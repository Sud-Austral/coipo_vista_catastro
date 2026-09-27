import Banner from '../components/Banner'
import QueEs from '../components/QueEs'
import { fmt, haEntera, pct } from '../formato'
import { rangoAniosTexto } from '../hechos.js'
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

        {manifest && <TablaUsos manifest={manifest} Sub={Sub} />}
      </div>
    </div>
  )
}

/** Superficie por uso de la tierra, todo Chile: la tabla que un asistente puede leer entera. */
function TablaUsos({ manifest, Sub }) {
  const total = manifest.total.ha
  const rango = rangoAniosTexto(manifest)
  return (
    <section>
      <Sub>Superficie por uso de la tierra</Sub>
      <table className="est-tabla">
        <caption>
          Todo Chile, según el Catastro (cada región actualizada en un año distinto, entre {rango}).
          Hectáreas enteras.
        </caption>
        <thead>
          <tr>
            <th scope="col">Uso de la tierra</th>
            <th scope="col" className="num">Superficie</th>
            <th scope="col" className="num">Del total</th>
            <th scope="col" className="num">Polígonos</th>
          </tr>
        </thead>
        <tbody>
          {manifest.usos.map((u) => (
            <tr key={u.cod}>
              <th scope="row">{u.etiqueta}</th>
              <td className="num">{haEntera(u.ha)}</td>
              <td className="num">{pct(u.ha, total)}</td>
              <td className="num">{fmt.format(u.n)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="num">{haEntera(total)}</td>
            <td className="num">100 %</td>
            <td className="num">{fmt.format(manifest.total.filas)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  )
}
