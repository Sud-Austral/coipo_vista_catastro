import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ha, haExacta } from '../formato'
import { opciones } from '../filtros'

/**
 * Los filtros temáticos, en dos piezas: un BOTÓN por dimensión y un MODAL con
 * sus clases.
 *
 * POR QUÉ NO SON YA OCHO <details> APILADOS. Con las ocho dimensiones abiertas
 * el panel pasaba de dos mil píxeles de columna dentro de una tira de 320 px
 * que ya scrollea, y comparar dos dimensiones obligaba a plegar una para
 * desplegar la otra. En botonera caben en cuatro filas y el estado de las ocho
 * se lee de una vez.
 *
 * El modal, además, no está atado al ancho del panel: las etiquetas largas de
 * Estructura —«Terreno sobre Límite Altitudinal de la Vegetación»— dejan de
 * partirse en tres líneas.
 *
 * DECISIONES QUE NO SON DE ESTILO:
 *
 * - La cuenta de clases elegidas va EN EL BOTÓN, siempre visible. Un filtro
 *   activo que no se ve hace que el mapa muestre menos de lo que debería sin
 *   nada en pantalla que lo explique, y ésa es la forma más fácil de citar una
 *   cifra equivocada. Antes esto obligaba a sacar la cuenta al <summary>; ahora
 *   sale gratis.
 *
 * - Un botón sin clases disponibles se atenúa pero SIGUE ABRIENDO.
 *   Deshabilitarlo escondería el motivo; abriéndolo se lee por qué está vacío.
 *
 * - Se aplica al instante, sin botón «Aplicar». Es lo que hacía el desplegable,
 *   y es lo que deja ver moverse la cascada mientras se elige.
 *
 * - `checkbox` de verdad y no un botón con aria-pressed: son casillas de
 *   selección múltiple, el lector de pantalla ya sabe anunciarlas, y funcionan
 *   con la barra espaciadora sin que haya que programarlo.
 */

/** Lo que el botón y el modal necesitan saber de la dimensión. */
function useOpciones(def, manifest, cifras, seleccion, busqueda) {
  return useMemo(
    () => opciones(def, manifest, cifras, seleccion, busqueda),
    [def, manifest, cifras, seleccion, busqueda],
  )
}

/**
 * El botón de la botonera.
 *
 * Conserva la clase `.grupo-filtro` que tenía el <details>, y dentro
 * `.gf-titulo`, `.gf-activas` y `.gf-total`. No es nostalgia: la verificación
 * localiza cada dimensión por ahí, y mantener los nombres deja que el rediseño
 * cambie CÓMO SE ABRE sin tocar trece aserciones.
 */
export function BotonFiltro({ def, manifest, cifras, seleccion, onAbrir }) {
  const { total } = useOpciones(def, manifest, cifras, seleccion, '')
  const activas = seleccion.size
  return (
    <button
      type="button"
      className={`grupo-filtro${activas > 0 ? ' con-filtro' : ''}${total === 0 ? ' vacio' : ''}`}
      // Por aquí lo encuentra el panel para devolverle el foco al cerrar el
      // modal. El <dialog> lo devuelve solo, pero aquí se DESMONTA al cerrar
      // —para no tener ocho listas montadas— y entonces el foco cae al body.
      data-col={def.col}
      // El botón abre un diálogo, y decirlo es lo que hace que un lector de
      // pantalla anuncie «abre un cuadro de diálogo» en vez de sólo «botón».
      aria-haspopup="dialog"
      onClick={() => onAbrir(def.col)}
      title={
        activas > 0
          ? `${activas} de ${total} clases elegidas en ${def.titulo}`
          : `${total} clases disponibles en ${def.titulo}`
      }
    >
      <span className="gf-titulo">{def.corto}</span>
      {activas > 0 && <span className="gf-activas">{activas}</span>}
      <span className="gf-total">{total}</span>
    </button>
  )
}

/**
 * El modal de una dimensión.
 *
 * Es un <dialog> nativo abierto con showModal(), igual que ModalFicha: así el
 * navegador aporta gratis el foco atrapado dentro, el cierre con Escape, el
 * fondo inerte, el ::backdrop y la top layer —así que ningún z-index del panel
 * puede taparlo— y la devolución del foco al botón que lo abrió.
 */
export function ModalFiltro({ def, manifest, cifras, seleccion, sinDato, onAlternar, onLimpiar, onCerrar }) {
  const ref = useRef(null)
  const [busqueda, setBusqueda] = useState('')
  const id = useId()

  // La búsqueda se olvida al cambiar de dimensión: heredarla dejaría el modal de
  // Estructura filtrado por lo que se buscó en Especie, sin nada que lo diga.
  useEffect(() => setBusqueda(''), [def.col])

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (def && !d.open) d.showModal()
    else if (!def && d.open) d.close()
  }, [def])

  const { filas, total, recortadas, sinCoincidencias } = useOpciones(
    def, manifest, cifras, seleccion, busqueda,
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
    <dialog
      className="modal-filtro"
      ref={ref}
      aria-labelledby="mf-titulo"
      // 'close' cubre Escape y el botón de cerrar por igual.
      onClose={onCerrar}
      // Un clic en el ::backdrop tiene como target el propio <dialog>; en el
      // contenido, el hijo. Por eso el contenido va envuelto en un <div>.
      onClick={(e) => e.target === ref.current && onCerrar()}
    >
      <div className="mf-caja">
        <header className="mf-cabecera">
          <h2 id="mf-titulo">{def.titulo}</h2>
          <p className="mf-cuenta">
            {activas > 0
              ? `${activas} de ${total} clases elegidas`
              : `${total} ${total === 1 ? 'clase disponible' : 'clases disponibles'}`}
          </p>
          <button type="button" className="ficha-cerrar" onClick={onCerrar} aria-label="Cerrar filtro">
            ×
          </button>
        </header>

        <div className="mf-cuerpo">
          {def.nota && <p className="nota">{def.nota}</p>}
          {/* De dónde sale el vocabulario. «Lo dice la guía de CONAF» y «lo
              dedujimos del dato» no son la misma autoridad, y quien cite una
              cifra tiene derecho a saber cuál de las dos está citando. */}
          {!oficial && (
            <p className="nota nota-voc">
              Vocabulario deducido de los propios datos: la guía oficial de códigos no nombra
              estas clases.
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
              // Separador entre la escala fina y la gruesa. Es un cambio de
              // regla de medida, no un adorno: sin él las dos escalas se leen
              // como una sola lista ordenada y sus tramos se solapan.
              const cabecera =
                def.porEscala && f.escala !== escalaPrevia
                  ? ((escalaPrevia = f.escala), f.escala)
                  : null
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
                      {/* El nombre científico es lo que hace citable una
                          especie: «coihue» son varias y «Nothofagus dombeyi» es
                          una. */}
                      {def.conCientifico && f.cientifico && f.cientifico !== f.etiqueta && (
                        <em className="gf-sub">{f.cientifico}</em>
                      )}
                      {/* La clase padre, para las dimensiones cuyas etiquetas se
                          repiten: «No Aplica» sale 38 veces en Estructura y sólo
                          la subclase las distingue. Es el mismo mecanismo que el
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
                  tiempo remitiendo a un control que estas dimensiones no
                  tenían. */}
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
          {/* Las filas sin dato se declaran: «no tiene valor» no es «vale cero»,
              y callarlo hace que los porcentajes de la dimensión parezcan cubrir
              todo el territorio cuando no lo hacen. */}
          {sinDato > 0 && (
            <p className="nota">
              {sinDato.toLocaleString('es-CL')} polígonos sin este dato. No se reparten entre las
              clases.
            </p>
          )}
        </div>

        <footer className="mf-pie">
          {activas > 0 ? (
            <button type="button" className="limpiar" onClick={() => onLimpiar(def.col)}>
              Quitar el filtro de {def.corto.toLowerCase()}
            </button>
          ) : (
            <span />
          )}
          {/* «Listo» y no «Aplicar»: no hay nada que aplicar, el mapa ya cambió
              con cada casilla. Prometer un Aplicar donde no lo hay haría dudar
              de si el filtro ha entrado. */}
          <button type="button" className="mf-listo" onClick={onCerrar}>
            Listo
          </button>
        </footer>
      </div>
    </dialog>
  )
}
