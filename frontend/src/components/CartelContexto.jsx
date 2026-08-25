/**
 * Cartel de contexto sobre el mapa.
 *
 * Existe porque el malentendido más probable de este visor es caro: un punto se
 * lee como una parcela, un predio o un árbol, y no es ninguna de las tres cosas.
 * Los textos canónicos viven en config.js, pero estaban sólo en el pie del panel
 * derecho, donde alguien que llega por primera vez ya interpretó los puntos mal
 * antes de llegar a leerlos.
 *
 * NO es un <dialog> ni un modal: no interrumpe, no atrapa el foco y no obliga a
 * cerrar nada para trabajar. Es un aviso que se puede descartar.
 *
 * Y NO SE RECUERDA que se descartó. Recordarlo obligaría a guardar algo del
 * visitante, y la única clave de almacenamiento de este visor es la geometría de
 * los paneles (ver preferencias.js). Reaparecer en cada carga es el precio, y es
 * el correcto: el aviso protege de un error que se comete en los primeros diez
 * segundos, justo cuando alguien llega por un enlace compartido.
 */
export default function CartelContexto({ texto, onCerrar }) {
  return (
    <aside className="cartel" role="note">
      <p>{texto}</p>
      <button type="button" onClick={onCerrar} aria-label="Entendido, ocultar este aviso">
        Entendido
      </button>
    </aside>
  )
}
