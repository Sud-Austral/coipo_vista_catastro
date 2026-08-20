/**
 * Primitivas de gráfico, en SVG escrito a mano.
 *
 * SIN LIBRERÍA, y la razón no es que una librería no pueda seguir el tema
 * —Recharts pasa fill/stroke tal cual al SVG y lo seguiría igual—. Las razones
 * son otras tres: el lienzo útil son 288 px y a ese ancho se pelea más con los
 * márgenes por defecto de una librería que lo que se ahorra; el bundle ya va por
 * 950 kB con deck.gl y Leaflet; y este repo no tiene ninguna dependencia de UI,
 * así que añadir la primera es una decisión de proyecto y no un detalle.
 *
 * LO QUE CUESTA: estas líneas hay que mantenerlas, y no hay tooltips ni
 * transiciones. Es un precio consciente.
 *
 * El modo oscuro sale gratis porque todo color estructural es una variable CSS
 * pasada como ATRIBUTO DE PRESENTACIÓN del SVG (`fill="var(--tinta-3)"`): el
 * navegador la resuelve al pintar, heredando del :root. Los colores categóricos
 * entran por prop, porque codifican identidad y deben ser iguales en los dos
 * temas y en el mapa.
 *
 * Y EL COLOR NUNCA ES LA ÚNICA CODIFICACIÓN: `BarraFila` escribe siempre el
 * número. Sobre el mapa, además, la leyenda y el aislar-al-pulsar hacen el resto
 * del trabajo (ver el bloque SIMBOLOGÍA de config.js: con nueve clases
 * simultáneas ninguna paleta pasa las puertas de todos los pares).
 */

const W = 288 // 320 del panel menos 2 × 16 de padding

/**
 * Una fila de tabla-barra: rótulo arriba a ancho completo, y debajo la barra
 * con sus cifras.
 *
 * DOS LÍNEAS, y no una con elipsis. Medido: con la etiqueta en una pista `1fr`
 * junto a la superficie y el porcentaje quedan ~128 px ≈ 20 caracteres, y
 * «Áreas Desprovistas de Vegetación» (32) sale como «Áreas Desprovistas…».
 * A ancho completo entran 46. Cuesta 16 px por fila y salva el rótulo.
 */
export function BarraFila({
  etiqueta,
  glosa,
  valor,
  max,
  texto,
  extra,
  color = 'var(--acento)',
  atenuada,
  activa = true,
  onClick,
  titulo,
}) {
  const ancho = max > 0 ? Math.max(0, Math.min(100, (100 * valor) / max)) : 0
  const Elemento = onClick ? 'button' : 'div'
  return (
    <Elemento
      type={onClick ? 'button' : undefined}
      className={`fila-kpi${atenuada || !activa ? ' atenuada' : ''}${onClick ? ' pulsable' : ''}`}
      onClick={onClick}
      aria-pressed={onClick ? activa : undefined}
      title={titulo}
    >
      <span className="fila-etq">
        {etiqueta}
        {glosa && <span className="fila-glosa">{glosa}</span>}
      </span>
      <div className="fila-barra">
        <span style={{ width: `${ancho}%`, background: color }} />
      </div>
      <span className="fila-num">{texto}</span>
      {extra != null && <span className="fila-extra">{extra}</span>}
    </Elemento>
  )
}

/**
 * Cifra grande con su unidad y su explicación.
 * Deliberadamente NO es un gráfico: es el número que hay que recordar.
 */
export function Cifra({ valor, unidad, etiqueta, detalle }) {
  return (
    <div className="cifra">
      <p className="cifra-num">
        <b>{valor}</b>
        {unidad && <span className="cifra-u">{unidad}</span>}
      </p>
      {etiqueta && <p className="cifra-etq">{etiqueta}</p>}
      {detalle && <p className="nota">{detalle}</p>}
    </div>
  )
}

/**
 * Barra de composición: varios segmentos que suman el total.
 *
 * Cada segmento lleva 2 px de hueco del color de la superficie, no un borde:
 * un borde de 1 px sobre un segmento de 3 px de ancho lo convierte en su propio
 * borde. Y los segmentos por debajo del 1,5 % se dibujan igual, con su ancho
 * mínimo, porque desaparecerlos haría que la barra no sumara el total.
 */
export function Composicion({ partes, total, etiqueta }) {
  if (!total) return null
  return (
    <div className="composicion" role="img" aria-label={etiqueta}>
      {partes.map((p) => (
        <span
          key={p.clave}
          style={{
            width: `${Math.max(0.4, (100 * p.valor) / total)}%`,
            background: p.color,
          }}
          title={`${p.etiqueta}: ${p.texto}`}
        />
      ))}
    </div>
  )
}

/**
 * Columnas verticales, una sola tinta.
 *
 * Una tinta y no una por columna: si las columnas son una escala ordinal
 * (períodos, años), pintarlas de colores distintos codificaría una categoría
 * que no existe.
 *
 * `anotacion` etiqueta UNA columna, la que importa. Nueve cifras encima de
 * nueve columnas son ilegibles; la anómala escrita vale por las nueve.
 */
export function Columnas({ datos, valor, rotulo, alto = 96, anotacion, etiqueta, formato }) {
  if (!datos?.length) return null
  const EJE = 14
  const TECHO = anotacion != null ? 14 : 4
  const max = Math.max(...datos.map(valor), 1)
  const paso = W / datos.length
  const ancho = Math.min(28, paso - 8)
  const cero = alto - EJE
  const y = (v) => TECHO + (1 - v / max) * (cero - TECHO)
  const cx = (i) => (i + 0.5) * paso

  return (
    <svg className="grafico" width={W} height={alto} viewBox={`0 0 ${W} ${alto}`} role="img"
         aria-label={etiqueta}>
      <title>{etiqueta}</title>
      <line x1="0" y1={cero + 0.5} x2={W} y2={cero + 0.5} stroke="var(--borde)" strokeWidth="1" />
      {datos.map((d, i) => {
        const alt = Math.max(1, cero - y(valor(d)))
        return (
          <rect key={rotulo(d)} x={cx(i) - ancho / 2} y={cero - alt} width={ancho} height={alt}
                rx="2" fill="var(--acento)" />
        )
      })}
      {datos.map((d, i) => (
        <text key={rotulo(d)} className="eje" x={cx(i)} y={alto - 3} textAnchor="middle"
              fill="var(--tinta-3)">
          {rotulo(d)}
        </text>
      ))}
      {anotacion != null && (
        <text className="anot" x={Math.max(2, Math.min(W - 2, cx(anotacion)))}
              y={y(valor(datos[anotacion])) - 4}
              textAnchor={anotacion > datos.length / 2 ? 'end' : 'middle'} fill="var(--tinta)">
          {formato(valor(datos[anotacion]))}
        </text>
      )}
    </svg>
  )
}

/**
 * Gemela accesible de un gráfico: los valores fila a fila, fuera de la vista
 * pero no del lector de pantalla. Un aria-label de resumen no basta cuando la
 * figura tiene nueve puntos y ninguno está escrito.
 *
 * La <table> va DENTRO de un <div> y la clase que la oculta va en el div, no en
 * la tabla: `width: 1px` NO encoge una tabla —con layout automático se queda en
 * su ancho de contenido mínimo— y sin el envoltorio se lleva el scrollWidth del
 * documento por encima del viewport. Un bloque sí respeta el ancho, y su
 * overflow:hidden corta el resto.
 */
export function TablaKpi({ titulo, cabeceras, filas }) {
  return (
    <div className="tabla-kpi">
      <table>
        <caption>{titulo}</caption>
        <thead>
          <tr>
            {cabeceras.map((c) => (
              <th key={c} scope="col">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f[0]}>
              <th scope="row">{f[0]}</th>
              {f.slice(1).map((c, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <td key={i}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Advertencia metodológica plegada, con el TÍTULO haciendo el trabajo.
 *
 * No «Nota metodológica», que no dice nada: «Por qué esta cifra no se puede
 * comparar con 2011». Quien no abre nada ya se llevó el mensaje; quien abre se
 * lleva la explicación entera. Es lo que permite que sobrevivan las cuarenta
 * advertencias sin que ninguna tape el dato.
 */
export function Advertencia({ titulo, children }) {
  return (
    <details className="advertencia">
      <summary>{titulo}</summary>
      <div>{children}</div>
    </details>
  )
}

/** Icono del botón que reabre el panel de indicadores. */
export function IconoIndicadores() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none"
         stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3 14V8M9 14V4M15 14v-3" />
    </svg>
  )
}
