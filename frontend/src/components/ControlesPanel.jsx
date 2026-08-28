import { BASEMAPS } from '../config'
import { fmt, ha } from '../formato'
import { useTerritorio } from '../territorio'
import { CajaModal } from './GrupoFiltro'

/**
 * Los dos controles del panel que NO son una dimensión temática: el territorio
 * y el mapa base. Viven aquí y no en PanelLateral porque son listas largas con
 * su propia lógica, y ese archivo ya es el índice del panel.
 *
 * Los dos usan `CajaModal`, así que heredan el anclaje a la izquierda, el foco
 * atrapado, Escape y el pie con «Listo». Y los dos dibujan sus opciones con las
 * mismas clases que las dimensiones —`.gf-lista`, `.gf-opcion`, `.gf-etq`,
 * `.gf-cifra`—: no es ahorro de CSS, es que se leen y se manejan igual, que era
 * justamente lo que no pasaba cuando eran <select>.
 *
 * La diferencia real con una dimensión temática es que aquí la selección es
 * ÚNICA, y por eso son `radio` y no `checkbox`. Un radio anuncia «1 de 16» al
 * lector de pantalla y se recorre con las flechas; un checkbox prometería que se
 * pueden marcar dos regiones a la vez, que no se puede.
 */

/** Una opción de selección única, con la misma pinta que una clase temática. */
function Opcion({ nombre, marcada, onElegir, etiqueta, sub, cifra, vacia }) {
  return (
    <li>
      <label className={vacia ? 'gf-opcion vacia' : 'gf-opcion'}>
        <input type="radio" name={nombre} checked={marcada} onChange={onElegir} />
        <span className="gf-etq">
          {etiqueta}
          {sub && <em className="gf-sub">{sub}</em>}
        </span>
        <span className="gf-cifra">{cifra}</span>
      </label>
    </li>
  )
}

/**
 * El modal del territorio: Región › Provincia › Comuna, los tres niveles a la
 * vez y encadenados.
 *
 * UN SOLO BOTÓN Y UN SOLO MODAL para los tres niveles, y no tres botones. Con
 * tres, dos de ellos quedarían deshabilitados mientras no hubiera región
 * elegida: dos controles fantasma ocupando sitio para no hacer nada. Aquí los
 * niveles inferiores simplemente no existen hasta que tienen sentido, que es lo
 * mismo que hacían los <select> que había antes.
 */
export function ModalTerritorio({ manifest, marginales, ambito, onAmbito, onCerrar }) {
  const { regiones, provincias, comunas } = useTerritorio(manifest, marginales, ambito)
  const hayAmbito = Boolean(ambito.region)

  return (
    <CajaModal
      titulo="Territorio"
      cuenta={
        hayAmbito
          ? `${regiones.length} regiones con datos`
          : `${regiones.length} regiones · sin recorte`
      }
      etiquetaCerrar="Cerrar territorio"
      onCerrar={onCerrar}
      pie={
        hayAmbito ? (
          <button
            type="button"
            className="limpiar"
            onClick={() => onAmbito({ region: null, provincia: null, comuna: null })}
          >
            Volver a todo Chile
          </button>
        ) : null
      }
    >
      {/* El año del catastro va pegado a cada región y no en una nota general:
          es el dato que hace que dos cifras regionales no sean comparables sin
          más, y leerlo al elegir es cuando importa. */}
      <p className="nota">
        Cada región se catastró en un año distinto. El año va junto a su nombre, y las cifras de
        dos regiones no son de la misma fecha.
      </p>

      <div className="mf-nivel">
        <h3>Región</h3>
        <ul className="gf-lista">
          <Opcion
            nombre="territorio-region"
            marcada={!ambito.region}
            onElegir={() => onAmbito({ region: null, provincia: null, comuna: null })}
            etiqueta="Todo Chile"
            cifra=""
          />
          {regiones.map((r) => (
            <Opcion
              key={r.cod}
              nombre="territorio-region"
              marcada={ambito.region === r.cod}
              onElegir={() => onAmbito({ region: r.cod, provincia: null, comuna: null })}
              etiqueta={r.nombre}
              sub={`Catastro ${r.anio}`}
              cifra={r.n ? ha(r.ha) : '—'}
              vacia={!r.n}
            />
          ))}
        </ul>
      </div>

      {hayAmbito && provincias.length > 0 && (
        <div className="mf-nivel">
          <h3>Provincia</h3>
          <ul className="gf-lista">
            <Opcion
              nombre="territorio-provincia"
              marcada={!ambito.provincia}
              onElegir={() => onAmbito({ ...ambito, provincia: null, comuna: null })}
              etiqueta="Todas"
              cifra=""
            />
            {provincias.map((p) => (
              <Opcion
                key={p.nombre}
                nombre="territorio-provincia"
                marcada={ambito.provincia === p.nombre}
                onElegir={() => onAmbito({ ...ambito, provincia: p.nombre, comuna: null })}
                etiqueta={p.nombre}
                cifra={p.n ? ha(p.ha) : '—'}
                vacia={!p.n}
              />
            ))}
          </ul>
        </div>
      )}

      {hayAmbito && comunas.length > 0 && (
        <div className="mf-nivel">
          <h3>Comuna</h3>
          <ul className="gf-lista">
            <Opcion
              nombre="territorio-comuna"
              marcada={!ambito.comuna}
              onElegir={() => onAmbito({ ...ambito, comuna: null })}
              etiqueta="Todas"
              cifra=""
            />
            {comunas.map((c) => (
              <Opcion
                key={c.cod}
                nombre="territorio-comuna"
                marcada={ambito.comuna === c.cod}
                onElegir={() => onAmbito({ ...ambito, comuna: c.cod })}
                etiqueta={c.etiqueta}
                sub={`${fmt.format(c.n)} polígonos`}
                cifra={c.n ? ha(c.ha) : '—'}
                vacia={!c.n}
              />
            ))}
          </ul>
        </div>
      )}
    </CajaModal>
  )
}

/**
 * El modal del mapa base.
 *
 * CADA FILA ENSEÑA SU ADVERTENCIA, no sólo la de la capa activa. Con un
 * <select> la nota de Sentinel-2 —que no es un mosaico continuo y tiene huecos
 * de nube— aparecía DESPUÉS de haberla elegido; aquí se lee antes, que es
 * cuando sirve para no elegirla.
 *
 * LA CLAVE NO SE RENOMBRA aunque sea también el texto que se ve: `urlState.js`
 * usa 'Claro' como centinela del valor por defecto, así que cambiarla
 * invalidaría en silencio todos los enlaces ya compartidos.
 */
export function ModalMapaBase({ base, onBase, onCerrar }) {
  const claves = Object.keys(BASEMAPS)
  return (
    <CajaModal
      titulo="Mapa base"
      cuenta={`${claves.length} fondos disponibles`}
      etiquetaCerrar="Cerrar mapa base"
      onCerrar={onCerrar}
    >
      <p className="nota">
        El fondo no cambia ninguna cifra: sólo la imagen sobre la que se dibujan los polígonos.
      </p>
      <ul className="gf-lista">
        {claves.map((k) => (
          <li key={k}>
            <label className="gf-opcion">
              <input
                type="radio"
                name="mapa-base"
                checked={base === k}
                onChange={() => onBase(k)}
              />
              <span className="gf-etq">
                {k}
                {BASEMAPS[k].nota && <em className="gf-sub">{BASEMAPS[k].nota}</em>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </CajaModal>
  )
}
