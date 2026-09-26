import { AVISO_PUNTOS } from '../config'
import { fmt } from '../formato'
import { rangoAniosTexto } from '../hechos.js'
import { DESARROLLA, PUBLICA, UMAMI } from '../web/sitio.js'

/**
 * Qué es este visor y de dónde salen sus datos, en una sola redacción.
 *
 * La usan el modal de Información y la portada horneada que leen los buscadores y
 * los asistentes de IA: dos redacciones del mismo párrafo divergen a la primera
 * corrección. Sin encabezado propio, porque en el modal es un <h3> y en la portada
 * un <h2>: lo pone quien la coloca.
 *
 * Pura: sin window ni document, porque también se renderiza en Node al construir.
 * Cada cifra sale del manifest; sin manifest, las frases que la necesitan se omiten.
 */
export default function QueEs({ manifest, clase = 'nota' }) {
  const rango = rangoAniosTexto(manifest)
  return (
    <>
      {manifest && (
        <p className={clase}>
          Muestra el <strong>Catastro de Usos de la Tierra y Recursos Vegetacionales</strong> de
          CONAF: {fmt.format(manifest.total.filas)} polígonos de las {manifest.regiones.length}{' '}
          regiones del país, cada uno con su uso de la tierra, su superficie y su ubicación, y en
          los bosques su estructura, tipo forestal y especie principal.
        </p>
      )}
      <p className={clase}>{AVISO_PUNTOS}</p>
      {rango && (
        <p className={clase}>
          Las regiones se levantaron en años distintos, entre {rango}: el Catastro es una foto por
          región, no una serie temporal.
        </p>
      )}
      {/* Las DOS unidades, porque el banner nombra a las dos. Si la imagen del
          banner no carga, esto es lo único que las declara. */}
      <p className={clase}>
        Publica: {PUBLICA}. Desarrolla: {DESARROLLA}.
      </p>
      {/* Sólo cuando el sitio cuenta visitas de verdad: prometer privacidad sobre
          una medición que no existe, o callar una que sí, serían dos mentiras. */}
      {UMAMI.id && (
        <p className={clase}>
          Este sitio cuenta visitas con Umami: sin cookies; no guarda su dirección IP (sí el país y
          la ciudad que se deducen de ella) y registra la dirección visitada con su ámbito y sus
          filtros, sin el encuadre del mapa.
        </p>
      )}
      {manifest && (
        <p className={clase}>
          Datos <code>{manifest.capas.cbn_puntos.sha256.slice(0, 12)}</code> ·{' '}
          {fmt.format(manifest.total.filas)} polígonos.
        </p>
      )}
    </>
  )
}
