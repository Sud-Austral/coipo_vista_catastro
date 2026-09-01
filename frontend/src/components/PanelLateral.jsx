import { useEffect, useRef, useState } from 'react'
import { BASEMAPS, COLOR_USO } from '../config'
import { ambitoTexto } from '../indicadores'
import { FILTROS, NINGUNO, cuentaSeleccion } from '../filtros'
import { BotonControl, BotonFiltro, ModalFiltro } from './GrupoFiltro'
import { ModalMapaBase, ModalTerritorio } from './ControlesPanel'
import { ModalCompartir, ModalDescargas, ModalInformacion } from './ModalesPanel'
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
 * Y NO TIENE UNA SOLA LÍNEA DE PROSA. Tenía seis párrafos de nota, una sección
 * de simbología y un pie con cuatro atribuciones, todo compitiendo por el sitio
 * con los diecisiete controles que son la razón de estar aquí. Nada se ha
 * borrado: está entero en el modal de Información, junto con la Metodología, y
 * se lee cuando se busca en vez de cada vez que se filtra.
 *
 * Orden de las secciones, y no es casual: ÁMBITO primero. Es lo primero que
 * busca cualquiera que abre el visor —«¿y mi región?»—, y los tres botones que
 * sacan algo fuera —información, descargas y enlace— van al fondo.
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
  // ELEMENTOS y no veinte props. Es lo que ya hacía la sección de descargas
  // cuando llegaba como `children`: el panel sigue sin saber nada de exportar
  // ni de la guía oficial de códigos, y App no reenvía `datos`, `filtro`,
  // `resumen`, `oficiales` y `simef` por dos niveles de componente.
  descargas,
  metodologia,
}) {
  const cabecera = useRef(null)
  const montado = useRef(false)
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
      </section>

      {/* LOS TRES QUE SACAN ALGO FUERA, y lo único que queda debajo de los
          controles. Antes eran dos secciones con su prosa y un pie de cuatro
          párrafos; ahora son tres botones de la misma forma que los otros
          diecisiete, y lo que decían está dentro. */}
      <section>
        <div className="filtro-botonera tres">
          <BotonControl col="info" corto="Información" total={null}
                        onAbrir={setAbierta} titulo="Cómo leer este visor, metodología y fuentes" />
          <BotonControl col="descargas" corto="Descargar" total={null}
                        onAbrir={setAbierta} titulo="CSV, GeoJSON y el reporte en PDF" />
          <BotonControl col="compartir" corto="Compartir" total={null}
                        onAbrir={setAbierta} titulo="El enlace de esta vista exacta" />
        </div>
      </section>

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
      {abierta === 'info' && (
        <ModalInformacion
          manifest={manifest}
          base={base}
          hayRecorte={hayRecorte}
          metodologia={metodologia}
          onCerrar={cerrarFiltro}
        />
      )}
      {abierta === 'descargas' && (
        <ModalDescargas descargas={descargas} onCerrar={cerrarFiltro} />
      )}
      {abierta === 'compartir' && <ModalCompartir onCerrar={cerrarFiltro} />}
    </aside>
  )
}
