import Banner from '../components/Banner'
import { Bosques, Migas, Pie, Snaspe, TablaUsos } from './piezas.jsx'
import { URL_INDICE, urlRegion, urlVisor } from './rutas.js'
import { fraseComuna } from './textos.js'

/**
 * La página de una comuna: lo que un asistente cita cuando le preguntan por ella.
 * La frase va primero y entera; la tabla, después, para quien quiera comprobar.
 * El CUT se ve en la página porque el JSON-LD lo declara (Google exige que los
 * datos estructurados digan sólo lo que está a la vista).
 */
export default function PaginaComuna({ comuna, region, resumen, manifest }) {
  const quien = `la comuna de ${comuna.etiqueta}`
  return (
    <div className="est-portada">
      <Banner />
      <main className="est">
        <Migas items={[['Chile', URL_INDICE], [region.oficial, urlRegion(region)], [comuna.etiqueta]]} />
        <h1 className="est-titulo">Comuna de {comuna.etiqueta}</h1>
        <p className="est-bajada">
          {region.oficial} · Provincia de {comuna.provincia} · Código comunal (CUT) {comuna.cod} · Catastro,
          actualización {region.anio}
        </p>
        <p className="est-cita" data-frase="">
          {fraseComuna(comuna, region, resumen)}
        </p>
        {/* nofollow: el visor con ?com= tiene canonical a la portada, y 343
            enlaces a él sólo harían que Google renderizara la app 343 veces. */}
        <p>
          <a href={urlVisor(region, comuna)} rel="nofollow">
            Abrir la comuna de {comuna.etiqueta} en el visor interactivo
          </a>
        </p>
        <TablaUsos
          usos={resumen.usos}
          ha={resumen.ha}
          n={resumen.n}
          rotulo={`Comuna de ${comuna.etiqueta}, según el Catastro (actualización ${region.anio} de la región).`}
        />
        <Bosques resumen={resumen} quien={quien} />
        <Snaspe resumen={resumen} quien={quien} />
        <Pie manifest={manifest} />
      </main>
    </div>
  )
}
