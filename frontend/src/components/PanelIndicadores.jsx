import { useEffect, useMemo, useRef } from 'react'
import { COLOR_USO, paletaRGB } from '../config'
import { fmt, ha, haExacta, numero, pct, titular } from '../formato'
import {
  ambitoTexto,
  anioDelAmbito,
  composicionBosque,
  estructurasBosqueNativo,
  resumenSnaspe,
} from '../indicadores'
import {
  Advertencia,
  BarraApilada,
  BarraFila,
  Cifra,
  Composicion,
  Discontinuidad,
  TablaKpi,
} from './graficos'

/**
 * Panel de lectura.
 *
 * PLANTILLA INVARIANTE, sin excepciones, en todas las secciones:
 *   <details> → <summary> con el h2, su cifra clave y ⚠ si tiene advertencia
 *             → bajada: qué PREGUNTA responde, en idioma de calle
 *             → cuerpo
 *             → TablaKpi gemela, oculta pero no para el lector de pantalla
 *             → nota de cobertura, calculada
 *             → advertencia metodológica plegada, con el título haciendo el trabajo
 *
 * TODAS las secciones son <details> en los TRES regímenes, no sólo en móvil.
 * En columna continua esto mide varios miles de píxeles, y un solo mecanismo
 * para los tres regímenes es además un solo camino de código: no se puede
 * desincronizar.
 *
 * La advertencia de una sección PLEGADA se ve igual, con el ⚠ en el summary.
 * Plegar el gráfico está bien; plegar la advertencia sería esconderla.
 *
 * NINGUNA SECCIÓN SE DESMONTA JAMÁS. Si el filtro deja cero resultados, la
 * sección sigue ahí con «—» en sus valores: que la estructura no se mueva es lo
 * que permite entender que el problema es el filtro y no la herramienta.
 */
export default function PanelIndicadores({
  resumen,
  simef,
  manifest,
  ambito,
  abierto,
  cargando,
  onCerrar,
  onUso,
  usosActivos,
  oscuro,
}) {
  const cabecera = useRef(null)
  const montado = useRef(false)

  // Al abrir el cajón el foco entra en su encabezado. Se salta el primer render:
  // anclado, el panel nace visible, y sin la guarda el foco saltaría aquí nada
  // más cargar la página, robándoselo a quien no ha pedido nada.
  useEffect(() => {
    if (!montado.current) {
      montado.current = true
      return
    }
    if (abierto) cabecera.current?.focus()
  }, [abierto])

  const paleta = useMemo(() => paletaRGB(oscuro ? 'oscuro' : 'claro'), [oscuro])
  const colorUso = (cod) => {
    const i = manifest?.usos.findIndex((u) => u.cod === cod)
    return i >= 0 ? `rgb(${paleta[i].join(',')})` : 'var(--acento)'
  }

  const bosque = useMemo(() => composicionBosque(resumen), [resumen])
  const estructura = useMemo(() => estructurasBosqueNativo(resumen), [resumen])
  const snaspe = useMemo(() => resumenSnaspe(resumen), [resumen])
  const anio = manifest ? anioDelAmbito(ambito, manifest) : null
  const ambitoTxt = manifest ? ambitoTexto(ambito, manifest) : ''

  const clase = ['panel-kpi', abierto ? 'abierto' : '', cargando && resumen ? 'refrescando' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <aside id="panel-indicadores" className={clase} aria-label="Indicadores">
      <header>
        {/* h2 y no h1: el único h1 del documento es el del panel izquierdo. Dos
            h1 compiten por ser el título de la página y un lector de pantalla
            los anuncia como dos documentos superpuestos. */}
        <h2 ref={cabecera} tabIndex={-1}>
          Indicadores
        </h2>
        <p className="ambito">
          Ámbito: <strong>{ambitoTxt}</strong>
          {anio && ` · catastro ${anio}`}
        </p>
        <button type="button" className="cerrar" onClick={onCerrar} aria-label="Cerrar indicadores">
          ×
        </button>
      </header>

      {!resumen ? (
        <section>
          <p className="apagada">Cargando indicadores…</p>
        </section>
      ) : (
        <>
          {/* ---------- portada: la cifra que hay que recordar ---------- */}
          <section className="portada">
            <Cifra
              valor={ha(resumen.ha)}
              etiqueta={`${fmt.format(resumen.n)} polígonos · ${ambitoTxt}`}
              detalle={
                resumen.fuente === 'manifest'
                  ? `Cifra oficial de CONAF: 75.661.194,48 ha · aquí sale ${(
                      resumen.ha - 75661194.48
                    ).toFixed(2)} ha más. No se ajusta.`
                  : null
              }
            />
            {bosque && (
              <>
                <Composicion
                  total={resumen.ha}
                  etiqueta={`Composición del bosque sobre el total del ámbito: nativo ${ha(
                    bosque.nativo.ha,
                  )}, plantación ${ha(bosque.plantacion.ha)}, mixto ${ha(bosque.mixto.ha)}`}
                  partes={[
                    { clave: 'bn', valor: bosque.nativo.ha, color: colorUso('04'),
                      etiqueta: 'Bosque nativo', texto: haExacta(bosque.nativo.ha) },
                    { clave: 'pl', valor: bosque.plantacion.ha, color: 'var(--plantacion)',
                      etiqueta: 'Plantación', texto: haExacta(bosque.plantacion.ha) },
                    { clave: 'bm', valor: bosque.mixto.ha, color: 'var(--mixto)',
                      etiqueta: 'Bosque mixto', texto: haExacta(bosque.mixto.ha) },
                    { clave: 'resto', valor: resumen.ha - bosque.bosques.ha,
                      color: 'var(--superficie-2)', etiqueta: 'No es bosque',
                      texto: haExacta(resumen.ha - bosque.bosques.ha) },
                  ]}
                />
                {/* Ésta es la frase que sale del visor y se cita, así que el
                    antídoto va aquí y no tres secciones más abajo: «el 24,9 % de
                    Chile es bosque» incluye 3,1 M ha de plantación exótica. */}
                <p className="bajada">
                  El <strong>{pct(bosque.bosques.ha, resumen.ha)}</strong> del ámbito está
                  clasificado como bosque. De esas hectáreas,{' '}
                  <strong>{pct(bosque.nativo.ha, bosque.bosques.ha)}</strong> son bosque nativo.
                </p>
              </>
            )}
          </section>

          <Seccion
            id="s1"
            titulo="De qué está hecho Chile"
            cifra={ha(resumen.ha)}
            bajada="Las nueve clases del Catastro, de mayor a menor superficie. Las nueve juntas son todo el territorio catastrado."
            abiertaPorDefecto
            nota={`${fmt.format(resumen.usos.length)} de 9 clases presentes en este ámbito · ${
              fmt.format(resumen.n)
            } polígonos`}
            advertencia={{
              titulo: 'Por qué estas nueve clases no se comparan con otro año',
              cuerpo:
                'Cada región se catastró en un año distinto entre 2014 y 2024, así que el reparto ' +
                'nacional mezcla fotos de años diferentes. No es una serie temporal y no existe en ' +
                'este visor ningún control que ofrezca dos años: lo que no se puede hacer, no se dibuja.',
            }}
            tabla={{
              titulo: 'Superficie por clase de uso',
              cabeceras: ['Uso', 'Hectáreas', 'Porcentaje', 'Polígonos'],
              filas: resumen.usos.map((u) => [
                u.etiqueta,
                haExacta(u.ha),
                pct(u.ha, resumen.ha),
                numero(u.n),
              ]),
            }}
          >
            {resumen.usos.map((u) => {
              const i = manifest.usos.findIndex((x) => x.cod === u.cod)
              return (
                <BarraFila
                  key={u.cod}
                  etiqueta={u.etiqueta}
                  valor={u.ha}
                  max={resumen.usos[0].ha}
                  texto={ha(u.ha)}
                  extra={pct(u.ha, resumen.ha)}
                  color={COLOR_USO[oscuro ? 'oscuro' : 'claro'][u.cod]}
                  titulo={`${u.etiqueta}: ${haExacta(u.ha)} en ${numero(u.n)} polígonos`}
                  onClick={() => onUso(i)}
                  activa={usosActivos.size === 0 || usosActivos.has(i)}
                />
              )
            })}
          </Seccion>

          <Seccion
            id="s2"
            titulo="Cuánto de Chile es bosque"
            cifra={bosque ? ha(bosque.bosques.ha) : '—'}
            bajada="«Bosque» en el Catastro incluye las plantaciones. Éste es el desglose que casi siempre falta cuando se cita la cifra."
            abiertaPorDefecto
            nota={
              bosque
                ? `Denominador: los ${ha(bosque.bosques.ha)} de bosque del ámbito, no el total del país`
                : 'Sin bosque en este ámbito'
            }
            advertencia={{
              titulo: 'Qué cuenta el Catastro como «plantación», y por qué no cuadra con INFOR',
              cuerpo:
                'La clase incluye superficies recién cosechadas y no descuenta caminos ni canchas, ' +
                'así que no es comparable con las estadísticas de INFOR. Además, 7.191 polígonos de ' +
                'La Araucanía (24.591 ha, catastro 2024) traen el texto «Bosque» en la capa de origen ' +
                'y el código oficial de subuso «Plantación». Este visor usa el código, que es el que ' +
                'reproduce al céntimo la cifra publicada por CONAF.',
            }}
            tabla={
              bosque && {
                titulo: 'Composición del bosque',
                cabeceras: ['Clase', 'Hectáreas', '% del bosque', 'Polígonos'],
                filas: [
                  ['Bosque nativo', haExacta(bosque.nativo.ha),
                   pct(bosque.nativo.ha, bosque.bosques.ha), numero(bosque.nativo.n)],
                  ['Plantación', haExacta(bosque.plantacion.ha),
                   pct(bosque.plantacion.ha, bosque.bosques.ha), numero(bosque.plantacion.n)],
                  ['Bosque mixto', haExacta(bosque.mixto.ha),
                   pct(bosque.mixto.ha, bosque.bosques.ha), numero(bosque.mixto.n)],
                ],
              }
            }
          >
            {bosque &&
              [
                { k: 'bn', d: bosque.nativo, e: 'Bosque nativo', c: colorUso('04') },
                { k: 'pl', d: bosque.plantacion, e: 'Plantación', c: 'var(--plantacion)' },
                { k: 'bm', d: bosque.mixto, e: 'Bosque mixto', c: 'var(--mixto)' },
              ].map(({ k, d, e, c }) => (
                <BarraFila
                  key={k}
                  etiqueta={e}
                  valor={d.ha}
                  max={bosque.bosques.ha}
                  texto={ha(d.ha)}
                  extra={pct(d.ha, bosque.bosques.ha)}
                  color={c}
                  titulo={`${e}: ${haExacta(d.ha)} en ${numero(d.n)} polígonos`}
                />
              ))}
          </Seccion>

          <Seccion
            id="s3"
            titulo="Cómo es el bosque nativo por dentro"
            cifra={estructura ? ha(estructura.total.ha) : '—'}
            bajada="En qué estado de desarrollo está el bosque nativo: adulto, renoval, mezcla de los dos, o achaparrado."
            nota={
              estructura
                ? `Denominador: los ${ha(estructura.total.ha)} de bosque nativo del ámbito`
                : 'Sin bosque nativo en este ámbito'
            }
            advertencia={{
              titulo: 'Qué mide «estructura», y qué no',
              cuerpo:
                'Describe el estado de desarrollo del rodal, no su edad ni su calidad. «Achaparrado» ' +
                'no es un bosque degradado: es la forma que toma el bosque en el límite altitudinal y ' +
                'en Magallanes, y es su estado natural. Comparar el achaparrado de Magallanes con el ' +
                'siempreverde de Los Lagos no mide deterioro, mide dos ecosistemas distintos.',
            }}
            tabla={
              estructura && {
                titulo: 'Bosque nativo por estructura',
                cabeceras: ['Estructura', 'Hectáreas', '% del nativo', 'Polígonos'],
                filas: estructura.filas.map((e) => [
                  e.etiqueta, haExacta(e.ha), pct(e.ha, estructura.total.ha), numero(e.n),
                ]),
              }
            }
          >
            {estructura?.filas.map((e) => (
              <BarraFila
                key={e.cod}
                etiqueta={e.etiqueta}
                valor={e.ha}
                max={estructura.filas[0].ha}
                texto={ha(e.ha)}
                extra={pct(e.ha, estructura.total.ha)}
                titulo={`${e.etiqueta}: ${haExacta(e.ha)} en ${numero(e.n)} polígonos`}
              />
            ))}
          </Seccion>

          <Seccion
            id="s4"
            titulo="Tipos forestales"
            cifra={resumen.tiposForestales.length ? ha(resumen.tiposForestales[0].ha) : '—'}
            bajada="Los tipos forestales que reconoce la Ley 20.283, ordenados por superficie."
            nota={`No aplica a plantaciones ni a bosque mixto · ${fmt.format(
              resumen.tiposForestales.reduce((a, t) => a + t.n, 0),
            )} polígonos clasificados`}
            advertencia={{
              titulo: 'Qué decide el tipo forestal, y qué no decide',
              cuerpo:
                'El tipo forestal es una clasificación fitosociológica de la Ley 20.283 y determina ' +
                'qué normas de manejo aplican. No dice qué especie domina un rodal concreto ni cuánta ' +
                'biomasa tiene. Sólo Alerce y Araucaria llevan aquí su figura legal, porque son las ' +
                'dos que se pueden citar con su decreto; las demás no se rotulan hasta verificar el ' +
                'instrumento.',
            }}
            tabla={{
              titulo: 'Superficie por tipo forestal',
              cabeceras: ['Tipo forestal', 'Hectáreas', 'Polígonos'],
              filas: resumen.tiposForestales.map((t) => [
                t.etiqueta, haExacta(t.ha), numero(t.n),
              ]),
            }}
          >
            {resumen.tiposForestales.map((t) => (
              <BarraFila
                key={t.cod}
                etiqueta={t.etiqueta}
                glosa={t.legal}
                valor={t.ha}
                max={resumen.tiposForestales[0].ha}
                texto={ha(t.ha)}
                titulo={`${t.etiqueta}: ${haExacta(t.ha)} en ${numero(t.n)} polígonos`}
              />
            ))}
          </Seccion>

          {/* Subtipos: la subdivisión del tipo forestal. Va pegada a S4 porque
              sin el tipo delante un subtipo no significa nada. */}
          <Seccion
            id="s4b"
            titulo="Subtipos forestales"
            cifra={resumen.subtiposForestales.length
              ? ha(resumen.subtiposForestales[0].ha) : '—'}
            bajada="La subdivisión del tipo forestal, ordenada por superficie."
            nota={`${resumen.subtiposForestales.length} subtipos con superficie · ${fmt.format(
              resumen.sinDato?.subtipoForestal ?? 0,
            )} polígonos sin este dato`}
            advertencia={{
              titulo: 'Por qué este vocabulario no es el oficial',
              cuerpo:
                'El subtipo forestal se agrupa por el TEXTO de la capa y no por su código, que es ' +
                'la única dimensión donde se hace así. El motivo está medido: ID_STIF tiene 10 ' +
                'códigos para 39 subtipos distintos, y usar el par (tipo, subtipo) como clave ' +
                'empeora la ambigüedad en vez de resolverla. La guía oficial de códigos no nombra ' +
                'estos subtipos, así que las etiquetas salen del propio dato, normalizadas.',
            }}
            tabla={{
              titulo: 'Superficie por subtipo forestal',
              cabeceras: ['Subtipo', 'Hectáreas', 'Polígonos'],
              filas: resumen.subtiposForestales.map((t) => [
                t.etiqueta, haExacta(t.ha), numero(t.n),
              ]),
            }}
          >
            {resumen.subtiposForestales.slice(0, 15).map((t) => (
              <BarraFila
                key={t.cod}
                etiqueta={t.etiqueta}
                valor={t.ha}
                max={resumen.subtiposForestales[0].ha}
                texto={ha(t.ha)}
                titulo={`${t.etiqueta}: ${haExacta(t.ha)} en ${numero(t.n)} polígonos`}
              />
            ))}
            {resumen.subtiposForestales.length > 15 && (
              <p className="nota">
                Se dibujan los 15 mayores de {resumen.subtiposForestales.length}. La tabla de datos
                los lleva todos.
              </p>
            )}
          </Seccion>

          <Seccion
            id="s4c"
            titulo="Densidad del dosel"
            cifra={(() => {
              const d = resumen.coberturas.find((c) => c.orden === 1)
              return d ? ha(d.ha) : '—'
            })()}
            bajada="Cuánto cubren las copas, de Denso a Escaso. Se lee en orden de densidad, no de superficie."
            nota={`${fmt.format(resumen.sinDato?.cobertura ?? 0)} polígonos sin este dato`}
            advertencia={{
              titulo: 'Qué mide la densidad de copas, y qué no mide',
              cuerpo:
                'Es la fracción del suelo que tapan las copas vistas desde arriba. NO es una medida ' +
                'de salud, de calidad ni de degradación: un bosque escleròfilo abierto puede ser ' +
                'perfectamente sano, y el Catastro describe sin calificar. «No Aplica» no es una ' +
                'densidad baja: es el territorio donde la pregunta no tiene sentido, como los ' +
                'cuerpos de agua o las áreas desprovistas de vegetación.',
            }}
            tabla={{
              titulo: 'Superficie por densidad de copas',
              cabeceras: ['Densidad', 'Hectáreas', 'Polígonos'],
              filas: [...resumen.coberturas]
                .sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99))
                .map((c) => [c.etiqueta, haExacta(c.ha), numero(c.n)]),
            }}
          >
            {[...resumen.coberturas]
              .sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99))
              .map((c) => (
                <BarraFila
                  key={c.cod}
                  etiqueta={c.etiqueta}
                  valor={c.ha}
                  max={Math.max(...resumen.coberturas.map((x) => x.ha))}
                  texto={ha(c.ha)}
                  titulo={`${c.etiqueta}: ${haExacta(c.ha)} en ${numero(c.n)} polígonos`}
                />
              ))}
          </Seccion>

          <Seccion
            id="s4d"
            titulo="Altura del dosel"
            cifra={(() => {
              const f = resumen.alturas.filter((a) => a.escala === 'fina')
              return f.length ? ha(f.reduce((s, a) => s + a.ha, 0)) : '—'
            })()}
            bajada="En qué tramo de altura está el dosel. Vienen dos escalas distintas y no se pueden sumar entre sí."
            nota={`${fmt.format(resumen.sinDato?.altura ?? 0)} polígonos sin este dato`}
            advertencia={{
              titulo: 'Por qué estas barras no se comparan entre sí',
              cuerpo:
                'El Catastro midió la altura con DOS reglas. La escala fina da tramos en metros ' +
                '(0-0,5 hasta más de 32) y la gruesa sólo distingue por encima y por debajo de 2 m. ' +
                'Sus tramos SE SOLAPAN: «menos de 2 m» cubre lo mismo que los tres primeros tramos ' +
                'finos juntos. Sumar las dos escalas contaría dos veces el mismo rango, así que ' +
                'aquí van separadas y sin total común.',
            }}
            tabla={{
              titulo: 'Superficie por tramo de altura',
              cabeceras: ['Escala', 'Tramo (m)', 'Hectáreas', 'Polígonos'],
              filas: resumen.alturas.map((a) => [
                a.escala, a.etiqueta, haExacta(a.ha), numero(a.n),
              ]),
            }}
          >
            {['fina', 'gruesa', 'no_aplica'].map((esc) => {
              const clases = resumen.alturas
                .filter((a) => a.escala === esc)
                .sort((x, y) => (x.orden ?? 99) - (y.orden ?? 99))
              if (!clases.length) return null
              const tope = Math.max(...clases.map((x) => x.ha))
              return (
                <div key={esc} className="bloque-escala">
                  <p className="rotulo-escala">
                    {esc === 'fina'
                      ? 'Escala en metros'
                      : esc === 'gruesa'
                        ? 'Escala gruesa · se solapa con la anterior'
                        : 'Sin altura aplicable'}
                  </p>
                  {clases.map((a) => (
                    <BarraFila
                      key={a.cod}
                      etiqueta={a.etiqueta}
                      valor={a.ha}
                      max={tope}
                      texto={ha(a.ha)}
                      titulo={`${a.etiqueta} m: ${haExacta(a.ha)} en ${numero(a.n)} polígonos`}
                    />
                  ))}
                </div>
              )
            })}
          </Seccion>

          <Seccion
            id="s4e"
            titulo="Especies dominantes"
            cifra={resumen.especies.length ? ha(resumen.especies[0].ha) : '—'}
            bajada="La primera especie registrada en cada polígono, la que domina el rodal."
            nota={`${resumen.especies.length} especies con superficie · ${fmt.format(
              resumen.sinDato?.especie ?? 0,
            )} polígonos sin este dato`}
            advertencia={{
              titulo: 'Qué cuenta esta lista, y qué deja fuera',
              cuerpo:
                'Cada polígono puede registrar hasta SEIS especies y aquí sólo cuenta la primera, ' +
                'la dominante: la superficie de un polígono se asigna entera a esa especie. No es ' +
                'una convención de este visor — es la misma que usa la planilla oficial de CONAF, y ' +
                'reproducirla da 1.714.737,31 ha de Pinus radiata contra las 1.714.736,78 ' +
                'publicadas. La lista incluye toda la vegetación, no sólo árboles, y no dice nada ' +
                'del estado de conservación de ninguna especie: el Catastro no registra ese dato.',
            }}
            tabla={{
              titulo: 'Superficie por especie principal',
              cabeceras: ['Especie', 'Nombre científico', 'Hectáreas', 'Polígonos'],
              filas: resumen.especies.map((e) => [
                e.etiqueta, e.cientifico ?? '—', haExacta(e.ha), numero(e.n),
              ]),
            }}
          >
            {resumen.especies.slice(0, 15).map((e) => (
              <BarraFila
                key={e.cod}
                etiqueta={e.etiqueta}
                glosa={e.cientifico !== e.etiqueta ? e.cientifico : null}
                valor={e.ha}
                max={resumen.especies[0].ha}
                texto={ha(e.ha)}
                titulo={`${e.cientifico ?? e.etiqueta}: ${haExacta(e.ha)} en ${numero(e.n)} polígonos`}
              />
            ))}
            {resumen.especies.length > 15 && (
              <p className="nota">
                Se dibujan las 15 mayores de {resumen.especies.length}. La tabla de datos las lleva
                todas.
              </p>
            )}
          </Seccion>

          <Seccion
            id="s5"
            titulo="Dónde está"
            cifra={resumen.regiones.length ? `${resumen.regiones.length} regiones` : '—'}
            bajada="Reparto por región. Cada barra lleva el año de su catastro, porque no se levantaron el mismo año."
            nota={`${fmt.format(resumen.regiones.length)} regiones con datos en este ámbito`}
            advertencia={{
              titulo: 'Por qué ordenar estas barras ordena años distintos',
              cuerpo:
                'Cada región se catastró en un año distinto entre 2014 y 2024. Ordenarlas por ' +
                'superficie es legítimo; leer el orden como una evolución, no. Dos regiones vecinas ' +
                'en esta lista pueden estar separadas por diez años de levantamiento.',
            }}
            tabla={{
              titulo: 'Superficie por región',
              cabeceras: ['Región', 'Año', 'Hectáreas', 'Polígonos'],
              filas: resumen.regiones
                .slice()
                .sort((a, b) => b.ha - a.ha)
                .map((r) => [r.nombre, r.anio, haExacta(r.ha), numero(r.n)]),
            }}
          >
            {resumen.regiones
              .slice()
              .sort((a, b) => b.ha - a.ha)
              .map((r) => (
                <BarraFila
                  key={r.cod}
                  etiqueta={r.nombre}
                  glosa={`catastro ${r.anio}`}
                  valor={r.ha}
                  max={Math.max(...resumen.regiones.map((x) => x.ha))}
                  texto={ha(r.ha)}
                  titulo={`${r.nombre}, catastro ${r.anio}: ${haExacta(r.ha)}`}
                />
              ))}
          </Seccion>

          <Seccion
            id="s6"
            titulo="Qué hay dentro del SNASPE"
            cifra={snaspe ? ha(snaspe.total) : '—'}
            bajada="Cuánta de esta superficie está dentro del Sistema Nacional de Áreas Silvestres Protegidas del Estado."
            nota={
              snaspe
                ? `${snaspe.unidades} unidades · ${pct(snaspe.total, resumen.ha)} del ámbito`
                : 'Sin unidades del SNASPE en este ámbito'
            }
            advertencia={{
              titulo: 'Cómo se contaron las unidades, y qué se corrigió',
              cuerpo:
                'La categoría se deduce del nombre de la unidad, no del campo de categoría: cinco ' +
                'unidades traían en la capa de origen una categoría vacía, inexistente en el SNASPE, ' +
                'o dos categorías a la vez. Las correcciones están publicadas en el manifest, ninguna ' +
                'se aplicó en silencio. La Ley 21.600 creó el SBAP y su implementación está en curso; ' +
                'aquí se usa el nombre que trae el dato.',
            }}
            tabla={
              snaspe && {
                titulo: 'Superficie protegida por categoría',
                cabeceras: ['Categoría', 'Unidades', 'Hectáreas'],
                filas: snaspe.categorias.map((c) => [
                  c.categoria, numero(c.unidades), haExacta(c.ha),
                ]),
              }
            }
          >
            {snaspe?.categorias.map((c) => (
              <BarraFila
                key={c.categoria}
                etiqueta={c.categoria}
                glosa={`${c.unidades} unidades`}
                valor={c.ha}
                max={snaspe.categorias[0].ha}
                texto={ha(c.ha)}
                extra={pct(c.ha, snaspe.total)}
                titulo={`${c.categoria}: ${haExacta(c.ha)} en ${c.unidades} unidades`}
              />
            ))}
            {snaspe?.mayores.length > 0 && (
              <>
                <h3>Unidades mayores</h3>
                {snaspe.mayores.map((u) => (
                  <BarraFila
                    key={u.cod}
                    etiqueta={titular(u.etiqueta)}
                    glosa={u.categoria}
                    valor={u.ha}
                    max={snaspe.mayores[0].ha}
                    texto={ha(u.ha)}
                    titulo={`${u.etiqueta} (${u.categoria}): ${haExacta(u.ha)}`}
                  />
                ))}
              </>
            )}
          </Seccion>
          <SeccionSimef simef={simef} />
          <SeccionAnios manifest={manifest} />
        </>
      )}

      <footer>
        {resumen?.fuente === 'manifest'
          ? 'Cifras nacionales, calculadas por el ETL y contrastadas contra las tablas oficiales de CONAF.'
          : 'Cifras calculadas en el navegador sobre el ámbito activo.'}
      </footer>
    </aside>
  )
}

/**
 * Una sección. Es <details> siempre, en los tres regímenes.
 * El ⚠ va en el <summary>, así que se ve también con la sección plegada.
 */
function Seccion({ id, titulo, cifra, bajada, nota, advertencia, tabla, abiertaPorDefecto, children }) {
  return (
    <details className="seccion" id={id} open={abiertaPorDefecto}>
      <summary>
        <span className="s-titulo">{titulo}</span>
        <span className="s-cifra">{cifra}</span>
        {advertencia && (
          <span className="s-aviso" title="Esta sección tiene una advertencia metodológica">
            ⚠
          </span>
        )}
      </summary>
      <div className="s-cuerpo">
        <p className="bajada">{bajada}</p>
        {children}
        {tabla && <TablaKpi {...tabla} />}
        {nota && <p className="nota">{nota}</p>}
        {advertencia && (
          <Advertencia titulo={advertencia.titulo}>{advertencia.cuerpo}</Advertencia>
        )}
      </div>
    </details>
  )
}

/**
 * S7 · Cambio de bosque nativo. ES OTRA FUENTE, y el título lo dice.
 *
 * Barras apiladas y no una línea de tiempo: cada par de años cubre un conjunto
 * distinto de regiones, así que unirlos con una línea afirmaría una continuidad
 * que no existe. Los pares que no cubren las 15 regiones van SEPARADOS por una
 * discontinuidad, que no es una nota: es un corte en el gráfico.
 */
function SeccionSimef({ simef }) {
  if (!simef) {
    return (
      <Seccion
        id="s7"
        titulo="Cambio de bosque nativo · SIMEF"
        cifra="—"
        bajada="Deforestación y sustitución medidas por SIMEF, una fuente distinta del Catastro."
        nota="No se pudieron cargar los datos de SIMEF. El resto del visor no depende de ellos."
      >
        <p className="apagada">Sin datos de SIMEF.</p>
      </Seccion>
    )
  }

  const utiles = simef.pares.filter((p) => !p.marginal)
  const maxBruta = Math.max(...utiles.map((p) => p.perdida_bruta), 1)
  const completos = utiles.filter((p) => p.regiones >= 15)
  const parciales = utiles.filter((p) => p.regiones < 15)
  const comp = simef.pares_comparables[0]
  const a = comp ? utiles.find((p) => p.clave === comp[0]) : null
  const b = comp ? utiles.find((p) => p.clave === comp[1]) : null

  const barra = (p) => (
    <BarraApilada
      key={p.clave}
      etiqueta={`${p.desde}–${p.hasta}`}
      glosa={`${p.anios} ${p.anios === 1 ? 'año' : 'años'} · ${p.regiones} regiones`}
      max={maxBruta}
      total={ha(p.perdida_bruta)}
      partes={[
        {
          clave: 'd',
          valor: p.deforestacion,
          color: 'var(--deforestacion)',
          etiqueta: 'Deforestación',
          texto: haExacta(p.deforestacion),
        },
        {
          clave: 's',
          valor: p.sustitucion,
          color: 'var(--sustitucion)',
          trama: true,
          etiqueta: 'Sustitución',
          texto: haExacta(p.sustitucion),
        },
      ]}
      nota={`${ha(p.por_anio)} por año · ${
        p.con_ancla_oficial.length
          ? `${p.con_ancla_oficial.length} de ${p.regiones} regiones con cifra oficial de contraste`
          : 'sin cifra oficial de contraste'
      }`}
    />
  )

  return (
    <Seccion
      id="s7"
      titulo="Cambio de bosque nativo · SIMEF"
      cifra={b ? ha(b.perdida_bruta) : '—'}
      bajada="Pérdida bruta de bosque nativo: deforestación más sustitución. Son clases disjuntas, así que se suman."
      nota={`${utiles.length} períodos con datos · la barra más larga es ${ha(maxBruta)}`}
      advertencia={{
        titulo: 'Por qué estas barras no se comparan entre sí',
        cuerpo:
          `${simef.aviso} Sólo Arica y Parinacota, Tarapacá y Atacama tienen cifra oficial ` +
          'publicada contra la que contrastar; en el resto la comprobación es interna. Por eso ' +
          'no se dibuja ninguna línea de tiempo ni ningún total 2001–2023: sería la suma de ' +
          'seis territorios distintos.',
      }}
      tabla={{
        titulo: 'Pérdida bruta de bosque nativo por período',
        cabeceras: ['Período', 'Años', 'Regiones', 'Deforestación', 'Sustitución', 'Bruta'],
        filas: utiles.map((p) => [
          `${p.desde}–${p.hasta}`,
          String(p.anios),
          String(p.regiones),
          haExacta(p.deforestacion),
          haExacta(p.sustitucion),
          haExacta(p.perdida_bruta),
        ]),
      }}
    >
      {a && b && (
        <p className="destacado">
          En el único par de períodos plenamente comparables entre sí —{a.desde}–{a.hasta} y{' '}
          {b.desde}–{b.hasta}, ambos de {a.anios} años y ambos con las {a.regiones} regiones—, la
          pérdida bruta de bosque nativo baja de <strong>{ha(a.perdida_bruta)}</strong> a{' '}
          <strong>{ha(b.perdida_bruta)}</strong>.
        </p>
      )}

      {/* La leyenda va ANTES de las barras, no después: dos colores sin nombre
          no significan nada, y en varios períodos la sustitución es tan pequeña
          que su segmento no se ve. Que se distingan por trama además de por
          color sirve de poco si nadie sabe qué es cada uno. */}
      <p className="leyenda-linea">
        <span className="muestra" style={{ background: 'var(--deforestacion)' }} />
        Deforestación: el bosque nativo pasó a un uso que no es bosque.
        <br />
        <span className="muestra tramada" style={{ background: 'var(--sustitucion)' }} />
        Sustitución: pasó a plantación. Las dos son disjuntas y aquí se suman.
      </p>
      {completos.map(barra)}
      {parciales.length > 0 && (
        <>
          <Discontinuidad>Períodos que no cubren todas las regiones</Discontinuidad>
          {parciales.map(barra)}
        </>
      )}
    </Seccion>
  )
}

/**
 * S8 · De cuándo es cada dato.
 *
 * No es un indicador: es una propiedad de TODOS los números del visor, y por eso
 * el año va además pegado a cada región en todas partes. Aquí se ve el conjunto,
 * que es lo que no cabe en una etiqueta: diez años entre la región más antigua y
 * la más reciente.
 *
 * Lista vertical y no una línea de tiempo horizontal: en 288 px, diez saltos de
 * año dan 24 px por año, y en 2024 hay cinco regiones cuyos rótulos habría que
 * apilar en ese hueco.
 */
function SeccionAnios({ manifest }) {
  if (!manifest) return null
  const anio = (r) => parseInt(String(r.anio).slice(0, 4), 10)
  const filas = manifest.regiones.slice().sort((x, y) => anio(x) - anio(y) || x.orden - y.orden)
  const min = anio(filas[0])
  const max = anio(filas[filas.length - 1])
  return (
    <Seccion
      id="s8"
      titulo="De cuándo es cada dato"
      cifra={`${min}–${max}`}
      bajada="Cada región se levantó en un año distinto. Ésta es la lista completa, de la más antigua a la más reciente."
      nota={`${max - min} años entre la región más antigua y la más reciente`}
      advertencia={{
        titulo: 'Por qué esto no es una serie temporal',
        cuerpo:
          'El Catastro es una foto por región, no una secuencia. Comparar dos regiones compara ' +
          'dos años distintos, y restar una de otra no mide ningún cambio. En este visor no ' +
          'existe ningún control que ofrezca dos años del Catastro: lo que no se puede hacer, ' +
          'no se dibuja.',
      }}
      tabla={{
        titulo: 'Año de levantamiento por región',
        cabeceras: ['Región', 'Año', 'Polígonos'],
        filas: filas.map((r) => [r.nombre, String(r.anio), numero(r.n)]),
      }}
    >
      <div className="serie-anios">
        {filas.map((r) => (
          <div className="anio-fila" key={r.cod} title={`${r.oficial ?? r.nombre} · ${r.anio}`}>
            <span className="anio-num">{r.anio}</span>
            <span
              className="anio-barra"
              style={{ width: `${20 + (70 * (anio(r) - min)) / Math.max(1, max - min)}%` }}
            />
            <span>{r.nombre}</span>
          </div>
        ))}
      </div>
    </Seccion>
  )
}
