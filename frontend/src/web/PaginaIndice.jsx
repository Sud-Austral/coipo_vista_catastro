import Banner from '../components/Banner'
import { CuerpoMetodologia } from '../components/PaginaMetodologia'
import QueEs from '../components/QueEs'
import { fmt } from '../formato'
import { BASE } from './sitio.js'
import { Migas, TablaUsos } from './piezas.jsx'
import { urlComuna, urlRegion } from './rutas.js'
import { fraseNacional } from './textos.js'

/**
 * El índice: todas las regiones con sus comunas, los archivos publicados y la
 * Metodología entera. Es la página del Dataset (JSON-LD): todo lo que ese bloque
 * declara —los archivos, su formato, su tamaño— tiene que VERSE aquí.
 */
export default function PaginaIndice({ manifest, bytesManifest, oficiales, simef, pinus, mayor }) {
  const cap = manifest.capas.cbn_puntos
  const porRegion = manifest.regiones.map((r) => ({
    r,
    comunas: manifest.comunas.filter((c) => c.region === r.cod && c.n > 0)
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es')),
  }))
  return (
    <div className="est-portada">
      <Banner />
      <main className="est">
        <Migas items={[['Visor del Catastro', BASE], ['Cifras por región y comuna']]} />
        <h1 className="est-titulo">Cifras del Catastro por región y comuna</h1>
        <p className="est-bajada">Catastro de Usos de la Tierra y Recursos Vegetacionales · CONAF</p>
        <p className="est-cita" data-frase="">
          {fraseNacional(manifest)}
        </p>
        <section>
          <h2>Qué es este visor</h2>
          <QueEs manifest={manifest} clase="est-parrafo" />
        </section>
        <TablaUsos
          usos={manifest.usos}
          ha={manifest.total.ha}
          n={manifest.total.filas}
          rotulo="Todo Chile, según el Catastro (cada región actualizada en un año distinto)."
        />
        <section id="regiones">
          <h2>Regiones y comunas</h2>
          {porRegion.map(({ r, comunas }) => (
            <div key={r.cod} className="est-region">
              <h3>
                <a href={urlRegion(r)}>{r.oficial}</a> <span className="est-anio">· actualización {r.anio}</span>
              </h3>
              <ul className="est-lista">
                {comunas.map((c) => (
                  <li key={c.cod}>
                    <a href={urlComuna(c)}>{c.etiqueta}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
        <section id="datos">
          <h2>Datos publicados</h2>
          <ul className="est-datos">
            <li>
              <a href={`${BASE}datos/manifest.json`}>manifest.json</a> — índice y vocabularios (JSON,{' '}
              {fmt.format(Math.round(bytesManifest / 1024))} kB).
            </li>
            <li>
              <a href={`${BASE}datos/${cap.archivo}`}>{cap.archivo}</a> — {fmt.format(cap.filas)} polígonos en
              binario columnar ({fmt.format(Math.round(cap.bytes / 1e6))} MB), <code>sha256 {cap.sha256}</code>.
            </li>
          </ul>
        </section>
        <section id="metodologia" className="est-met">
          <h2>Metodología y lo que el visor no dice</h2>
          <CuerpoMetodologia
            manifest={manifest}
            oficiales={oficiales}
            simef={simef}
            pinus={pinus}
            mayor={mayor}
            consultado={null}
          />
        </section>
      </main>
    </div>
  )
}
