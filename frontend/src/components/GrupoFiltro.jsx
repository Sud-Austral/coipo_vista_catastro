import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ha, haExacta } from '../formato'
import { opciones } from '../filtros'

/**
 * La botonera del panel, en dos piezas reutilizables —un BOTÓN y una CAJA de
 * modal— y la pareja concreta que sirve a las nueve dimensiones temáticas.
 *
 * POR QUÉ NO SON YA <details> APILADOS NI <select>. Con las dimensiones
 * abiertas el panel pasaba de dos mil píxeles de columna dentro de una tira de
 * 320 px que ya scrollea, y comparar dos obligaba a plegar una para desplegar la
 * otra. En botonera caben en filas de dos y el estado de todas se lee de una vez.
 *
 * El modal, además, no está atado al ancho del panel: las etiquetas largas de
 * Estructura —«Terreno sobre Límite Altitudinal de la Vegetación»— dejan de
 * partirse en tres líneas.
 *
 * ONCE BOTONES, NO OCHO. Territorio, Uso y Mapa base eran <select> y lista
 * mientras el resto eran botones: la misma pregunta —«¿qué estoy mirando?»— se
 * respondía de tres formas distintas en el mismo panel. Ahora los tres pasan por
 * `BotonControl` + `CajaModal`, y por eso esas dos piezas están separadas de
 * `BotonFiltro`/`ModalFiltro`: lo que comparten es el CONTINENTE —el anclaje a
 * la izquierda, el foco atrapado, Escape, el pie con «Listo»—, no la lista.
 *
 * DECISIONES QUE NO SON DE ESTILO:
 *
 * - Lo elegido va EN EL BOTÓN, siempre visible. Un filtro activo que no se ve
 *   hace que el mapa muestre menos de lo que debería sin nada en pantalla que lo
 *   explique, y ésa es la forma más fácil de citar una cifra equivocada.
 *
 * - Un botón sin opciones disponibles se atenúa pero SIGUE ABRIENDO.
 *   Deshabilitarlo escondería el motivo; abriéndolo se lee por qué está vacío.
 *
 * - Se aplica al instante, sin botón «Aplicar». Es lo que hacía el desplegable,
 *   y es lo que deja ver moverse la cascada mientras se elige. Con el modal
 *   anclado a la izquierda el mapa queda a la vista, así que el cambio se ve.
 *
 * - `checkbox` y `radio` de verdad, no botones con aria-pressed: el lector de
 *   pantalla ya sabe anunciarlos, y funcionan con teclado sin programarlo.
 */

/** Lo que el botón y el modal necesitan saber de la dimensión. */
function useOpciones(def, manifest, cifras, seleccion, busqueda) {
  return useMemo(
    () => opciones(def, manifest, cifras, seleccion, busqueda),
    [def, manifest, cifras, seleccion, busqueda],
  )
}

/**
 * Un botón de la botonera, sea del control que sea.
 *
 * Conserva la clase `.grupo-filtro` que tenía el <details>, y dentro
 * `.gf-titulo`, `.gf-activas` y `.gf-total`. No es nostalgia: la verificación
 * localiza cada control por ahí, y mantener los nombres deja que el rediseño
 * cambie CÓMO SE ABRE sin tocar trece aserciones.
 */
export function BotonControl({ col, corto, valor, total, activas = 0, chips, titulo, onAbrir }) {
  return (
    <button
      type="button"
      className={`grupo-filtro${activas > 0 || valor ? ' con-filtro' : ''}${
        total === 0 ? ' vacio' : ''
      }`}
      // Por aquí lo encuentra el panel para devolverle el foco al cerrar el
      // modal. El <dialog> lo devuelve solo, pero aquí se DESMONTA al cerrar
      // —para no tener once listas montadas— y entonces el foco cae al body.
      data-col={col}
      // El botón abre un diálogo, y decirlo es lo que hace que un lector de
      // pantalla anuncie «abre un cuadro de diálogo» en vez de sólo «botón».
      aria-haspopup="dialog"
      onClick={() => onAbrir(col)}
      title={titulo}
    >
      <span className="gf-titulo">{corto}</span>
      {/* La tira de color del botón de Uso. Es la MITIGACIÓN de haber quitado
          la leyenda del panel: sin ella el color se quedaba sin nada que lo
          nombrase a la vista, así que al menos la secuencia de tonos sigue
          delante y decir «el verde oscuro» sigue teniendo referente. No
          sustituye a la leyenda y no se pretende que lo haga. */}
      {chips && (
        <span className="gf-chips" aria-hidden="true">
          {chips.map((c, i) => (
            <span key={i} className="chip" style={{ background: c }} />
          ))}
        </span>
      )}
      {activas > 0 && <span className="gf-activas">{activas}</span>}
      <span className="gf-total">{total}</span>
      {/* El valor va EL ÚLTIMO en el DOM y salta a su propia línea: en la
          primera no cabe «Los Lagos › Chiloé › Ancud» junto al título sin
          empujar la cuenta fuera del botón. */}
      {valor && <span className="gf-valor">{valor}</span>}
    </button>
  )
}

/**
 * La caja de un modal del panel, sin saber qué lleva dentro.
 *
 * Es un <dialog> nativo abierto con showModal(), igual que ModalFicha: así el
 * navegador aporta gratis el foco atrapado dentro, el cierre con Escape, el
 * fondo inerte, el ::backdrop y la top layer —así que ningún z-index del panel
 * puede taparlo— y la devolución del foco al botón que lo abrió.
 *
 * VA ANCLADA A LA IZQUIERDA, y eso es CSS, no JS: el navegador centra los
 * diálogos modales con `inset: 0; margin: auto`, y basta con `margin: 0` y un
 * `inset` propio para pegarla al borde. El `::backdrop` se vuelve transparente
 * en la misma regla, porque cubre TODA la pantalla y sin eso el mapa quedaría
 * igual de velado por mucho que la caja se corriera a un lado. El sentido de
 * anclarla es ver el mapa cambiar mientras se elige.
 */
export function CajaModal({ titulo, cuenta, onCerrar, etiquetaCerrar, pie, children }) {
  const ref = useRef(null)
  const id = useId()

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  return (
    <dialog
      className="modal-filtro"
      ref={ref}
      // useId y no un literal: con once modales posibles, un id fijo saldría
      // repetido en cuanto dos coexistieran aunque sea un instante, y un
      // aria-labelledby ambiguo deja el diálogo sin nombre anunciado.
      aria-labelledby={id}
      // 'close' cubre Escape y el botón de cerrar por igual.
      onClose={onCerrar}
      // Un clic en el ::backdrop tiene como target el propio <dialog>; en el
      // contenido, el hijo. Por eso el contenido va envuelto en un <div>.
      onClick={(e) => e.target === ref.current && onCerrar()}
    >
      <div className="mf-caja">
        <header className="mf-cabecera">
          <h2 id={id}>{titulo}</h2>
          {cuenta && <p className="mf-cuenta">{cuenta}</p>}
          <button
            type="button"
            className="ficha-cerrar"
            onClick={onCerrar}
            aria-label={etiquetaCerrar ?? `Cerrar ${titulo}`}
          >
            ×
          </button>
        </header>

        <div className="mf-cuerpo">{children}</div>

        <footer className="mf-pie">
          {pie ?? <span />}
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

/** El botón de una dimensión temática, con su cuenta de clases elegidas. */
export function BotonFiltro({ def, manifest, cifras, seleccion, chips, onAbrir }) {
  const { total } = useOpciones(def, manifest, cifras, seleccion, '')
  const activas = seleccion.size
  return (
    <BotonControl
      col={def.col}
      corto={def.corto}
      total={total}
      activas={activas}
      chips={chips}
      onAbrir={onAbrir}
      titulo={
        activas > 0
          ? `${activas} de ${total} clases elegidas en ${def.titulo}`
          : `${total} clases disponibles en ${def.titulo}`
      }
    />
  )
}

/** El modal de una dimensión temática: la lista de sus clases. */
export function ModalFiltro({
  def, manifest, cifras, seleccion, sinDato, paleta, onAlternar, onLimpiar, onCerrar,
}) {
  const [busqueda, setBusqueda] = useState('')
  const id = useId()

  // La búsqueda se olvida al cambiar de dimensión: heredarla dejaría el modal de
  // Estructura filtrado por lo que se buscó en Especie, sin nada que lo diga.
  useEffect(() => setBusqueda(''), [def.col])

  const { filas, total, recortadas, sinCoincidencias } = useOpciones(
    def, manifest, cifras, seleccion, busqueda,
  )
  // Sin ningún filtro activo las cifras son las nacionales, así que lo que se
  // oculta no es «no coincide con tu filtro»: son clases del vocabulario que no
  // tienen un solo polígono en todo el Catastro. Son cosas distintas y decirlas
  // igual sería mentir en una de las dos.
  const hayRecorte = cifras?.fuente !== 'manifest'
  const activas = seleccion.size
  // De dónde sale el vocabulario de esta dimensión, en tres estados y no dos:
  // la guía oficial, el propio dato, o una tabla auxiliar. Distinguir el tercero
  // importa —las seis dimensiones de la especie las clasifica la Unidad de
  // Información y Análisis, no el Catastro—, y decir «deducido de los propios
  // datos» les atribuiría una clasificación que el Catastro no hace.
  const origenVoc = manifest?.vocabulario?.[def.clave]
  const oficial = origenVoc === 'guia'
  const deTabla = String(origenVoc ?? '').includes('homologacion')

  let escalaPrevia = null

  return (
    <CajaModal
      titulo={def.titulo}
      cuenta={
        activas > 0
          ? `${activas} de ${total} clases elegidas`
          : `${total} ${total === 1 ? 'clase disponible' : 'clases disponibles'}`
      }
      etiquetaCerrar="Cerrar filtro"
      onCerrar={onCerrar}
      pie={
        activas > 0 ? (
          <button type="button" className="limpiar" onClick={() => onLimpiar(def.col)}>
            Quitar el filtro de {def.corto.toLowerCase()}
          </button>
        ) : null
      }
    >
      {def.nota && <p className="nota">{def.nota}</p>}
      {/* De dónde sale el vocabulario. «Lo dice la guía de CONAF» y «lo
          dedujimos del dato» no son la misma autoridad, y quien cite una
          cifra tiene derecho a saber cuál de las dos está citando. */}
      {!oficial && (
        <p className="nota nota-voc">
          {origenVoc === 'homologacion'
            ? 'Clasificación de la Unidad de Información y Análisis, no del Catastro: el ' +
              'Catastro no registra este atributo.'
            : deTabla
              ? 'Vocabulario deducido de los propios datos y homologado contra una tabla ' +
                'revisada: la guía oficial de códigos no nombra estas clases.'
              : 'Vocabulario deducido de los propios datos: la guía oficial de códigos no ' +
                'nombra estas clases.'}
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
              <label
                className={`gf-opcion${f.n === 0 ? ' vacia' : ''}${paleta ? ' con-chip' : ''}`}
              >
                <input
                  type="checkbox"
                  name={`${id}-${def.col}`}
                  checked={f.marcada}
                  onChange={() => onAlternar(def.col, f.i)}
                />
                {/* El chip de color SÓLO en la dimensión que tiene color. Es lo
                    que la leyenda hacía en el panel: nombrar el tono. Aquí
                    además va pegado a la casilla que aísla la clase, que es el
                    otro mecanismo de la simbología. */}
                {paleta && <span className="chip" style={{ background: paleta[f.cod] }} />}
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
    </CajaModal>
  )
}
