import { useMemo } from 'react'

/**
 * Las tres listas del territorio, aparte de los componentes que las dibujan.
 *
 * Vive en su propio módulo porque lo usan DOS: el botón de Territorio necesita
 * saber cuántas regiones quedan y su modal necesita las tres listas. Calcularlo
 * dos veces daría dos respuestas distintas el día que una de las dos se quede
 * sin actualizar.
 */
/**
 * El territorio va en cascada como todo lo demás: sólo se ofrece lo que tiene
 * algo bajo los filtros activos. Las cifras salen del marginal de la columna
 * `comuna`, que por construcción ignora el filtro del propio ámbito — si no,
 * elegir una región dejaría la lista con esa única región dentro.
 *
 * LO ELEGIDO NO SE OCULTA NUNCA, aunque su marginal caiga a cero: una selección
 * que no está entre las opciones deja el mapa recortado por un ámbito que no se
 * ve en ninguna parte.
 */
export function useTerritorio(manifest, marginales, ambito) {
  const comunasVivas = useMemo(() => marginales?.comunas ?? [], [marginales])

  const regiones = useMemo(() => {
    const todas = manifest?.regiones ?? []
    const vivas = new Map((marginales?.regiones ?? []).map((r) => [r.cod, r]))
    return todas
      .filter((r) => vivas.has(r.cod) || r.cod === ambito.region)
      .map((r) => ({ ...r, ...(vivas.get(r.cod) ?? { n: 0, ha: 0 }) }))
  }, [manifest, marginales, ambito.region])

  // Las regiones van en orden geográfico norte-sur, que es como se piensa
  // Chile; provincias y comunas, alfabético.
  const provincias = useMemo(() => {
    if (!ambito.region) return []
    const acc = new Map()
    comunasVivas
      .filter((c) => c.region === ambito.region)
      .forEach((c) => {
        const p = acc.get(c.provincia) ?? { nombre: c.provincia, n: 0, ha: 0 }
        p.n += c.n
        p.ha += c.ha
        acc.set(c.provincia, p)
      })
    if (ambito.provincia && !acc.has(ambito.provincia)) {
      acc.set(ambito.provincia, { nombre: ambito.provincia, n: 0, ha: 0 })
    }
    return [...acc.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [comunasVivas, ambito.region, ambito.provincia])

  const comunas = useMemo(() => {
    if (!ambito.region || !manifest) return []
    const vivas = comunasVivas
      .filter((c) => c.region === ambito.region)
      .filter((c) => !ambito.provincia || c.provincia === ambito.provincia)
    if (ambito.comuna && !vivas.some((c) => c.cod === ambito.comuna)) {
      const elegida = manifest.comunas.find((c) => c.cod === ambito.comuna)
      if (elegida) vivas.push({ ...elegida, n: 0, ha: 0 })
    }
    return [...vivas].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'))
  }, [manifest, comunasVivas, ambito.region, ambito.provincia, ambito.comuna])

  return { regiones, provincias, comunas }
}
