import { useCallback, useRef } from 'react'

const PASO = 8
const PASO_GRANDE = 40

/**
 * Tirador para ensanchar un panel lateral.
 *
 * Sirve a los dos paneles con la geometria parametrizada por `lado`: 'izq'
 * arrastra el borde DERECHO del panel de control y 'der' el borde IZQUIERDO del
 * panel de indicadores. En 'der' las flechas se invierten a proposito --mover
 * el separador a la IZQUIERDA es ensanchar--, que es lo que el patron de
 * window splitter espera: las teclas mueven el separador, no "el tamaño".
 *
 * Es un <div role="separator"> y no un <input type="range">: el patron ARIA de
 * un separador redimensionable ("window splitter") es exactamente esto, y un
 * range aparece en el orden de tabulacion como un control de formulario mas,
 * anunciado como «control deslizante» dentro de una lista de filtros.
 *
 * EL TECLADO NO ES OPCIONAL. Un tirador que solo responde al raton deja el ancho
 * del panel fuera del alcance de quien navega con teclado, y aqui el ancho es lo
 * que decide si los nombres de causa especifica se leen enteros o recortados.
 */
export default function Tirador({
  ancho,
  min,
  max,
  onAncho,
  onArrastre,
  lado = 'izq',
  objetivo = 'panel-control',
  etiqueta = 'Ancho del panel de capas y filtros',
  reposo = 320,
}) {
  // El desplazamiento entre el borde del panel y donde se agarro: sin esto el
  // panel salta para poner su borde bajo el cursor en el primer pixel de
  // movimiento.
  const desfase = useRef(0)
  const pendiente = useRef(0)

  // El panel se consulta por id y no por parentElement: el tirador es su
  // hermano fijo, no su hijo (ver el comentario de .tirador en App.css).
  const bordes = useCallback(() => document.getElementById(objetivo)?.getBoundingClientRect(), [objetivo])

  const alBajar = useCallback(
    (e) => {
      // Solo el boton principal: con el secundario se abre el menu contextual y
      // el puntero se quedaria capturado sin que llegue nunca un pointerup.
      if (e.button !== 0) return
      const caja = bordes()
      if (!caja) return
      // El borde que se arrastra es el derecho del panel izquierdo y el
      // izquierdo del derecho: el desfase se mide contra ese borde.
      desfase.current = e.clientX - (lado === 'der' ? caja.left : caja.right)
      e.currentTarget.setPointerCapture(e.pointerId)
      onArrastre(true)
    },
    [onArrastre, bordes, lado],
  )

  const alMover = useCallback(
    (e) => {
      if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return
      const caja = bordes()
      if (!caja) return
      const x = e.clientX - desfase.current
      // Estrangulado a un frame: pointermove llega mas a menudo que el repintado
      // y escribir la variable en cada evento obliga a recalcular la rejilla
      // varias veces por frame para nada.
      cancelAnimationFrame(pendiente.current)
      // 'der': el borde derecho del panel es fijo (pegado al viewport) y el
      // izquierdo sigue al cursor, asi que el ancho es right - x.
      pendiente.current = requestAnimationFrame(() =>
        onAncho(lado === 'der' ? caja.right - x : x - caja.left),
      )
    },
    [onAncho, bordes, lado],
  )

  const alSoltar = useCallback(
    (e) => {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      cancelAnimationFrame(pendiente.current)
      onArrastre(false)
    },
    [onArrastre],
  )

  const alPulsar = useCallback(
    (e) => {
      const crece = lado === 'der' ? 'ArrowLeft' : 'ArrowRight'
      const mengua = lado === 'der' ? 'ArrowRight' : 'ArrowLeft'
      const paso = e.key === mengua ? -PASO : e.key === crece ? PASO : null
      if (paso !== null) onAncho(ancho + (e.shiftKey ? Math.sign(paso) * PASO_GRANDE : paso))
      else if (e.key === 'Home') onAncho(min)
      else if (e.key === 'End') onAncho(max)
      else return
      // Las flechas desplazan el panel si no se detienen aqui, y el panel se
      // moveria bajo el foco mientras se ajusta su ancho.
      e.preventDefault()
    },
    [ancho, min, max, onAncho, lado],
  )

  return (
    <div
      className={lado === 'der' ? 'tirador tirador-kpi' : 'tirador'}
      role="separator"
      aria-orientation="vertical"
      aria-controls={objetivo}
      aria-label={etiqueta}
      aria-valuenow={ancho}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`${ancho} píxeles`}
      tabIndex={0}
      onPointerDown={alBajar}
      onPointerMove={alMover}
      onPointerUp={alSoltar}
      onPointerCancel={alSoltar}
      onKeyDown={alPulsar}
      onDoubleClick={() => onAncho(reposo)}
      title="Arrastra para ensanchar el panel. Doble clic para volver al ancho normal."
    />
  )
}
