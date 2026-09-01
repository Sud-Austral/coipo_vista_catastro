import { useEffect, useRef } from 'react'
import { BASEMAPS, COLOR_USO } from '../config'
import { fmt, fmt1, ha, haExacta, pct } from '../formato'
import { FILTROS } from '../filtros'
import {
  ambitoTexto,
  anioDelAmbito,
  composicionBosque,
  estructurasBosqueNativo,
  resumenSnaspe,
} from '../indicadores'

/**
 * El reporte imprimible del ámbito activo.
 *
 * SE IMPRIME CON `window.print()` Y CSS `@media print`, no con html2canvas ni
 * jsPDF. Tres razones, y la tercera está medida:
 *
 *   1. Sale TEXTO REAL, seleccionable y buscable. El modelo que hay que igualar
 *      —«SICA Geo-Armonización: Visor de Áreas y Zonas»— tiene 33 páginas de
 *      texto extraíble, secciones numeradas y un anexo tabular. Un PDF que es
 *      una foto de la pantalla no se puede citar ni copiar.
 *   2. No añade dependencias a un bundle que ya pesa 1 MB.
 *   3. El otro reporte que se tomó como referencia, generado con captura de
 *      pantalla, resultó ser CINCUENTA PÁGINAS EN BLANCO: se abrió con PyMuPDF
 *      y sus dos únicas imágenes son de un solo color, 255. Ese es el modo de
 *      fallo típico de rasterizar el DOM, y es silencioso.
 *
 * LO QUE SE IMPRIME ES EL ÁMBITO Y LOS FILTROS ACTIVOS, y por eso el documento
 * los declara en su propia sección antes de cualquier cifra. Un reporte de una
 * comuna con seis filtros puestos y una portada que dijera sólo «Catastro» es
 * la forma más rápida de que una cifra recortada acabe citada como nacional.
 *
 * NO es un <dialog>: la impresión tiene que poder aislar este subárbol con
 * `@media print`, y el contenido de la top layer se imprime con reglas propias
 * que no dependen de la cascada normal. Se queda como una capa fija dentro de
 * `.app`, con el fondo inerte por `inert`.
 */

/** Un donut de una vuelta, en SVG. Vector: al imprimirlo no se pixela. */
function Donut({ partes, total, paleta, r = 54, grosor = 22 }) {
  const C = 2 * Math.PI * r
  let acumulado = 0
  return (
    <svg className="rep-donut" viewBox="0 0 140 140" role="img"
         aria-label="Reparto de la superficie por clase de uso">
      <g transform="translate(70,70) rotate(-90)">
        <circle r={r} fill="none" stroke="var(--rep-linea)" strokeWidth={grosor} />
        {partes.map((p) => {
          const frac = total > 0 ? p.ha / total : 0
          const tramo = (
            <circle
              key={p.cod}
              r={r}
              fill="none"
              stroke={paleta[p.cod]}
              strokeWidth={grosor}
              strokeDasharray={`${C * frac} ${C}`}
              strokeDashoffset={-C * acumulado}
            />
          )
          acumulado += frac
          return tramo
        })}
      </g>
    </svg>
  )
}

/**
 * El rango de años del catastro, SACADO DEL MANIFEST.
 *
 * Estaba escrito a mano —«entre 2013 y 2023»— y era falso: los años reales van
 * de 2014 a 2024, y algunas regiones traen tramos como «2020-2022». Una fecha
 * inventada en el pie de un documento impreso es peor que no ponerla, porque no
 * hay nada en el papel que la contradiga.
 */
function rangoDeAnios(manifest) {
  const nums = (manifest?.regiones ?? [])
    .flatMap((r) => String(r.anio ?? '').split('-'))
    .map((t) => parseInt(t, 10))
    .filter((n) => Number.isFinite(n))
  if (nums.length === 0) return null
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  return min === max ? String(min) : `${min} y ${max}`
}

/**
 * Una tabla de cifras: primera columna de texto, el resto números a la derecha.
 *
 * Existe porque el documento pasó de tres tablas a nueve al doblar su extensión,
 * y nueve copias del mismo <thead>/<tbody> se desincronizan en la primera
 * corrección de estilo. Las celdas aceptan nodos, así que el chip de color del
 * anexo entra sin un caso especial.
 */
function Tabla({ cabeceras, filas, pie }) {
  return (
    <table className="rep-tabla">
      <thead>
        <tr>
          {cabeceras.map((c, i) => (
            <th key={c} className={i ? 'num' : undefined}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filas.map((f, k) => (
          <tr key={k}>
            {f.map((c, i) => (
              <td key={i} className={i ? 'num' : undefined}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
      {pie && (
        <tfoot>
          <tr>
            {pie.map((c, i) => (
              <td key={i} className={i ? 'num' : undefined}>{c}</td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  )
}

/** Las N mayores de una lista, con el resto agregado en una fila «otras». */
function conResto(lista, tope) {
  const cabeza = lista.slice(0, tope)
  const cola = lista.slice(tope)
  const resto = cola.reduce((a, x) => ({ n: a.n + x.n, ha: a.ha + x.ha }), { n: 0, ha: 0 })
  return { cabeza, cuantas: cola.length, resto }
}

/** Las clases elegidas de cada dimensión, en texto. */
function filtrosEnTexto(filtros, usosActivos, manifest) {
  if (!manifest) return []
  const linea = (def, seleccion) => {
    if (!seleccion || seleccion.size === 0) return null
    const dominio = manifest[def.clave] ?? []
    const nombres = [...seleccion].map((i) => dominio[i]?.etiqueta ?? `#${i}`)
    return { titulo: def.titulo, clases: nombres }
  }
  return FILTROS.map((def) =>
    linea(def, def.col === 'uso' ? usosActivos : filtros[def.col]),
  ).filter(Boolean)
}

export default function Reporte({
  abierto, onCerrar, manifest, resumen, ambito, filtros, usosActivos, oscuro,
  mapa, base,
}) {
  const ref = useRef(null)
  const cerrar = useRef(null)

  // El foco entra en el documento al abrirlo. No es un <dialog>, así que esto
  // no sale gratis: sin ello el foco se quedaría en el botón «Reporte» del
  // panel, que el efecto de más abajo acaba de volver inerte, y el siguiente
  // Tab reempezaría desde el principio del documento.
  useEffect(() => {
    if (abierto) cerrar.current?.focus()
  }, [abierto])

  // Escape cierra, como en todos los diálogos del visor. Un panel a pantalla
  // completa del que sólo se sale con el ratón es una trampa.
  useEffect(() => {
    if (!abierto) return
    const alTecla = (e) => e.key === 'Escape' && onCerrar()
    document.addEventListener('keydown', alTecla)
    return () => document.removeEventListener('keydown', alTecla)
  }, [abierto, onCerrar])

  // EL FONDO SE VUELVE INERTE A MANO. Un <dialog> modal lo haría solo, pero
  // esto no puede serlo —la impresión necesita aislar el subárbol con
  // `@media print`, y la top layer se imprime por reglas propias—, así que sin
  // esto el reporte tapa el panel pero el Tab lo sigue recorriendo entero por
  // debajo: veintitantas paradas invisibles antes de volver a «Cerrar».
  useEffect(() => {
    const capa = ref.current
    const app = capa?.parentElement
    if (!abierto || !app) return
    const otros = [...app.children].filter((e) => e !== capa)
    otros.forEach((e) => e.setAttribute('inert', ''))
    return () => otros.forEach((e) => e.removeAttribute('inert'))
  }, [abierto])

  if (!abierto || !manifest || !resumen) return null

  const paleta = COLOR_USO[oscuro ? 'oscuro' : 'claro']
  const ambitoTxt = ambitoTexto(ambito, manifest)
  const anio = anioDelAmbito(ambito, manifest)
  const rangoAnios = rangoDeAnios(manifest)
  const bosque = composicionBosque(resumen)
  const snaspe = resumenSnaspe(resumen)
  const estructuras = estructurasBosqueNativo(resumen)
  const activos = filtrosEnTexto(filtros, usosActivos, manifest)
  const nombreDeUso = new Map((manifest.usos ?? []).map((u) => [u.cod, u.etiqueta]))

  // El desglose territorial cambia de unidad según el ámbito: con una región
  // elegida son sus comunas, y sin ámbito son las regiones. Listar 346 comunas
  // en un reporte nacional serían ocho páginas de tabla que nadie lee.
  const territorial = (() => {
    if (ambito?.region) {
      const { cabeza, cuantas, resto } = conResto(resumen.comunas ?? [], 20)
      return {
        titulo: 'Comuna',
        glosa: 'Superficie catastrada por comuna dentro del ámbito, de mayor a menor.',
        filas: [
          ...cabeza.map((c) => [c.etiqueta, ha(c.ha), pct(c.ha, resumen.ha), fmt.format(c.n)]),
          ...(cuantas > 0
            ? [[`Otras ${fmt.format(cuantas)} comunas`, ha(resto.ha),
                pct(resto.ha, resumen.ha), fmt.format(resto.n)]]
            : []),
        ],
      }
    }
    return {
      titulo: 'Región',
      glosa: 'Superficie catastrada por región, de norte a sur, con el año de su catastro.',
      filas: (resumen.regiones ?? []).map((r) => [
        `${r.nombre} · ${r.anio}`, ha(r.ha), pct(r.ha, resumen.ha), fmt.format(r.n),
      ]),
    }
  })()
  const generado = new Date().toLocaleDateString('es-CL', {
    day: '2-digit', month: 'long', year: 'numeric',
  })

  return (
    <div className="reporte-vista" ref={ref} role="region" aria-label="Reporte del ámbito">
      {/* La barra NO se imprime: es el mando, no el documento. */}
      <div className="reporte-barra">
        <button type="button" className="rep-cerrar" ref={cerrar} onClick={onCerrar}>
          ← Cerrar
        </button>
        <span className="rep-titulo-barra">Reporte · {ambitoTxt}</span>
        <button type="button" className="rep-imprimir" onClick={() => window.print()}>
          Exportar PDF
        </button>
      </div>

      <article className="reporte-doc">
        <header className="rep-portada">
          <p className="rep-institucion">
            Corporación Nacional Forestal · Gerencia de Fiscalización Forestal y Evaluación
            Ambiental
          </p>
          <h1>Catastro de Usos de la Tierra y Recursos Vegetacionales</h1>
          <p className="rep-subtitulo">Reporte de superficie y composición vegetacional</p>
          <dl className="rep-ficha">
            <div>
              <dt>Ámbito</dt>
              <dd>{ambitoTxt}</dd>
            </div>
            <div>
              <dt>Año del catastro</dt>
              {/* Sin año único no se inventa uno: se dice que son varios. Es la
                  diferencia entre una cifra fechada y una cifra sin fecha. */}
              <dd>{anio ?? 'varios · una fecha por región'}</dd>
            </div>
            <div>
              <dt>Emitido</dt>
              <dd>{generado}</dd>
            </div>
            <div>
              <dt>Cobertura</dt>
              {/* Cuenta los filtros TEMÁTICOS, que es lo que el lector no ve
                  en el rótulo del ámbito. El recorte territorial ya está en la
                  fila de arriba y contarlo aquí otra vez lo diría dos veces. */}
              <dd>
                {activos.length === 0
                  ? 'sin filtros temáticos'
                  : `${activos.length} ${activos.length === 1 ? 'filtro aplicado' : 'filtros aplicados'}`}
              </dd>
            </div>
          </dl>
        </header>

        {/* LA LÁMINA DEL MAPA, y va en la portada por lo mismo que la ficha de
            arriba: es la respuesta a «¿de qué estamos hablando?» antes de la
            primera cifra. Es una copia del mapa TAL COMO ESTABA al abrir el
            reporte —mismo encuadre, mismo fondo, mismos filtros—, compuesta de
            las teselas y del lienzo de puntos.

            Y SI NO SE PUDO COPIAR, SE DICE. Un lienzo WebGL devuelve un PNG
            válido y completamente transparente sin lanzar nada, así que un
            recuadro vacío rotulado «mapa» es un fallo perfectamente silencioso.
            `capturarMapa` devuelve null antes que eso, y aquí se escribe el
            motivo en vez de imprimir el hueco. */}
        <figure className="rep-mapa">
          {mapa ? (
            <img src={mapa.url} alt={`Mapa del Catastro para ${ambitoTxt}`}
                 width={mapa.ancho} height={mapa.alto} />
          ) : (
            <p className="nota">
              No se pudo copiar el mapa en pantalla. Las cifras de este documento no dependen de
              esa imagen: salen del atributo de superficie.
            </p>
          )}
          <figcaption>
            {mapa
              ? `El mapa tal como estaba al emitir este reporte: ${ambitoTxt}`
              : 'Mapa no disponible en esta copia'}
            {mapa && !mapa.teselas && ' · sin imagen de fondo'}
            {/* Si el encuadre no tenía nada que enseñar se dice, en vez de dejar
                un rectángulo liso que el lector interpretará como quiera. */}
            {mapa && mapa.contenido < 0.002 && ' · el encuadre no contenía datos visibles'}
            {mapa && mapa.teselas > 0 && base && BASEMAPS[base]?.attribution && (
              <> · Fondo {base}: {BASEMAPS[base].attribution.replace(/&middot;/g, '·')
                                   .replace(/&copy;/g, '©')}</>
            )}
          </figcaption>
        </figure>

        {/* SECCIÓN 0, y va antes que ninguna cifra: qué recorte se está
            imprimiendo. Sin esto, dos reportes con el mismo título y cifras
            distintas son indistinguibles a los diez minutos de imprimirlos. */}
        <section className="rep-seccion">
          <h2>1. Alcance de este reporte</h2>
          <p>
            Todas las cifras corresponden a <strong>{ambitoTxt}</strong>
            {activos.length > 0 ? ', cruzado con los filtros siguientes' : ', sin filtros temáticos'}.
            {' '}Un cambio en cualquiera de ellos cambia todas las cifras del documento.
          </p>
          {activos.length > 0 && (
            <table className="rep-tabla">
              <thead>
                <tr>
                  <th>Dimensión</th>
                  <th>Clases seleccionadas</th>
                </tr>
              </thead>
              <tbody>
                {activos.map((f) => (
                  <tr key={f.titulo}>
                    <td>{f.titulo}</td>
                    <td>{f.clases.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rep-seccion">
          <h2>2. Resumen de la unidad territorial</h2>
          <div className="rep-kpis">
            <div className="rep-kpi">
              <span className="rep-kpi-cifra">{ha(resumen.ha)}</span>
              <span className="rep-kpi-etq">Superficie catastrada</span>
              <span className="rep-kpi-detalle">{haExacta(resumen.ha)}</span>
            </div>
            <div className="rep-kpi">
              <span className="rep-kpi-cifra">{fmt.format(resumen.n)}</span>
              <span className="rep-kpi-etq">Polígonos</span>
              <span className="rep-kpi-detalle">unidades cartográficas</span>
            </div>
            <div className="rep-kpi">
              <span className="rep-kpi-cifra">
                {bosque?.pctPais == null ? '—' : `${fmt1.format(bosque.pctPais)} %`}
              </span>
              <span className="rep-kpi-etq">Del ámbito es bosque</span>
              <span className="rep-kpi-detalle">{bosque ? ha(bosque.bosques.ha) : '—'}</span>
            </div>
            <div className="rep-kpi">
              <span className="rep-kpi-cifra">
                {snaspe?.pctDelAmbito == null ? '—' : `${fmt1.format(snaspe.pctDelAmbito)} %`}
              </span>
              <span className="rep-kpi-etq">Bajo protección SNASPE</span>
              <span className="rep-kpi-detalle">
                {snaspe ? `${fmt.format(snaspe.unidades)} unidades` : '—'}
              </span>
            </div>
          </div>

          <div className="rep-donut-fila">
            <Donut partes={resumen.usos} total={resumen.ha} paleta={paleta} />
            <ul className="rep-leyenda">
              {resumen.usos.map((u) => (
                <li key={u.cod}>
                  <span className="chip" style={{ background: paleta[u.cod] }} />
                  <span className="rep-leyenda-nombre">{u.etiqueta}</span>
                  <span className="rep-leyenda-cifra">
                    {ha(u.ha)} · {pct(u.ha, resumen.ha)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {bosque && (
          <section className="rep-seccion">
            <h2>3. Composición del bosque</h2>
            <p>
              De las {ha(bosque.bosques.ha)} clasificadas como bosque,{' '}
              <strong>
                {bosque.pctNativoDelBosque == null
                  ? '—'
                  : `${fmt1.format(bosque.pctNativoDelBosque)} %`}
              </strong>{' '}
              es bosque nativo. El denominador aquí son los bosques, no el ámbito completo: son
              dos porcentajes distintos y no se pueden mezclar.
            </p>
            <table className="rep-tabla">
              <thead>
                <tr>
                  <th>Subclase</th>
                  <th className="num">Superficie</th>
                  <th className="num">% del bosque</th>
                  <th className="num">Polígonos</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Bosque nativo', bosque.nativo],
                  ['Plantación forestal', bosque.plantacion],
                  ['Bosque mixto', bosque.mixto],
                ].map(([nombre, fila]) => (
                  <tr key={nombre}>
                    <td>{nombre}</td>
                    <td className="num">{ha(fila.ha)}</td>
                    <td className="num">{pct(fila.ha, bosque.bosques.ha)}</td>
                    <td className="num">{fmt.format(fila.n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {resumen.tiposForestales?.length > 0 && (
              <>
                <h3>3.1 Tipo forestal</h3>
                <p>
                  Sólo aplica al bosque nativo. El resto del territorio no tiene tipo forestal, y
                  eso no es lo mismo que tener cero.
                </p>
                <Tabla
                  cabeceras={['Tipo forestal', 'Superficie', '% del ámbito', 'Polígonos']}
                  filas={resumen.tiposForestales.map((t) => [
                    t.etiqueta, ha(t.ha), pct(t.ha, resumen.ha), fmt.format(t.n),
                  ])}
                />
              </>
            )}

            {estructuras && estructuras.filas.length > 0 && (
              <>
                <h3>3.2 Estructura del bosque nativo</h3>
                <table className="rep-tabla">
                  <thead>
                    <tr>
                      <th>Estructura</th>
                      <th className="num">Superficie</th>
                      <th className="num">% del bosque nativo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estructuras.filas.map((e) => (
                      <tr key={e.cod}>
                        <td>{e.etiqueta}</td>
                        <td className="num">{ha(e.ha)}</td>
                        <td className="num">{fmt1.format(e.pct)} %</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
        )}

        {snaspe && snaspe.unidades > 0 && (
          <section className="rep-seccion">
            <h2>4. Estado de protección</h2>
            <p>
              {ha(snaspe.total)} del ámbito están dentro del Sistema Nacional de Áreas Silvestres
              Protegidas del Estado, repartidas en {fmt.format(snaspe.unidades)} unidades. El
              Servicio de Biodiversidad y Áreas Protegidas de la Ley 21.600 está en
              implementación y no cambia estas cifras.
            </p>
            <Tabla
              cabeceras={['Categoría', 'Unidades', 'Superficie', '% del ámbito']}
              filas={snaspe.categorias.map((c) => [
                c.categoria, fmt.format(c.unidades), ha(c.ha), pct(c.ha, resumen.ha),
              ])}
            />

            {snaspe.mayores.length > 0 && (
              <>
                <h3>4.1 Unidades de mayor superficie</h3>
                <Tabla
                  cabeceras={['Unidad', 'Categoría', 'Superficie', '% del ámbito']}
                  filas={snaspe.mayores.map((u) => [
                    u.etiqueta, u.categoria ?? '—', ha(u.ha), pct(u.ha, resumen.ha),
                  ])}
                />
              </>
            )}
          </section>
        )}

        {(resumen.coberturas?.length > 0 || resumen.alturas?.length > 0) && (
          <section className="rep-seccion">
            <h2>5. Estructura del dosel</h2>
            {resumen.coberturas?.length > 0 && (
              <>
                <h3>5.1 Cobertura de copas</h3>
                <p>
                  Densidad del dosel, de Denso a Escaso. «No Aplica» es el territorio donde la
                  pregunta no tiene sentido —cuerpos de agua, glaciares, suelo desnudo—, y no es
                  lo mismo que cobertura cero.
                </p>
                <Tabla
                  cabeceras={['Cobertura', 'Superficie', '% del ámbito', 'Polígonos']}
                  filas={[...resumen.coberturas]
                    .sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99))
                    .map((c) => [c.etiqueta, ha(c.ha), pct(c.ha, resumen.ha), fmt.format(c.n)])}
                />
              </>
            )}
            {resumen.alturas?.length > 0 && (
              <>
                <h3>5.2 Altura del dosel</h3>
                {/* LA ADVERTENCIA VA ANTES DE LA TABLA, no en una nota al pie.
                    Son dos sistemas de medida cuyos tramos se solapan: sumarlos
                    da un número que no significa nada, y en papel no hay un
                    control al lado que lo explique. */}
                <p>
                  <strong>Vienen dos escalas distintas y sus tramos se solapan.</strong> La fina
                  mide en metros; la gruesa sólo distingue por encima y por debajo de 2 m. Las
                  filas de una escala <strong>no se suman con las de la otra</strong>, y por eso
                  esta tabla no lleva total.
                </p>
                <Tabla
                  cabeceras={['Tramo', 'Escala', 'Superficie', '% del ámbito', 'Polígonos']}
                  filas={[...resumen.alturas]
                    .sort((a, b) =>
                      ({ fina: 0, gruesa: 1, no_aplica: 2 }[a.escala] ?? 3)
                      - ({ fina: 0, gruesa: 1, no_aplica: 2 }[b.escala] ?? 3)
                      || (a.orden ?? 99) - (b.orden ?? 99))
                    .map((x) => [
                      x.etiqueta,
                      x.escala === 'fina' ? 'en metros'
                        : x.escala === 'gruesa' ? 'gruesa' : 'no aplica',
                      ha(x.ha), pct(x.ha, resumen.ha), fmt.format(x.n),
                    ])}
                />
              </>
            )}
          </section>
        )}

        {resumen.especies?.length > 0 && (
          <section className="rep-seccion">
            <h2>6. Especies principales</h2>
            {/* LA PRIMERA, NO LA ÚNICA. Cada polígono registra hasta seis
                especies y aquí sólo pesa la dominante: sin decirlo, esta tabla
                se lee como el inventario de especies del territorio, que no es.
                Va en el cuerpo y no en una nota porque cambia lo que la cifra
                significa. */}
            <p>
              Es la especie <strong>dominante</strong> de cada polígono, no la única: el Catastro
              registra hasta seis por polígono y las otras cinco no aparecen en esta cuenta.
              Incluye toda la vegetación, no sólo árboles.
            </p>
            {(() => {
              const { cabeza, cuantas, resto } = conResto(resumen.especies, 15)
              return (
                <Tabla
                  cabeceras={['Especie', 'Superficie', '% del ámbito', 'Polígonos']}
                  filas={[
                    ...cabeza.map((e) => [
                      e.cientifico && e.cientifico !== e.etiqueta
                        ? <>{e.etiqueta} <em>({e.cientifico})</em></>
                        : e.etiqueta,
                      ha(e.ha), pct(e.ha, resumen.ha), fmt.format(e.n),
                    ]),
                    ...(cuantas > 0
                      ? [[`Otras ${fmt.format(cuantas)} especies`, ha(resto.ha),
                          pct(resto.ha, resumen.ha), fmt.format(resto.n)]]
                      : []),
                  ]}
                />
              )
            })()}
          </section>
        )}

        {territorial.filas.length > 0 && (
          <section className="rep-seccion">
            <h2>7. Distribución territorial</h2>
            <p>{territorial.glosa}</p>
            <Tabla
              cabeceras={[territorial.titulo, 'Superficie', '% del ámbito', 'Polígonos']}
              filas={territorial.filas}
            />
          </section>
        )}

        <section className="rep-seccion">
          <h2>8. Cobertura del dato</h2>
          {/* LA SECCIÓN QUE NADIE PIDE Y HACE FALTA. «Sin dato» no es «cero»: si
              un tercio de los polígonos no trae altura, los porcentajes de la
              sección 5 no cubren el territorio y quien los cite sin esto está
              citando otra cosa. En pantalla esto sale al pie de cada filtro; en
              papel, si no está aquí, no está. */}
          <p>
            Cuántos polígonos del ámbito <strong>no traen</strong> cada dato. No se reparten entre
            las clases ni cuentan como cero: quedan fuera de los porcentajes de las secciones
            anteriores.
          </p>
          <Tabla
            cabeceras={['Dimensión', 'Polígonos sin dato', '% del ámbito']}
            filas={[
              ['Subclase de uso', 'subuso'],
              ['Estructura', 'estructura'],
              ['Tipo forestal', 'tipoForestal'],
              ['Subtipo forestal', 'subtipoForestal'],
              ['Cobertura de copas', 'cobertura'],
              ['Altura del dosel', 'altura'],
              ['Especie principal', 'especie'],
              ['Comuna', 'comuna'],
            ].map(([nombre, clave]) => {
              const v = resumen.sinDato?.[clave] ?? 0
              return [nombre, fmt.format(v),
                      resumen.n > 0 ? `${fmt1.format((100 * v) / resumen.n)} %` : '—']
            })}
          />
        </section>

        <section className="rep-seccion">
          <h2>Anexo A. Clases de uso de la tierra</h2>
          {/* La cuenta sale de la lista, no del literal «nueve». En Los Lagos
              hay ocho: la clase «Áreas no Reconocidas» tiene cinco polígonos en
              todo el país. Un encabezado que prometiera nueve sobre una tabla
              de ocho invita a buscar la que falta. */}
          <p>
            Las {resumen.usos.length} clases presentes en este ámbito. Juntas son todo el
            territorio catastrado: los porcentajes suman 100 %.
          </p>
          <table className="rep-tabla">
            <thead>
              <tr>
                <th>Clase de uso</th>
                <th className="num">Superficie (ha)</th>
                <th className="num">% del ámbito</th>
                <th className="num">Polígonos</th>
              </tr>
            </thead>
            <tbody>
              {resumen.usos.map((u) => (
                <tr key={u.cod}>
                  <td>
                    <span className="chip" style={{ background: paleta[u.cod] }} />
                    {u.etiqueta}
                  </td>
                  <td className="num">{haExacta(u.ha)}</td>
                  <td className="num">{pct(u.ha, resumen.ha)}</td>
                  <td className="num">{fmt.format(u.n)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{haExacta(resumen.ha)}</td>
                <td className="num">100,0 %</td>
                <td className="num">{fmt.format(resumen.n)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        {resumen.subusos?.length > 0 && (
          <section className="rep-seccion">
            <h2>Anexo B. Subclases de uso</h2>
            <p>
              El desglose fino de las nueve clases. Dentro de Bosques distingue nativo, plantación
              y mixto; en el resto separa lo que el Catastro subdivide.
            </p>
            <Tabla
              cabeceras={['Subclase', 'Clase de uso', 'Superficie', '% del ámbito', 'Polígonos']}
              filas={resumen.subusos.map((x) => [
                x.etiqueta,
                nombreDeUso.get(x.uso) ?? '—',
                ha(x.ha), pct(x.ha, resumen.ha), fmt.format(x.n),
              ])}
            />
          </section>
        )}

        {/* ANEXO C: LO QUE ESTE DOCUMENTO NO DICE. Va dentro del PDF y no en una
            página web que hay que ir a buscar, porque el PDF es lo que viaja: se
            reenvía, se imprime y se cita meses después, y para entonces el visor
            que lo generó ya no está delante. */}
        <section className="rep-seccion">
          <h2>Anexo C. Qué no dice este reporte</h2>
          <h3>Un punto no es una parcela</h3>
          <p>
            Cada registro del Catastro es un <strong>polígono</strong>, y en el visor se dibuja
            como el centroide de ese polígono. No es una parcela, ni un predio, ni un árbol. El
            centroide de un polígono muy irregular puede caer fuera de él: en uno con forma de
            herradura, el punto marcado está en el hueco.
          </p>
          <h3>El tamaño del punto no siempre es la superficie</h3>
          {/* VA EN EL PDF, que es lo que circula: se reenvía, se imprime y se
              cita meses después, cuando el visor que lo generó ya no está
              delante para matizarlo. */}
          <p>
            En el mapa, cada disco ocupa la superficie que su polígono declara, salvo donde no cabe:
            ahí se recorta hasta tocar a su vecino sin invadirlo, para que ninguno tape a otro. Eso
            afecta al <strong>56 % de los puntos</strong>, así que en zonas densas el tamaño del
            disco no se puede leer como superficie. Las cifras de este documento no dependen de ese
            recorte: salen del atributo de superficie, no del dibujo.
          </p>
          <h3>El Catastro no registra propiedad</h3>
          <p>
            Ningún polígono corresponde a un propietario ni a un rol de avalúo. Este documento no
            sirve para acreditar tenencia, deslindes ni derechos sobre la tierra.
          </p>
          <h3>Las cifras no son de una sola fecha</h3>
          <p>
            Cada región se levantó en un año distinto{rangoAnios ? `, entre ${rangoAnios}` : ''}.
            Un total que agregue varias regiones suma superficies medidas con años de diferencia,
            así que no describe un instante sino una acumulación.
          </p>
          <h3>Las superficies se redondean al presentarlas</h3>
          <p>
            En las tablas, por encima del millón de hectáreas se muestra un decimal. Los valores
            completos están en el Anexo A y en las descargas en CSV del visor, que es lo que hay
            que usar para cualquier cálculo.
          </p>
          <h3>Definición de bosque</h3>
          <p>
            «Bosque» aquí es la clase de uso 04 del Catastro. Antes de comparar esta cifra con
            FRA, con el catastro anterior o con la de otro país hay que verificar que las
            definiciones coincidan: los umbrales de superficie, ancho y cobertura de copas no son
            los mismos en todas las fuentes.
          </p>
        </section>

        <footer className="rep-pie">
          {/* LA ADVERTENCIA QUE NO PUEDE FALTAR EN UN DOCUMENTO IMPRESO. En
              pantalla el año está en el panel; en papel, si no está aquí, no
              está en ninguna parte, y dos regiones se restan como si fueran de
              la misma fecha. */}
          {anio ? (
            <p>
              <strong>Este ámbito se catastró en {anio}.</strong> Otras regiones se levantaron en
              años distintos{rangoAnios ? ` —el país entero, entre ${rangoAnios}—` : ''}, así que
              estas cifras no se comparan directamente con las de otra región sin mirar su fecha.
            </p>
          ) : (
            <p>
              <strong>Cada región se catastró en un año distinto.</strong> Este reporte agrega
              superficies levantadas
              {rangoAnios ? ` entre ${rangoAnios}` : ' en años distintos'} según la región, así
              que no es una fotografía de una sola fecha. La actualización de cada región figura
              en el visor, junto a su nombre.
            </p>
          )}
          <p>
            Fuente: Catastro de Usos de la Tierra y Recursos Vegetacionales, CONAF. Datos{' '}
            <code>{manifest.capas.cbn_puntos.sha256.slice(0, 12)}</code> ·{' '}
            {fmt.format(manifest.total.filas)} polígonos en el país.
          </p>
          <p>Publica: CONAF · Desarrolla: Unidad de Información y Análisis.</p>
        </footer>
      </article>
    </div>
  )
}
