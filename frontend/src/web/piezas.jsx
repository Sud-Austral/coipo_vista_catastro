import CitaVisor from '../components/CitaVisor'
import { fmt, haEntera, pct } from '../formato'
import { URL_INDICE } from './rutas.js'
import { BASE } from './sitio.js'

/*
 * Piezas comunes de lo horneado: las tablas y el pie que repiten la portada, las
 * páginas de región y comuna y el índice. Puras (se renderizan en Node) y con
 * clases est-* (el HTML horneado no puede llevar las clases de la app).
 */

/** Migas: Chile › Región › Comuna. La última no es enlace. */
export function Migas({ items }) {
  return (
    <nav className="est-migas" aria-label="Dónde estás">
      <ol>
        {items.map(([texto, href]) => (
          <li key={texto}>{href ? <a href={href}>{texto}</a> : <span aria-current="page">{texto}</span>}</li>
        ))}
      </ol>
    </nav>
  )
}

/**
 * Superficie por uso de la tierra. `oficial`, si llega, es { anio, porUso(cod) } y
 * añade la columna de la planilla oficial de CONAF (sólo existe por región).
 */
export function TablaUsos({ usos, ha, n, rotulo, oficial, Sub = 'h2' }) {
  return (
    <section>
      <Sub>Superficie por uso de la tierra</Sub>
      <table className="est-tabla">
        <caption>{rotulo} Hectáreas enteras.</caption>
        <thead>
          <tr>
            <th scope="col">Uso de la tierra</th>
            <th scope="col" className="num">Superficie</th>
            <th scope="col" className="num">Del total</th>
            <th scope="col" className="num">Polígonos</th>
            {oficial && <th scope="col" className="num">Cifra oficial ({oficial.anio})</th>}
          </tr>
        </thead>
        <tbody>
          {usos.map((u) => (
            <tr key={u.cod}>
              <th scope="row">{u.etiqueta}</th>
              <td className="num">{haEntera(u.ha)}</td>
              <td className="num">{pct(u.ha, ha)}</td>
              <td className="num">{fmt.format(u.n)}</td>
              {oficial && <td className="num">{haEntera(oficial.porUso(u.cod))}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="num">{haEntera(ha)}</td>
            <td className="num">100 %</td>
            <td className="num">{fmt.format(n)}</td>
            {oficial && <td className="num">{haEntera(oficial.total)}</td>}
          </tr>
        </tfoot>
      </table>
    </section>
  )
}

const TIPO_NO_APLICA = '00'

/** Los bosques de un territorio: nativo, plantación y mixto, y sus tipos forestales. */
export function Bosques({ resumen, quien }) {
  const bosques = resumen.usos.find((u) => u.cod === '04')
  if (!bosques) return null
  const sub = resumen.subusos.filter((s) => s.uso === '04' && s.ha > 0)
  const tipos = resumen.tiposForestales.filter((t) => t.cod !== TIPO_NO_APLICA && t.ha > 0).slice(0, 8)
  return (
    <section>
      <h2>Los bosques</h2>
      <table className="est-tabla">
        <caption>Bosques de {quien}, por subuso. Hectáreas enteras.</caption>
        <thead>
          <tr>
            <th scope="col">Subuso</th>
            <th scope="col" className="num">Superficie</th>
            <th scope="col" className="num">De los bosques</th>
          </tr>
        </thead>
        <tbody>
          {sub.map((s) => (
            <tr key={s.cod}>
              <th scope="row">{s.etiqueta}</th>
              <td className="num">{haEntera(s.ha)}</td>
              <td className="num">{pct(s.ha, bosques.ha)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {tipos.length > 0 && (
        <table className="est-tabla">
          <caption>Tipos forestales principales de {quien}. Hectáreas enteras.</caption>
          <thead>
            <tr>
              <th scope="col">Tipo forestal</th>
              <th scope="col" className="num">Superficie</th>
            </tr>
          </thead>
          <tbody>
            {tipos.map((t) => (
              <tr key={t.cod}>
                <th scope="row">{t.etiqueta}</th>
                <td className="num">{haEntera(t.ha)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** Unidades del SNASPE que tocan el territorio, si hay. */
export function Snaspe({ resumen, quien }) {
  const u = resumen.snaspe.filter((s) => s.ha > 0)
  if (!u.length) return null
  return (
    <section>
      <h2>Áreas silvestres protegidas (SNASPE)</h2>
      <table className="est-tabla">
        <caption>Superficie catastrada de {quien} dentro de cada unidad. Hectáreas enteras.</caption>
        <thead>
          <tr>
            <th scope="col">Unidad</th>
            <th scope="col" className="num">Superficie</th>
          </tr>
        </thead>
        <tbody>
          {u.map((s) => (
            <tr key={s.cod}>
              <th scope="row">{s.etiqueta}</th>
              <td className="num">{haEntera(s.ha)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** Pie: de dónde sale, cómo citarlo y adónde ir. `consultado` es null en lo horneado. */
export function Pie({ manifest }) {
  return (
    <footer className="est-pie">
      <p>
        Fuente: {manifest.fuente}. Cifras calculadas por el visor sobre los polígonos publicados; pueden
        diferir levemente de las oficiales de CONAF.
      </p>
      <p>Cómo citar:</p>
      <CitaVisor sha256={manifest.capas.cbn_puntos.sha256} consultado={null} />
      <p>
        <a href={BASE}>Visor del Catastro</a> · <a href={URL_INDICE}>Cifras por región y comuna</a> ·{' '}
        <a href={`${URL_INDICE}#metodologia`}>Metodología y lo que el visor no dice</a>
      </p>
    </footer>
  )
}
