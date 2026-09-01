import { useState } from 'react'
import { AVISO_PUNTOS, BASEMAPS } from '../config'
import { fmt } from '../formato'
import { flush } from '../urlState'
import { CajaModal } from './GrupoFiltro'

/**
 * Los tres botones del pie del panel: Información, Descargar y Compartir.
 *
 * POR QUÉ EL PANEL SE QUEDÓ SIN UNA SOLA LÍNEA DE PROSA. Tenía seis párrafos de
 * nota, una sección de simbología y un pie con cuatro atribuciones, y todo eso
 * competía por el sitio con los diecisiete controles que son la razón de estar
 * ahí. La prosa no se ha borrado: se ha mudado entera aquí, y se lee cuando se
 * busca, no cada vez que se filtra.
 *
 * Usan `CajaModal` como los otros controles, así que heredan el anclaje a la
 * izquierda, el foco atrapado, Escape y el pie con «Listo». No hay pieza nueva.
 *
 * `descargas` y `metodologia` llegan como ELEMENTOS y no como veinte props. Es
 * lo que ya hacía la sección de descargas cuando era `children`: el panel sigue
 * sin saber nada de exportar ni de la guía oficial de códigos, y App no tiene
 * que reenviar `datos`, `filtro`, `resumen`, `oficiales` y `simef` por dos
 * niveles de componente.
 */

export function ModalInformacion({ manifest, base, hayRecorte, metodologia, onCerrar }) {
  return (
    <CajaModal
      titulo="Información"
      cuenta="Cómo leer este visor, y qué no dice"
      etiquetaCerrar="Cerrar información"
      onCerrar={onCerrar}
    >
      <section>
        <h3>Los filtros</h3>
        <p className="nota">
          Se cruzan entre sí y con el ámbito: el mapa y todas las cifras del panel de indicadores
          muestran sólo lo que pasa todos los filtros a la vez.
        </p>
        {/* QUÉ MIDEN LAS CIFRAS DE LAS LISTAS, que no es lo mismo que el mapa.
            Cada lista cuenta ignorando SU PROPIO filtro y aplicando los demás,
            que es lo único que permite marcar una segunda clase de la misma
            dimensión. Decirlo evita que alguien reste dos cifras que no son del
            mismo conjunto. */}
        {hayRecorte && (
          <p className="nota">
            Dentro de cada lista, la cifra es lo que quedaría <strong>al elegir esa clase</strong>,
            cruzada con los demás filtros. Por eso pueden sumar más que el total del mapa.
          </p>
        )}
      </section>

      <section>
        <h3>El tamaño de los puntos</h3>
        {/* LA REDACCIÓN CAMBIÓ CON LA REGLA, y el matiz es todo. Decía que el
            disco «cubre la misma área» que el polígono, y eso ya sólo vale para
            el 44 % de los puntos: el resto está recortado para no invadir a su
            vecino. Dejar la frase anterior sería más bonito y falso. */}
        <p className="nota">
          Cada punto es un disco que <strong>ocupa la superficie que declara</strong> el polígono
          —el círculo de igual área—, <strong>salvo donde no cabe</strong>: ahí se recorta hasta
          tocar a su vecino sin invadirlo. Con eso ningún disco tapa a otro a partir del zoom 11.
        </p>
        <p className="nota">
          Está recortado el{' '}
          <strong>
            {manifest?.capas?.cbn_puntos?.radio
              ? `${Math.round(
                  (100 * manifest.capas.cbn_puntos.radio.recortados) / manifest.total.filas,
                )} %`
              : 'grueso'}
          </strong>{' '}
          de los puntos, así que en zonas densas el tamaño ya no se puede leer como superficie. La
          cifra exacta está siempre en la ficha del punto, en los filtros y en las descargas.
        </p>
        <p className="nota">
          Alejando el mapa vuelven a tocarse, y eso no tiene arreglo: a escala de país hay{' '}
          {manifest ? fmt.format(manifest.total.filas) : '1,8 millones de'} polígonos sobre unos
          700.000 píxeles.
        </p>
      </section>

      <section>
        <h3>Los colores</h3>
        <p className="nota">
          Los nueve colores del mapa se nombran en <strong>Uso</strong>, con su superficie al lado.
          El color no es la única marca, pero sí la única que está a la vista sin abrirlo.
        </p>
        {/* La advertencia del fondo ACTIVO. Es lo único que explica un mapa con
            huecos, y sin ella un mosaico con nubes parece un error del visor. */}
        {BASEMAPS[base]?.nota && (
          <p className="nota">
            <strong>Mapa base {base}:</strong> {BASEMAPS[base].nota}
          </p>
        )}
      </section>

      <section>
        <h3>De dónde salen estos datos</h3>
        <p className="nota">{AVISO_PUNTOS}</p>
        {/* Las DOS unidades, porque el banner nombra a las dos. AVISO: al mudar
            el pie aquí dentro, si la imagen del banner no carga la página se
            queda sin atribución visible. Es el precio de un panel sin pie, y se
            deja escrito para que la próxima persona sepa que fue una decisión y
            no un descuido. */}
        <p className="nota">
          Publica: CONAF · Gerencia de Fiscalización Forestal y Evaluación Ambiental.
          Desarrolla: Unidad de Información y Análisis.
        </p>
        {manifest && (
          <p className="nota">
            Datos <code>{manifest.capas.cbn_puntos.sha256.slice(0, 12)}</code> ·{' '}
            {fmt.format(manifest.total.filas)} polígonos.
          </p>
        )}
      </section>

      {/* LA METODOLOGÍA ENTERA, aquí dentro y no en un diálogo aparte. Eran dos
          superficies de información y había que saber cuál abrir para cada
          duda. */}
      <div className="met-cuerpo">{metodologia}</div>
    </CajaModal>
  )
}

export function ModalDescargas({ descargas, onCerrar }) {
  return (
    <CajaModal
      titulo="Descargar"
      cuenta="Todo respeta el ámbito y los filtros activos"
      etiquetaCerrar="Cerrar descargas"
      onCerrar={onCerrar}
    >
      {descargas}
    </CajaModal>
  )
}

/**
 * Compartir, con el enlace A LA VISTA y no sólo copiado.
 *
 * Enseñarlo importa: el enlace lleva el ámbito y todos los filtros, así que
 * quien lo abra recibe cifras RECORTADAS. Un botón que copia en silencio no da
 * ocasión de leer eso, y una cifra regional citada como nacional es el error más
 * caro que puede cometer este visor — ya ocurrió por otra vía.
 */
export function ModalCompartir({ onCerrar }) {
  // flush PRIMERO: la URL se escribe con 250 ms de retraso, así que sin esto el
  // modal enseñaría el encuadre ANTERIOR al último movimiento del mapa.
  const [url] = useState(() => {
    flush()
    return window.location.href
  })
  const [aviso, setAviso] = useState('')

  const copiar = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: document.title, url })
        return
      } catch {
        /* cancelado: se sigue por el portapapeles */
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setAviso('Enlace copiado')
    } catch {
      setAviso('No se pudo copiar: selecciona el enlace y cópialo a mano.')
    }
  }

  return (
    <CajaModal
      titulo="Compartir"
      cuenta="El enlace de esta vista exacta"
      etiquetaCerrar="Cerrar compartir"
      onCerrar={onCerrar}
    >
      <p className="nota">
        El enlace guarda el ámbito, todos los filtros activos, el mapa base y el encuadre. Quien lo
        abra verá <strong>exactamente estas cifras</strong>, que no son las nacionales.
      </p>
      {/* readOnly y no disabled: se puede seleccionar y copiar a mano, que es la
          salida cuando el portapapeles está bloqueado por permisos. */}
      <label className="gf-buscar">
        <span className="visualmente-oculto">Enlace de esta vista</span>
        <input type="text" readOnly value={url} onFocus={(e) => e.target.select()} />
      </label>
      <button type="button" className="compartir" onClick={copiar}>
        Copiar enlace
      </button>
      <span className="aviso-copia" aria-live="polite">{aviso}</span>
    </CajaModal>
  )
}
