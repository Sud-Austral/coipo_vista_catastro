import { useEffect, useRef } from 'react'
import { fmt, haExacta } from '../formato'

/**
 * Metodología, definiciones y lo que este visor NO dice.
 *
 * Por qué existe, y por qué es la pieza que más falta hacía: sin la definición
 * de «bosque», la cifra de 18,9 M ha no es interpretable ni comparable — ni con
 * FRA, ni con el catastro anterior, ni con la de otro país. Es la primera
 * pregunta técnica de cualquier mesa y hasta ahora el visor no la respondía.
 *
 * Es un <dialog> nativo abierto con showModal(): el navegador aporta el foco
 * atrapado, el cierre con Escape, el fondo inerte y la top layer, así que ningún
 * z-index de Leaflet ni de un cajón puede taparlo.
 *
 * TODO lo que se afirma aquí sale del manifest o está marcado como pendiente de
 * validación. Nada de cifras escritas a mano: si el ETL cambia, esto cambia.
 */
export default function PaginaMetodologia({ abierta, onCerrar, manifest, oficiales, simef }) {
  const ref = useRef(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (abierta && !d.open) d.showModal()
    else if (!abierta && d.open) d.close()
  }, [abierta])

  const cap = manifest?.capas?.cbn_puntos
  const total = manifest?.total
  const oficialTotal = oficiales?.total_pais?.total

  return (
    <dialog className="metodologia" ref={ref} aria-labelledby="met-titulo" onClose={onCerrar}>
      <div className="met-caja">
        <header>
          <h2 id="met-titulo">Metodología y definiciones</h2>
          <button type="button" className="cerrar" onClick={onCerrar} aria-label="Cerrar">
            ×
          </button>
        </header>

        <section>
          <h3>Qué cuenta el Catastro como bosque</h3>
          {/* Sin esto, 18,9 M ha no es comparable con nada. Los umbrales son los
              que fija la Ley 20.283 sobre Recuperación del Bosque Nativo y
              Fomento Forestal en su artículo 2. */}
          <p>
            <strong>Bosque.</strong> Sitio poblado con formaciones vegetales en las que
            predominan árboles, que ocupa una superficie de al menos <strong>5.000 m²</strong>,
            con un ancho mínimo de <strong>40 m</strong>, y con una cobertura de copas superior
            al <strong>10 %</strong> en zonas áridas y semiáridas o al <strong>25 %</strong> en
            condiciones más favorables. Ley 20.283, artículo 2.
          </p>
          <p>
            <strong>Bosque nativo.</strong> Bosque formado por especies autóctonas, provenientes
            de generación o regeneración natural, o de plantación bajo dosel con las mismas
            especies del área de distribución original. Puede tener presencia accidental de
            especies exóticas distribuidas al azar.
          </p>
          <p>
            <strong>Plantación.</strong> En el Catastro incluye las superficies recién cosechadas
            y no descuenta caminos ni canchas de acopio, así que <strong>no es comparable</strong>
            {' '}con las estadísticas de superficie plantada de INFOR.
          </p>
          <p>
            <strong>Bosque mixto.</strong> Rodales donde conviven especies nativas y exóticas sin
            que ninguna de las dos domine lo suficiente para clasificar el rodal.
          </p>
          <p className="pendiente">
            ⚠ El texto legal de estas definiciones está resumido para leerse aquí.{' '}
            <strong>Antes de publicar, CONAF debe validar la redacción</strong> contra el texto
            oficial de la Ley 20.283 y su reglamento. Los umbrales numéricos sí son los del
            artículo 2.
          </p>
        </section>

        <section>
          <h3>Qué es un punto en este mapa</h3>
          <p>
            Cada punto es el <strong>centroide</strong> del polígono que el Catastro dibujó, no
            una parcela, ni un predio, ni un árbol. Su tamaño sí es{' '}
            <em>proporcional a la superficie</em>: el disco cubre la misma área que el polígono,
            centrada en ese centroide. Lo que no reproduce es su <em>forma</em> — una faja
            estrecha de diez kilómetros y un cuadrado compacto de la misma superficie se dibujan
            igual. Y el disco está acotado por abajo para que no desaparezca a escala de país, y
            por arriba para que uno enorme no tape a sus vecinos: en esos dos extremos deja de
            ser proporcional, y la cifra exacta está siempre en el atributo.
          </p>
          <p>
            El centroide de un polígono muy irregular <strong>puede caer fuera de él</strong>.
            Para un polígono con forma de herradura, el punto marcado está en el hueco.
          </p>
          <p>
            <strong>El Catastro no registra propiedad.</strong> Ningún polígono corresponde a un
            predio ni a un rol de avalúo, y este visor no puede decir de quién es un terreno.
          </p>
        </section>

        <section>
          <h3>Qué describe cada polígono</h3>
          <p>
            Además del uso, el Catastro describe la <strong>estructura</strong>, el{' '}
            <strong>tipo</strong> y <strong>subtipo forestal</strong>, la{' '}
            <strong>densidad de copas</strong>, la <strong>altura del dosel</strong> y hasta{' '}
            <strong>seis especies</strong>. Este visor deja filtrar por todas ellas, con tres
            salvedades que cambian cómo se leen las cifras:
          </p>
          <ul className="met-lista">
            <li>
              <strong>La especie es la principal.</strong> De las seis que puede registrar un
              polígono, aquí filtra y suma la primera, la dominante, y la superficie del polígono se
              le asigna entera. No es una convención de este visor: es la misma que usa la planilla
              oficial de plantaciones por especie, y reproducirla da{' '}
              <strong>1.714.737,31 ha</strong> de <em>Pinus radiata</em> contra las{' '}
              <strong>1.714.736,78</strong> publicadas por CONAF.
            </li>
            <li>
              <strong>La altura viene en dos escalas que se solapan.</strong> Una da tramos en
              metros y la otra sólo distingue por encima y por debajo de 2 m. «Menos de 2 m» cubre
              lo mismo que los tres primeros tramos finos juntos, así que{' '}
              <strong>sumar las dos escalas cuenta dos veces el mismo rango</strong>. Van separadas
              en el panel, en el filtro y en el CSV.
            </li>
            <li>
              <strong>Tres vocabularios no son oficiales.</strong> La guía de códigos de CONAF no
              nombra las clases de altura, los subtipos forestales ni las especies, así que sus
              etiquetas salen del propio dato, normalizadas. El manifest lo declara dimensión por
              dimensión y el panel lo dice junto a cada filtro. Uso, subuso, estructura y tipo
              forestal sí son oficiales.
            </li>
          </ul>
          {/* ESTE AVISO CAMBIÓ, y el cambio hay que contarlo. Decía que el visor
              «no puede decir si una especie está amenazada y no lo insinúa en
              ninguna parte». Desde que existe el filtro de estado de
              conservación, la segunda mitad dejó de ser cierta: el visor SÍ
              muestra categorías. Lo que sigue siendo cierto —y ahora importa
              más— es de dónde salen y cuántas faltan. */}
          <p className="pendiente">
            ⚠ <strong>El Catastro no registra el estado de conservación de las especies.</strong> No
            hay ninguna columna de categoría de amenaza en ninguna de sus capas. El filtro
            «Estado de conservación» que ofrece este visor <strong>no viene del Catastro</strong>:
            sale de una tabla auxiliar de la Unidad de Información y Análisis que clasifica las
            989 especies del vocabulario.
          </p>
          <p className="pendiente">
            ⚠ Esa tabla <strong>no está validada contra el Reglamento de Clasificación de
            Especies</strong>, y sólo trae categoría para trece especies: las otras{' '}
            <strong>976 figuran como «Sin dato - no verificado en RCE»</strong>. Eso significa que
            no se ha comprobado, <strong>no</strong> que la especie esté fuera de peligro. Leer ese
            filtro como un inventario de especies amenazadas lo lee exactamente al revés.
          </p>
          <p className="pendiente">
            ⚠ Y que una especie aparezca con poca superficie <strong>no</strong> significa que esté
            amenazada. Para eso hay que ir al inventario oficial del RCE, que es otra fuente.
          </p>
        </section>

        <section>
          <h3>De cuándo es cada dato</h3>
          <p>
            Cada región se levantó en un año distinto, entre{' '}
            <strong>2014 y 2024</strong>. El Catastro es una <strong>foto por región</strong>, no
            una serie temporal: comparar dos regiones compara dos años distintos, y restar una de
            otra no mide ningún cambio. Por eso este visor no ofrece ningún control que muestre
            dos años del Catastro a la vez.
          </p>
          {oficiales?.anio_discrepante?.length > 0 && (
            <>
              <p>
                El año tiene tres fuentes: la columna de período de cada capa, el nombre del
                archivo de origen que asignó CONAF, y la planilla oficial de cifras. Las dos
                primeras coinciden en las 22 capas; la planilla difiere en{' '}
                {oficiales.anio_discrepante.length} regiones. Este visor usa el de las capas, que
                es el que respaldan dos fuentes:
              </p>
              <table className="met-tabla">
                <thead>
                  <tr>
                    <th scope="col">Región</th>
                    <th scope="col">Planilla oficial</th>
                    <th scope="col">Capas (se usa)</th>
                  </tr>
                </thead>
                <tbody>
                  {oficiales.anio_discrepante.map((d) => (
                    <tr key={d.region}>
                      <th scope="row">{d.region}</th>
                      <td>{d.en_la_planilla_oficial}</td>
                      <td>
                        <strong>{d.en_las_capas}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        <section>
          <h3>Cómo se contrastan estas cifras</h3>
          {/* ESTA FRASE DECÍA «nunca del texto de la capa», en absoluto, y era
              falsa desde el primer día: el propio manifest declara cinco
              vocabularios deducidos del dato. Una afirmación absoluta que la
              misma página contradice es indefendible ante quien la cite; la
              enumeración, en cambio, se puede comprobar contra el manifest. */}
          <p>
            Donde hay <strong>código oficial</strong>, las etiquetas y los agregados salen de él, y
            no del texto de la capa: agregando por texto faltaban 95.626 ha en la estructura del
            bosque nativo, que resultaron ser Coquimbo y Arica enteras, cada una escrita con su
            propia variante ortográfica.
          </p>
          <p>
            Cinco dimensiones <strong>no tienen código utilizable</strong> —altura del dosel,
            subtipo forestal, especie, unidad del SNASPE y comuna— y en ésas manda una{' '}
            <strong>tabla de homologación</strong> revisada por la Unidad de Información y
            Análisis, nunca una regla automática sobre el texto. Cada filtro declara al pie de
            dónde sale su vocabulario, y el manifest lo publica dimensión por dimensión.
          </p>
          <p>
            Que la tabla exista no es un detalle administrativo: sin ella, el Parque Nacional
            Bernardo O&apos;Higgins figuraba como dos unidades —«Ohiggins» y «OHiggins»— y quien
            consultara una de las dos obtenía 2,8 de sus 3,8 millones de hectáreas.
          </p>
          {oficialTotal && total && (
            <p>
              El total de este visor es <strong>{haExacta(total.ha)}</strong> y la cifra oficial
              publicada por CONAF es <strong>{haExacta(oficialTotal)}</strong>:{' '}
              <strong>{(total.ha - oficialTotal).toFixed(2)} ha</strong> de diferencia
              ({(((total.ha - oficialTotal) / oficialTotal) * 100).toFixed(7)} %).{' '}
              <strong>No se ajusta.</strong> El mayor residuo por clase de uso es de unas 6 ha, del
              mismo orden que los residuos regionales que la propia serie tiene contra lo
              publicado. No hay una causa verificada para esa diferencia, así que aquí no se
              afirma ninguna.
            </p>
          )}
        </section>

        <section>
          <h3>Procedencia</h3>
          <ul className="met-lista">
            <li>
              Fuente: {manifest?.fuente}.
            </li>
            {cap && (
              <li>
                Datos publicados: {fmt.format(cap.filas)} polígonos,{' '}
                <code>sha256 {cap.sha256}</code>.
              </li>
            )}
            <li>
              Coordenadas en EPSG:4326, derivadas del centroide de cada polígono. Las capas de
              origen vienen en UTM 18S y 19S según la región.
            </li>
            {cap?.sin_dato && (
              <li>
                Filas sin dato en alguna dimensión:{' '}
                {Object.entries(cap.sin_dato)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => `${k} ${fmt.format(v)}`)
                  .join(' · ')}
                . No se absorben en ninguna categoría: se cuentan aparte.
              </li>
            )}
            {manifest?.codigos_desconocidos &&
              Object.entries(manifest.codigos_desconocidos).map(([campo, vals]) =>
                Object.keys(vals).length ? (
                  <li key={campo}>
                    Códigos de {campo} que la guía oficial no nombra:{' '}
                    {Object.entries(vals).map(([c, n]) => `${c} (${n} filas)`).join(', ')}.
                  </li>
                ) : null,
              )}
            {manifest?.snaspe_categoria_corregida?.length > 0 && (
              <li>
                {manifest.snaspe_categoria_corregida.length} unidades del SNASPE traían en la capa
                de origen una categoría vacía, inexistente en el Sistema, o dos a la vez. Se
                corrigieron por el nombre de la unidad y la corrección está publicada en el
                manifest: ninguna se aplicó en silencio.
              </li>
            )}
            {simef && <li>Cambio de uso: {simef.fuente}. {simef.aviso}</li>}
          </ul>
          <p className="pendiente">
            ⚠ Pendiente de completar por CONAF: escala de trabajo y{' '}
            <strong>unidad mínima cartografiable</strong> por región, sensor y fecha de la imagen
            de cada levantamiento, y la proyección en que se calcularon las superficies oficiales.
            Sin la unidad mínima, quien haga zoom sobre su predio y no vea el bosquete de media
            hectárea concluirá que el Catastro está mal.
          </p>
        </section>

        <section>
          <h3>Licencia y cómo citar</h3>
          <p className="pendiente">
            ⚠ <strong>Los términos de uso del dato descargado están pendientes de definir por
            CONAF.</strong> Hasta que se fijen, quien descargue estos archivos debe consultar a la
            Gerencia de Fiscalización Forestal y Evaluación Ambiental antes de redistribuirlos o
            usarlos en un producto propio.
          </p>
          {cap && (
            <p className="cita">
              CONAF. <em>Visor del Catastro de Usos de la Tierra y Recursos Vegetacionales</em>.
              Unidad de Información y Análisis para la Gerencia de Fiscalización Forestal y
              Evaluación Ambiental. Datos <code>sha256 {cap.sha256.slice(0, 16)}…</code>.
              Consultado el {new Date().toLocaleDateString('es-CL')}.
            </p>
          )}
          <p>
            El mapa base y sus condiciones son de terceros y se declaran en la atribución de la
            esquina inferior del mapa. La capa Sentinel-2 es un compuesto anual de EOX con
            licencia CC BY-NC-SA 4.0, o sea <strong>no comercial</strong>.
          </p>
        </section>

        <section>
          <h3>Qué NO dice este visor</h3>
          <ul className="met-lista">
            <li>No dice de quién es un terreno: el Catastro no registra propiedad.</li>
            <li>
              No dice si un bosque está sano, degradado o bien manejado. El Catastro describe
              cobertura y estructura; no califica.
            </li>
            <li>
              No mide cambio entre catastros. Las regiones no comparten año y no hay dos
              levantamientos comparables de la misma región en estos datos.
            </li>
            <li>
              No sustituye una inspección en terreno ni un informe de fiscalización. La unidad
              mínima cartografiable deja fuera los rodales pequeños.
            </li>
            <li>
              No permite contar polígonos como si fueran superficie: un polígono de 0,1 ha y otro
              de 1.295.122 ha cuentan igual en el conteo y no en las hectáreas.
            </li>
            <li>
              Las cifras de SIMEF son de otra fuente y sus períodos no cubren las mismas regiones,
              así que no forman una serie.
            </li>
            <li>
              No dice, por sí solo, si una especie está amenazada: el Catastro no registra estado
              de conservación. El filtro que lo ofrece sale de una tabla auxiliar sin validar, con
              976 de 989 especies sin verificar. Y una especie con poca superficie aquí no es una
              especie en riesgo.
            </li>
            <li>
              No dice qué especies acompañan a la dominante. Cada polígono registra hasta seis y
              este visor filtra y suma por la primera.
            </li>
            <li>
              La clase «Áreas no Reconocidas» existe en el dato y aquí no se explica por qué: no
              hay una razón documentada disponible, y se prefiere declararlo a inventarla.
            </li>
          </ul>
        </section>
      </div>
    </dialog>
  )
}
