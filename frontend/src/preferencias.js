// Disposicion de los paneles, recordada entre visitas.
//
// ESTO ESTRENA ALMACENAMIENTO EN EL VISOR, y hasta ahora la regla era no tener
// ninguno. La excepcion esta acotada a proposito y conviene que siga acotada:
//
//   SE GUARDA   el ancho de cada panel y si cada barra esta plegada.
//               Dos numeros y dos booleanos sobre la forma de una ventana.
//   NO SE GUARDA nada del visitante: ni identificador, ni sesion, ni que filtros
//               consulto, ni cuando vino, ni telemetria de ninguna clase. Lo
//               que se analiza (filtros, capas, encuadre) sigue viviendo SOLO en
//               la URL, que es visible, editable y compartible por quien la usa.
//
// El motivo de la excepcion: sin ella, cada F5 devuelve el panel a 320 px y
// vuelve a desplegar las dos barras, y quien trabaja con el visor todos los dias
// tiene que recolocarlo cada vez. Recordar la geometria de una ventana no es
// saber nada de nadie.
//
// La frontera no se defiende sola. La asercion B17 comprueba que la clave
// contenga EXACTAMENTE estos cuatro campos, para que nadie le cuelgue mas
// adelante un filtro, una marca de tiempo o un contador de visitas sin darse
// cuenta. Si añades un campo LEGITIMO de geometria, actualiza B17 en el mismo
// commit: que la asercion falle es el mecanismo, no un estorbo.
//
// Ver tambien el comentario del cartel de contexto en App.jsx: aquel aviso
// SIGUE sin recordarse, y esa decision no cambia.

import { ANCHO_KPI, ANCHO_PANEL, MAX_KPI, MAX_PANEL, MIN_PANEL } from './config'

const CLAVE = 'coipo.disposicion'

export const POR_OMISION = { ancho: ANCHO_PANEL, anchoKpi: ANCHO_KPI, panel: true, kpi: true }

const acotar = (n, min, max) => Math.min(max, Math.max(min, n))

/**
 * El acceso va envuelto en try/catch y no por superticion: en Safari con
 * navegacion privada, y con el almacenamiento bloqueado por politica de sitio,
 * LEER `window.localStorage` ya lanza -- no hace falta llamar a getItem. Sin la
 * guarda, el visor entero se caeria antes del primer render por no poder
 * recordar un ancho de panel.
 */
function almacen() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Devuelve SIEMPRE una disposicion valida. Cualquier entrada corrupta, de otra
 * version o manipulada a mano cae en los valores por omision en vez de propagar
 * un NaN a `grid-template-columns`, que dejaria la rejilla sin pista izquierda y
 * sin forma de recuperarla salvo borrando el almacenamiento.
 */
export function leerDisposicion() {
  const a = almacen()
  if (!a) return { ...POR_OMISION }
  let crudo
  try {
    crudo = JSON.parse(a.getItem(CLAVE) ?? 'null')
  } catch {
    return { ...POR_OMISION }
  }
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return { ...POR_OMISION }
  const n = Number(crudo.ancho)
  const nk = Number(crudo.anchoKpi)
  return {
    ancho: Number.isFinite(n) ? acotar(Math.round(n), MIN_PANEL, MAX_PANEL) : POR_OMISION.ancho,
    anchoKpi: Number.isFinite(nk) ? acotar(Math.round(nk), ANCHO_KPI, MAX_KPI) : POR_OMISION.anchoKpi,
    // Estricto y no `!!`: un "sí" de una version futura no debe colar como true
    // silenciosamente. Si no es booleano, es que no lo escribimos nosotros.
    panel: typeof crudo.panel === 'boolean' ? crudo.panel : POR_OMISION.panel,
    kpi: typeof crudo.kpi === 'boolean' ? crudo.kpi : POR_OMISION.kpi,
  }
}

/**
 * Escribe los tres campos y nada mas. Se construye el objeto explicitamente en
 * vez de volcar lo que llegue: asi un `{...estado}` descuidado en la llamada no
 * puede filtrar al almacenamiento algo que no toca.
 */
export function guardarDisposicion({ ancho, anchoKpi, panel, kpi }) {
  const a = almacen()
  if (!a) return
  try {
    a.setItem(
      CLAVE,
      JSON.stringify({ ancho: Math.round(ancho), anchoKpi: Math.round(anchoKpi), panel: !!panel, kpi: !!kpi }),
    )
  } catch {
    /* cuota llena o almacenamiento denegado: la sesion sigue, solo no se recuerda */
  }
}
