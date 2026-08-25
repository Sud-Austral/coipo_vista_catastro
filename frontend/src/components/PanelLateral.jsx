import { useEffect, useMemo, useRef, useState } from 'react'
import { AVISO_PUNTOS, BASEMAPS, COLOR_USO } from '../config'
import { fmt, ha, haExacta } from '../formato'
import { flush } from '../urlState'
import { FILTROS, NINGUNO, cuentaSeleccion } from '../filtros'
import GrupoFiltro from './GrupoFiltro'

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
 * Orden de las secciones, y no es casual: ÁMBITO primero. Es lo primero que
 * busca cualquiera que abre el visor —«¿y mi región?»—, y ponerlo debajo de la
 * leyenda lo deja media pantalla más abajo en un panel de 320 px que ya scrollea.
 *
 * NADA está hardcodeado: las regiones, provincias, comunas y clases salen del
 * manifest con sus cifras. Si el ETL cambia el vocabulario, esto cambia solo.
 */
export default function PanelLateral({
  manifest,
  resumen,
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

  const regiones = manifest?.regiones ?? []

  // Las provincias y comunas salen de las comunas del manifest, filtradas por
  // lo que ya se eligió. Las regiones van en orden geográfico norte-sur, que es
  // como se piensa Chile; provincias y comunas, alfabético.
  const provincias = useMemo(() => {
    if (!ambito.region || !manifest) return []
    const set = new Map()
    for (const c of manifest.comunas) {
      if (c.region === ambito.region && c.n > 0) set.set(c.provincia, true)
    }
    return [...set.keys()].sort((a, b) => a.localeCompare(b, 'es'))
  }, [manifest, ambito.region])

  const comunas = useMemo(() => {
    if (!ambito.region || !manifest) return []
    return manifest.comunas
      .filter((c) => c.region === ambito.region && c.n > 0)
      .filter((c) => !ambito.provincia || c.provincia === ambito.provincia)
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'))
  }, [manifest, ambito.region, ambito.provincia])

  const hayAmbito = Boolean(ambito.region)
  const activas = cuentaSeleccion(filtros)
  const paleta = COLOR_USO[oscuro ? 'oscuro' : 'claro']

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
        <label className="campo">
          <span>Región</span>
          <select
            value={ambito.region ?? ''}
            onChange={(e) => onAmbito({ region: e.target.value || null, provincia: null, comuna: null })}
          >
            <option value="">Todo Chile</option>
            {regiones.map((r) => (
              <option key={r.cod} value={r.cod}>
                {r.nombre} · {r.anio}
              </option>
            ))}
          </select>
        </label>

        {hayAmbito && provincias.length > 0 && (
          <label className="campo">
            <span>Provincia</span>
            <select
              value={ambito.provincia ?? ''}
              onChange={(e) => onAmbito({ ...ambito, provincia: e.target.value || null, comuna: null })}
            >
              <option value="">Todas</option>
              {provincias.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
        )}

        {hayAmbito && comunas.length > 0 && (
          <label className="campo">
            <span>Comuna</span>
            <select
              value={ambito.comuna ?? ''}
              onChange={(e) => onAmbito({ ...ambito, comuna: e.target.value || null })}
            >
              <option value="">Todas</option>
              {comunas.map((c) => (
                <option key={c.cod} value={c.cod}>
                  {c.etiqueta} ({fmt.format(c.n)})
                </option>
              ))}
            </select>
          </label>
        )}

        {hayAmbito && (
          <button type="button" className="limpiar"
                  onClick={() => onAmbito({ region: null, provincia: null, comuna: null })}>
            Volver a todo Chile
          </button>
        )}
      </section>

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

      <section>
        <h2>Clases de uso</h2>
        <p className="nota">
          Pulsa una clase para aislarla en el mapa. El color no es la única marca: el nombre y la
          superficie van escritos al lado.
        </p>
        {/* «CRECE CON», nunca «es proporcional a». Con el radio acotado por
            arriba y por abajo no hay proporcionalidad, y el rango real del dato
            va de 0,1 ha a 1.295.122 ha: ninguna escala proporcional cabe en unos
            pocos píxeles. Decirlo mal en la única línea permanente sería el
            rigor fallando dentro del mecanismo que existe para protegerlo. */}
        <p className="nota">
          El tamaño del punto <strong>crece con</strong> la superficie del polígono, con un mínimo
          y un máximo para que siga siendo visible y se pueda pulsar. No es proporcional.
        </p>
        <ul className="leyenda">
          {(resumen?.usos ?? []).map((u) => {
            const i = manifest.usos.findIndex((x) => x.cod === u.cod)
            const activa = usosActivos.size === 0 || usosActivos.has(i)
            return (
              <li key={u.cod}>
                <button
                  type="button"
                  className={activa ? 'clase' : 'clase apagada'}
                  aria-pressed={usosActivos.has(i)}
                  onClick={() => onUso(i)}
                  title={`${u.etiqueta}: ${haExacta(u.ha)}`}
                >
                  <span className="chip" style={{ background: paleta[u.cod] }} />
                  <span className="nombre">{u.etiqueta}</span>
                  <span className="cifra">{ha(u.ha)}</span>
                </button>
              </li>
            )
          })}
        </ul>
        {usosActivos.size > 0 && (
          <button type="button" className="limpiar" onClick={onLimpiarUsos}>
            Ver todas las clases
          </button>
        )}
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
        {/* La clase de uso NO se repite aquí. Es la única dimensión con color
            propio, así que su control es la leyenda: tenerla en dos sitios
            obligaría a mantener dos estados sincronizados de lo mismo. */}
        <p className="nota">La clase de uso se filtra desde la leyenda de arriba.</p>

        {FILTROS.filter((d) => d.col !== 'uso').map((def) => (
          <GrupoFiltro
            key={def.col}
            def={def}
            manifest={manifest}
            resumen={resumen}
            seleccion={filtros[def.col] ?? NINGUNO}
            sinDato={resumen?.sinDato?.[SIN_DATO[def.col]] ?? 0}
            onAlternar={onFiltro}
            onLimpiar={onLimpiarFiltro}
          />
        ))}

        {activas > 0 && (
          <button type="button" className="limpiar" onClick={onLimpiarFiltros}>
            Quitar los {activas} filtros
          </button>
        )}
      </section>

      <section>
        <h2>Mapa base</h2>
        <label className="campo">
          <span>Imagen de fondo</span>
          <select value={base} onChange={(e) => onBase(e.target.value)}>
            {Object.keys(BASEMAPS).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        {base === 'Sentinel-2' && (
          <p className="nota">
            Compuesto anual sin nubes a 10 m, no la última pasada del satélite. Licencia
            CC BY-NC-SA 4.0 (no comercial).
          </p>
        )}
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
    </aside>
  )
}
