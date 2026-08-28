import { useEffect, useRef, useState } from 'react'
import { AVISO_PUNTOS, BASEMAPS, COLOR_USO } from '../config'
import { fmt } from '../formato'
import { ambitoTexto } from '../indicadores'
import { flush } from '../urlState'
import { FILTROS, NINGUNO, cuentaSeleccion } from '../filtros'
import { BotonControl, BotonFiltro, ModalFiltro } from './GrupoFiltro'
import { ModalMapaBase, ModalTerritorio } from './ControlesPanel'
import { useTerritorio } from '../territorio'

/**
 * Cómo se llama cada dimensión dentro de `resumen.sinDato`. Son nombres
 * distintos de los de la columna del .bin, y mapearlos aquí evita repetir el
 * nombre en cada sitio donde se lee.
 */
const SIN_DATO = {
  subuso: 'subuso', estruc: 'estructura', tifo: 'tipoForestal',
  stifo: 'subtipoForestal', cober: 'cobertura', altura: 'altura',
  especie: 'especie', comuna: 'comuna',
}

/**
 * Panel de control.
 *
 * TODO CONTROL ES UN BOTÓN QUE ABRE UN MODAL. Antes había tres formas distintas
 * de elegir en el mismo panel —<select> para el territorio y el fondo, una lista
 * de botones para la leyenda, y botonera para las ocho dimensiones—, y las tres
 * respondían a la misma pregunta: qué se está mirando. Ahora son once botones
 * iguales, y lo elegido se lee en el propio botón sin abrir nada.
 *
 * Orden de las secciones, y no es casual: ÁMBITO primero. Es lo primero que
 * busca cualquiera que abre el visor —«¿y mi región?»—, y lo que se saca fuera
 * (compartir, descargar) va al fondo, que es cuando se hace.
 *
 * NADA está hardcodeado: las regiones, provincias, comunas y clases salen del
 * manifest con sus cifras. Si el ETL cambia el vocabulario, esto cambia solo.
 */
export default function PanelLateral({
  manifest,
  marginales,
  ambito,
  onAmbito,
  base,
  onBase,
  usosActivos,
  onUso,
  onLimpiarUsos,
  filtros,
  onFiltro,
  onLimpiarFiltro,
  onLimpiarFiltros,
  abierto,
  onCerrar,
  oscuro,
  onMetodologia,
  children,
}) {
  const cabecera = useRef(null)
  const montado = useRef(false)
  const [aviso, setAviso] = useState('')
  // El control cuyo modal está abierto, o null. UNO solo: montar los once
  // <dialog> a la vez sería montar once listas, y la de especies tiene 989
  // clases.
  const [abierta, setAbierta] = useState(null)
  // A qué botón devolver el foco al cerrar el modal. Un <dialog> lo devuelve
  // solo, pero éste se DESMONTA al cerrarse y entonces el foco cae al body: el
  // siguiente Tab reempieza desde el principio del panel. Medido: tras cerrar
  // el modal de Especie, el foco acababa en el botón de Subclase.
  //
  // No se puede pedir el foco dentro del propio manejador, porque el botón aún
  // está debajo de un diálogo modal —y por tanto inerte— cuando corre. Se
  // apunta a quién enfocar y se hace en un efecto, igual que App.jsx con los
  // botones de reapertura de los paneles.
  //
  // Vale para los ONCE porque todos llevan `data-col`, incluidos Territorio y
  // Mapa base: por eso el reenfoque no tuvo que generalizarse a mano.
  const aEnfocar = useRef(null)
  useEffect(() => {
    if (abierta !== null || !aEnfocar.current) return
    const col = aEnfocar.current
    aEnfocar.current = null
    document.querySelector(`.grupo-filtro[data-col="${col}"]`)?.focus()
  }, [abierta])

  const cerrarFiltro = () => {
    aEnfocar.current = abierta
    setAbierta(null)
  }

  useEffect(() => {
    if (!montado.current) {
      montado.current = true
      return
    }
    if (abierto) cabecera.current?.focus()
  }, [abierto])

  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(''), 2000)
    return () => clearTimeout(t)
  }, [aviso])

  // Sólo para rotular el botón: las tres listas las arma el modal con el mismo
  // hook, así que el botón y el modal cuentan lo mismo por construcción.
  const { regiones } = useTerritorio(manifest, marginales, ambito)

  const hayAmbito = Boolean(ambito.region)
  // Con las cifras nacionales no hay nada que aclarar; con un recorte activo,
  // las listas cuentan sobre conjuntos distintos del mapa y hay que decirlo.
  const hayRecorte = Boolean(marginales) && marginales.fuente !== 'manifest'
  const activas = cuentaSeleccion(filtros) + (usosActivos.size > 0 ? 1 : 0)
  const paleta = COLOR_USO[oscuro ? 'oscuro' : 'claro']
  const chipsUso = (manifest?.usos ?? []).map((u) => paleta[u.cod])
  const defAbierta = FILTROS.find((d) => d.col === abierta) ?? null

  // El uso vive en un estado propio de App —tiene control aparte desde que era
  // la leyenda— pero se dibuja como una dimensión más. La adaptación es esto y
  // nada más: unificar los dos estados en App sería tocar el canal de filtrado,
  // que está medido, para ahorrar tres líneas aquí.
  const esUso = (col) => col === 'uso'
  const seleccionDe = (col) => (esUso(col) ? usosActivos : (filtros[col] ?? NINGUNO))
  const alternar = (col, i) => (esUso(col) ? onUso(i) : onFiltro(col, i))
  const limpiar = (col) => (esUso(col) ? onLimpiarUsos() : onLimpiarFiltro(col))

  const limpiarTodo = () => {
    onLimpiarFiltros()
    onLimpiarUsos()
  }

  const compartir = async () => {
    // flush PRIMERO: la URL se escribe con 250 ms de retraso, así que sin esto
    // pulsar el botón justo después de mover el mapa copia el encuadre ANTERIOR.
    flush()
    const url = window.location.href
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
      setAviso(url)
    }
  }

  return (
    <aside id="panel-control" className={`panel${abierto ? ' abierto' : ''}`} aria-label="Control">
      <header>
        <h1 ref={cabecera} tabIndex={-1}>
          Catastro de Usos de la Tierra y Recursos Vegetacionales
        </h1>
        <p className="sub">CONAF · Catastro de Bosque Nativo</p>
        <button type="button" className="cerrar" onClick={onCerrar} aria-label="Cerrar panel">
          ×
        </button>
      </header>

      <section>
        <h2>Ámbito</h2>
        {/* UN botón para los tres niveles. Rotula el ámbito completo —«Los Lagos
            › Chiloé › Ancud»— porque es lo que decide de qué territorio son
            todas las cifras del visor, y eso no puede vivir sólo dentro de un
            modal cerrado. */}
        <div className="filtro-botonera una">
          <BotonControl
            col="territorio"
            corto="Territorio"
            valor={manifest ? ambitoTexto(ambito, manifest) : 'todo Chile'}
            total={regiones.length}
            onAbrir={setAbierta}
            titulo={
              hayAmbito && manifest
                ? `Ámbito actual: ${ambitoTexto(ambito, manifest)}`
                : `Todo Chile · ${regiones.length} regiones`
            }
          />
        </div>
      </section>

      <section className="seccion-filtros">
        <h2>
          Filtros
          {activas > 0 && <span className="cuenta-filtros">{activas}</span>}
        </h2>
        <p className="nota">
          Se cruzan entre sí y con el ámbito: el mapa y todas las cifras del panel de
          indicadores muestran sólo lo que pasa todos los filtros a la vez.
        </p>
        {/* QUÉ MIDEN LAS CIFRAS DE ESTAS LISTAS, que ya no es lo mismo que el
            mapa. Cada lista cuenta ignorando SU PROPIO filtro y aplicando los
            demás, que es lo único que permite marcar una segunda clase de la
            misma dimensión: contando con su propio filtro puesto, las hermanas
            de la clase marcada valen cero por construcción. Decirlo aquí evita
            que alguien reste dos cifras que no son del mismo conjunto. */}
        {hayRecorte && (
          <p className="nota">
            Dentro de cada lista, la cifra es lo que quedaría <strong>al elegir esa clase</strong>,
            cruzada con los demás filtros. Por eso pueden sumar más que el total del mapa.
          </p>
        )}

        {/* La botonera. Dos columnas: las nueve dimensiones caben en cinco
            filas, y el estado de todas se lee de una vez en vez de tener que
            desplegarlas una a una. Uso va la PRIMERA porque es la dimensión que
            pinta el mapa. */}
        <div className="filtro-botonera">
          {FILTROS.map((def) => (
            <BotonFiltro
              key={def.col}
              def={def}
              manifest={manifest}
              // El MARGINAL, no el resumen: la lista de una dimensión no se
              // puede contar sobre un recorte que ya aplica su propio filtro.
              cifras={marginales}
              seleccion={seleccionDe(def.col)}
              chips={esUso(def.col) ? chipsUso : null}
              onAbrir={setAbierta}
            />
          ))}
        </div>

        {activas > 0 && (
          <button type="button" className="limpiar" onClick={limpiarTodo}>
            Quitar los {activas} filtros
          </button>
        )}
      </section>

      <section>
        <h2>Mapa base</h2>
        <div className="filtro-botonera una">
          <BotonControl
            col="base"
            corto="Imagen de fondo"
            valor={base}
            total={Object.keys(BASEMAPS).length}
            onAbrir={setAbierta}
            titulo={`Fondo actual: ${base}`}
          />
        </div>
        {/* La advertencia del fondo ACTIVO se queda fuera del modal además de
            dentro: es lo único que explica un mapa con huecos sin tener que
            abrir nada. La nota sale de config.js y no de una comparación con el
            literal del nombre: cada capa declara la suya junto a su URL, que es
            donde vive el motivo. */}
        {BASEMAPS[base]?.nota && <p className="nota">{BASEMAPS[base].nota}</p>}
      </section>

      {/* COMPARTIR Y DESCARGAR VAN AL FONDO, y el orden del panel no es
          decorativo: primero se acota el ámbito, luego se filtra y se configura
          el fondo, y sólo al final se saca algo fuera. */}
      <section>
        <h2>Compartir</h2>
        <button type="button" className="compartir" onClick={compartir}>
          Compartir esta vista
        </button>
        {/* No es opcional: un enlace con ?reg= entrega cifras REGIONALES, y sin
            avisarlo se citan como nacionales. */}
        <p className="nota">
          El enlace guarda el ámbito, todos los filtros activos y el mapa base. Quien lo abra
          verá exactamente estas cifras, que no son las nacionales.
        </p>
        <span className="aviso-copia" aria-live="polite">{aviso}</span>
      </section>

      {/* La sección de descargas llega como children y no como diez props más:
          este panel sigue sin saber nada de exportar. */}
      {children}

      {/* SIMBOLOGÍA VA LA ÚLTIMA, y es deliberado: no es un control, es la
          glosa de cómo leer el mapa. Estaba en segundo lugar —donde había
          estado la leyenda, que sí era un control— y se comía la parte alta del
          panel empujando los filtros hacia abajo. Se lee una vez y se vuelve a
          ella cuando surge la duda, así que su sitio es el pie. */}
      <section>
        <h2>Simbología</h2>
        {/* LA LEYENDA YA NO ESTÁ EN EL PANEL, y hay que decir qué se perdió con
            ella: era uno de los mecanismos que hacían que el color no fuera la
            única codificación. Los nombres y las superficies siguen, pero
            dentro del modal de Uso, o sea a un clic. La tira de color del botón
            no es un sustituto: ordena los tonos, no los nombra.
            config.js documenta cuáles de aquellos mecanismos quedan vivos. */}
        <p className="nota">
          Los nueve colores del mapa se nombran en <strong>Uso</strong>, con su superficie al
          lado. El color no es la única marca, pero sí la única que está a la vista sin abrirlo.
        </p>
        {/* AHORA SÍ ES PROPORCIONAL, y por eso este texto cambió. El radio pasó
            de píxeles a METROS —el del círculo de igual área que el polígono—,
            así que el disco ocupa el terreno que el dato declara y crece con el
            zoom. Antes decía «no es proporcional», que era cierto y ahora sería
            falso: el rigor de esta línea es lo que la hace útil, en los dos
            sentidos. */}
        <p className="nota">
          El tamaño del punto es <strong>proporcional a la superficie</strong> del polígono: el
          disco cubre la misma área que él, así que crece al acercarse. Se acota por abajo para
          que no desaparezca a escala de país, y por arriba para que un polígono enorme no tape
          a sus vecinos.
        </p>
      </section>


      <footer>
        <p className="procedencia">{AVISO_PUNTOS}</p>
        {/* Las DOS unidades, porque el banner nombra a las dos: la Unidad de
            Información y Análisis construye este visor para la Gerencia de
            Fiscalización. Si la imagen del banner no carga, este pie es la única
            atribución en texto que queda en la página. */}
        <p className="procedencia">
          Publica: CONAF · Gerencia de Fiscalización Forestal y Evaluación Ambiental
        </p>
        <p className="procedencia">Desarrolla: Unidad de Información y Análisis</p>
        {/* El enlace a la metodología va en el pie Y en el aviso del mapa: es
            donde alguien lo busca cuando ya tiene una cifra delante y quiere
            saber qué significa. */}
        <button type="button" className="enlace-met" onClick={onMetodologia}>
          Metodología, definiciones y qué no dice este visor
        </button>
        {manifest && (
          <p className="procedencia">
            Datos <code>{manifest.capas.cbn_puntos.sha256.slice(0, 12)}</code> ·{' '}
            {fmt.format(manifest.total.filas)} polígonos
          </p>
        )}
      </footer>

      {/* UN SOLO modal a la vez, y montado sólo cuando hay uno abierto. Se monta
          con `key` para que cada control estrene su estado: sin ella, React
          reutilizaría la instancia y el buscador y el scroll de una lista
          aparecerían dentro de la siguiente. */}
      {defAbierta && (
        <ModalFiltro
          key={defAbierta.col}
          def={defAbierta}
          manifest={manifest}
          cifras={marginales}
          seleccion={seleccionDe(defAbierta.col)}
          sinDato={marginales?.sinDato?.[SIN_DATO[defAbierta.col]] ?? 0}
          paleta={esUso(defAbierta.col) ? paleta : null}
          onAlternar={alternar}
          onLimpiar={limpiar}
          onCerrar={cerrarFiltro}
        />
      )}
      {abierta === 'territorio' && (
        <ModalTerritorio
          manifest={manifest}
          marginales={marginales}
          ambito={ambito}
          onAmbito={onAmbito}
          onCerrar={cerrarFiltro}
        />
      )}
      {abierta === 'base' && (
        <ModalMapaBase base={base} onBase={onBase} onCerrar={cerrarFiltro} />
      )}
    </aside>
  )
}
