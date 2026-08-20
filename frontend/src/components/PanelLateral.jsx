import { useEffect, useMemo, useRef, useState } from 'react'
import { AVISO_PUNTOS, BASEMAPS, COLOR_USO } from '../config'
import { fmt, ha, haExacta } from '../formato'

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
  abierto,
  onCerrar,
  oscuro,
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
  const paleta = COLOR_USO[oscuro ? 'oscuro' : 'claro']

  const compartir = async () => {
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
        <p className="nota">El enlace guarda el ámbito, las clases activas y el mapa base.</p>
        <span className="aviso-copia" aria-live="polite">{aviso}</span>
      </section>

      <section>
        <h2>Clases de uso</h2>
        <p className="nota">
          Pulsa una clase para aislarla en el mapa. El color no es la única marca: el nombre y la
          superficie van escritos al lado.
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
        <p className="procedencia">
          Publica: CONAF · Unidad de Información y Análisis
        </p>
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
