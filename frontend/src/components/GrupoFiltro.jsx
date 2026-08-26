import { useId, useMemo, useState } from 'react'
import { ha, haExacta } from '../formato'
import { opciones } from '../filtros'

/**
 * Un filtro por dimensión. Sirve para las nueve sin saber nada de ninguna: lo
 * que hay que decir de cada una viene en su descriptor y sus clases en el
 * manifest.
 *
 * Es un <details> y no una lista siempre abierta porque nueve dimensiones
 * abiertas a la vez son varios miles de píxeles de columna — la de especies
 * sola tiene 989 clases.
 *
 * DECISIONES QUE NO SON DE ESTILO:
 *
 * - La cuenta de clases activas va en el <summary>, así que se ve CON EL GRUPO
 *   PLEGADO. Un filtro activo escondido dentro de un desplegable cerrado hace
 *   que el mapa muestre menos de lo que debería sin nada en pantalla que lo
 *   explique, y esa es la forma más fácil de citar una cifra equivocada.
 *
 * - Las clases sin coincidencias se QUITAN, y el pie dice cuántas son. Se
 *   dibujaban apagadas con un cero mientras las cifras salían del recorte
 *   completo, porque entonces marcar una clase vaciaba a todas sus hermanas y
 *   la lista habría quedado en una fila. Con el marginal (`resumenYMarginales`)
 *   lo que cae a cero es lo que de verdad no tiene intersección.
 *
 * - `checkbox` de verdad y no un botón con aria-pressed: son casillas de
 *   selección múltiple, el lector de pantalla ya sabe anunciarlas, y funcionan
 *   con la barra espaciadora sin que haya que programarlo.
 */
export default function GrupoFiltro({ def, manifest, cifras, seleccion, sinDato, onAlternar, onLimpiar }) {
  const [busqueda, setBusqueda] = useState('')
  const id = useId()

  const { filas, total, recortadas, sinCoincidencias } = useMemo(
    () => opciones(def, manifest, cifras, seleccion, busqueda),
    [def, manifest, cifras, seleccion, busqueda],
  )
  // Sin ningún filtro activo las cifras son las nacionales, así que lo que se
  // oculta no es «no coincide con tu filtro»: son clases del vocabulario que no
  // tienen un solo polígono en todo el Catastro. Son cosas distintas y decirlas
  // igual sería mentir en una de las dos.
  const hayRecorte = cifras?.fuente !== 'manifest'

  const activas = seleccion.size
  const oficial = manifest?.vocabulario?.[def.clave] === 'guia'

  let escalaPrevia = null

  return (
    <details className="grupo-filtro" open={def.abierto}>
      <summary>
        <span className="gf-titulo">{def.corto}</span>
        {activas > 0 && (
          <span className="gf-activas" title={`${activas} de ${total} clases elegidas`}>
            {activas}
          </span>
        )}
        <span className="gf-total">{total}</span>
      </summary>

      {def.nota && <p className="nota">{def.nota}</p>}
      {/* De dónde sale el vocabulario. «Lo dice la guía de CONAF» y «lo
          dedujimos del dato» no son la misma autoridad, y quien cite una cifra
          tiene derecho a saber cuál de las dos está citando. */}
      {!oficial && (
        <p className="nota nota-voc">
          Vocabulario deducido de los propios datos: la guía oficial de códigos no nombra estas
          clases.
        </p>
      )}

      {def.buscador && (
        <label className="gf-buscar">
          <span className="visualmente-oculto">Buscar en {def.titulo}</span>
          <input
            type="search"
            value={busqueda}
            placeholder={`Buscar entre ${total}…`}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </label>
      )}

      <ul className="gf-lista">
        {filas.map((f) => {
          // Separador entre la escala fina y la gruesa. Es un cambio de regla de
          // medida, no un adorno: sin él las dos escalas se leen como una sola
          // lista ordenada y sus tramos se solapan.
          const cabecera =
            def.porEscala && f.escala !== escalaPrevia ? ((escalaPrevia = f.escala), f.escala) : null
          return (
            <li key={f.cod}>
              {cabecera && (
                <p className="gf-escala">
                  {cabecera === 'fina'
                    ? 'Escala en metros'
                    : cabecera === 'gruesa'
                      ? 'Escala gruesa · se solapa con la anterior'
                      : 'Sin altura aplicable'}
                </p>
              )}
              <label className={f.n === 0 ? 'gf-opcion vacia' : 'gf-opcion'}>
                <input
                  type="checkbox"
                  name={`${id}-${def.col}`}
                  checked={f.marcada}
                  onChange={() => onAlternar(def.col, f.i)}
                />
                <span className="gf-etq">
                  {f.etiqueta}
                  {/* El nombre científico es lo que hace citable una especie:
                      «coihue» son varias y «Nothofagus dombeyi» es una. */}
                  {def.conCientifico && f.cientifico && f.cientifico !== f.etiqueta && (
                    <em className="gf-sub">{f.cientifico}</em>
                  )}
                  {/* La clase padre, para las dimensiones cuyas etiquetas se
                      repiten: «No Aplica» sale 38 veces en Estructura y sólo la
                      subclase las distingue. Es el mismo mecanismo que el
                      nombre científico, que ya resolvía esto en Especie. */}
                  {f.contexto && <em className="gf-sub">{f.contexto}</em>}
                  {f.categoria && <em className="gf-sub">{f.categoria}</em>}
                  {f.legal && <em className="gf-sub gf-legal">{f.legal}</em>}
                </span>
                <span className="gf-cifra" title={haExacta(f.ha)}>
                  {f.n === 0 ? '—' : ha(f.ha)}
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      {filas.length === 0 && (
        <p className="nota">
          {busqueda
            ? `Ninguna clase coincide con «${busqueda}».`
            : 'Ninguna clase de esta dimensión coincide con los demás filtros.'}
        </p>
      )}
      {recortadas > 0 && (
        <p className="nota">
          Se listan las {filas.length} mayores de {total}.{' '}
          {/* No se promete un buscador donde no lo hay: el mensaje llevaba
              tiempo remitiendo a un control que estas dimensiones no tenían. */}
          {def.buscador
            ? `Usa el buscador para llegar a las otras ${recortadas}.`
            : `Quedan ${recortadas} fuera de la lista.`}
        </p>
      )}
      {/* Lo que se oculta se dice. Que la lista encoja en silencio haría que
          una clase pareciera no existir nunca. */}
      {sinCoincidencias > 0 && (
        <p className="nota">
          {hayRecorte
            ? `${sinCoincidencias} clases más no coinciden con el recorte actual.`
            : `${sinCoincidencias} clases del vocabulario no tienen ningún polígono en el Catastro.`}
        </p>
      )}
      {/* Las filas sin dato se declaran: «no tiene valor» no es «vale cero», y
          callarlo hace que los porcentajes de la dimensión parezcan cubrir todo
          el territorio cuando no lo hacen. */}
      {sinDato > 0 && (
        <p className="nota">
          {sinDato.toLocaleString('es-CL')} polígonos sin este dato. No se reparten entre las
          clases.
        </p>
      )}
      {activas > 0 && (
        <button type="button" className="limpiar" onClick={() => onLimpiar(def.col)}>
          Quitar el filtro de {def.corto.toLowerCase()}
        </button>
      )}
    </details>
  )
}
