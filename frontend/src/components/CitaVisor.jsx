/**
 * Cómo citar el visor. Salió de la Metodología porque ahora la usan también las
 * páginas estáticas por región y comuna: dos redacciones de una cita divergen a la
 * primera corrección.
 *
 * `consultado` es la fecha de consulta. En el navegador es hoy; en el HTML horneado
 * al construir llega null y la frase se omite: una fecha de construcción escrita
 * como «Consultado el…» sería falsa desde el día siguiente, y además haría que dos
 * construcciones del mismo commit dieran bytes distintos.
 */
export default function CitaVisor({ sha256, consultado }) {
  return (
    <p className="cita">
      CONAF. <em>Visor del Catastro de Usos de la Tierra y Recursos Vegetacionales</em>.
      Unidad de Información y Análisis para la Gerencia de Fiscalización Forestal y
      Evaluación Ambiental. Datos <code>sha256 {sha256.slice(0, 16)}…</code>.
      {consultado && <>{' '}Consultado el {consultado}.</>}
    </p>
  )
}
