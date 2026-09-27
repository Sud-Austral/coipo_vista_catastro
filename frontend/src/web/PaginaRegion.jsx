import Banner from '../components/Banner'
import { fmt, haEntera } from '../formato'
import { Bosques, Migas, Pie, Snaspe, TablaUsos } from './piezas.jsx'
import { URL_INDICE, urlComuna, urlVisor } from './rutas.js'
import { fraseRegion } from './textos.js'

/**
 * La página de una región. Además de lo de una comuna, trae la cifra OFICIAL de la
 * planilla de CONAF por uso, con el año de esa planilla: en tres regiones no es el
 * año de las capas que usa el visor, y sin decirlo la tabla pondría lado a lado
 * dos cifras de años distintos.
 */
export default function PaginaRegion({ region, resumen, manifest, oficial, discrepancia, comunas, sinComuna }) {
  const quien = `la ${region.oficial.replace(/^Región/, 'región')}`
  const deOficial = oficial && {
    anio: oficial.anio_actualizacion,
    total: oficial.valores.total,
    porUso: (cod) => oficial.valores[`uso:${cod}`],
  }
  return (
    <div className="est-portada">
      <Banner />
      <main className="est">
        <Migas items={[['Chile', URL_INDICE], [region.oficial]]} />
        <h1 className="est-titulo">{region.oficial}</h1>
        <p className="est-bajada">
          Código regional (CUT) {region.cod} · Catastro, actualización {region.anio} ·{' '}
          {fmt.format(comunas.length)} comunas con polígonos
        </p>
        <p className="est-cita" data-frase="">
          {fraseRegion(region, resumen, oficial)}
        </p>
        <p>
          <a href={urlVisor(region)} rel="nofollow">
            Abrir la {region.oficial.replace(/^Región/, 'región')} en el visor interactivo
          </a>
        </p>
        <TablaUsos
          usos={resumen.usos}
          ha={resumen.ha}
          n={resumen.n}
          oficial={deOficial}
          rotulo={`${region.oficial}, según el Catastro (actualización ${region.anio}), y la cifra oficial de la planilla de CONAF.`}
        />
        {discrepancia && (
          <p className="est-nota">
            El año de la planilla oficial ({discrepancia.en_la_planilla_oficial}) no es el de las capas del Catastro
            que usa el visor ({discrepancia.en_las_capas}). Las dos columnas vienen de fuentes distintas.
          </p>
        )}
        {sinComuna.n > 0 && (
          <p className="est-nota">
            {fmt.format(sinComuna.n)} {sinComuna.n === 1 ? 'polígono' : 'polígonos'} de la región, con{' '}
            {haEntera(sinComuna.ha)}, no {sinComuna.n === 1 ? 'trae' : 'traen'} comuna en el Catastro: cuentan en la
            región y en ninguna comuna.
          </p>
        )}
        <Bosques resumen={resumen} quien={quien} />
        <Snaspe resumen={resumen} quien={quien} />
        <section>
          <h2>Comunas</h2>
          <ul className="est-lista">
            {comunas.map((c) => (
              <li key={c.cod}>
                <a href={urlComuna(c)}>{c.etiqueta}</a>
              </li>
            ))}
          </ul>
        </section>
        <Pie manifest={manifest} />
      </main>
    </div>
  )
}
