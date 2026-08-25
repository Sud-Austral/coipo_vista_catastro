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
 * - Las clases que el filtro ha dejado en cero se dibujan apagadas y con su
 *   cero, no se quitan. Si la lista se encogiera al filtrar, la clase que
 *   alguien busca parecería no existir.
 *
 * - `checkbox` de verdad y no un botón con aria-pressed: son casillas de
 *   selección múltiple, el lector de pantalla ya sabe anunciarlas, y funcionan
 *   con la barra espaciadora sin que haya que programarlo.
 */
export default function GrupoFiltro({ def, manifest, resumen, seleccion, sinDato, onAlternar, onLimpiar }) {
  const [busqueda, setBusqueda] = useState('')
  const id = useId()

  const { filas, total, recortadas } = useMemo(
    () => opciones(def, manifest, resumen, seleccion, busqueda),
    [def, manifest, resumen, seleccion, busqueda],
  )

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
        <p className="nota">Ninguna clase coincide con «{busqueda}».</p>
      )}
      {recortadas > 0 && (
        <p className="nota">
          Se listan las {filas.length} mayores de {total}. Usa el buscador para llegar a las otras{' '}
          {recortadas}.
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
