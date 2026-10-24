# coipo_vista_catastro — Visor del Catastro de Usos de la Tierra y Recursos Vegetacionales

Visor público y estático del catastro de CONAF: un mapa con los centroides de **1.827.933 polígonos** (cifra de `CLAUDE.md`, medida el 2026-09-02 y vigente a su fecha), 23 controles de filtro,
panel de indicadores, descargas, un reporte imprimible y páginas por región y comuna. Lo desarrolla la Unidad de Información y Análisis (UIA), para la Gerencia de Fiscalización Forestal y Evaluación Ambiental
(`frontend/src/web/sitio.js`).

Publicado en GitHub Pages: <https://sud-austral.github.io/coipo_vista_catastro/> (`URL_PUBLICA` en `frontend/src/web/sitio.js`).

**No tiene backend, y es deliberado**: los datos viajan en un binario columnar (`frontend/public/datos/cbn_puntos.bin`, 49,4 MB según `CLAUDE.md`) que se versiona; todo el cálculo ocurre en el navegador.

## Qué hay

| Parte | Dónde |
|---|---|
| Aplicación React + Vite, mapa con deck.gl sobre Leaflet | `frontend/src/` |
| Páginas por región y comuna, sitemap, tarjetas PNG de vista previa | `frontend/src/web/`, `frontend/scripts/` |
| ETL que genera los datos publicados (DuckDB -> binario + manifest) | `ETL/` (`build_bin.py`, `build_simef.py`, `cifras_oficiales.py`, `verificar_datos.py`) |
| Tablas de homologación de códigos (16 más listas de no fusionar y por revisar) | `ETL/homologacion/` |
| Arnés de verificación en navegador y mutadores | `frontend/verificacion/` |
| Manual para enviar fuera del equipo (PDF + fuente LaTeX) | `documentacion/` |
| Insumos de origen y gráficos institucionales | `INSUMO/`, `INSUMO_GRAFICO/` |

## Cómo ejecutarlo

```bash
cd frontend
npm install
npm run dev            # servidor de desarrollo
npm run lint           # oxlint
npm run build          # vite build + portada horneada + validación de HTML
npm run build:web      # páginas por región/comuna y sitemap (después de build; exige historia git completa)
npm run prueba         # node --test verificacion/*.test.mjs
npm run verify:cascada # oráculo del cruce de filtros
```

Regenerar los datos necesita `data/catastro_gef_singeometria.duckdb` (300 MB, **no se versiona**): `python ETL/build_bin.py` y luego `python ETL/verificar_datos.py --negativas`.
Las tarjetas PNG: `pip install -r frontend/scripts/requirements.txt` (Pillow fijado) y `python scripts/tarjetas.py`. El arnés de navegador (`python frontend/verificacion/verificar.py`) necesita Chrome.
La lista completa de comandos y sus trampas está en [`CLAUDE.md`](CLAUDE.md), sección 3. En esta revisión de documentación **no ejecuté** ninguno.

## Configuración

No hay variables de entorno ni secretos. La ruta base de publicación (`/coipo_vista_catastro/`) se fija a mano en `frontend/vite.config.js` y debe coincidir con `frontend/src/web/sitio.js` y el `--base` del humo en `.github/workflows/deploy.yml`.
Servicios externos consultados desde el navegador: teselas de mapa base y un servicio de fechas de imagen (`frontend/src/hooks/useFechaImagen.js`); la analítica Umami de la flota está prevista pero sin identificador de sitio (`UMAMI.id` vacío en `sitio.js`).

## Despliegue

`.github/workflows/deploy.yml` (único workflow): con cada push a `main` que toque `frontend/**`, `ETL/**`, `docs/robots-raiz.txt` o el propio workflow corre `datos` -> `build` -> `deploy` (GitHub Pages) -> `humo`;
los PR contra `main` corren `datos` y `build` sin publicar. El README ya no lo regenera ningún bot (el workflow que lo hacía se retiró el 2026-09-26).

## Documentación

[`CLAUDE.md`](CLAUDE.md) (guía para agentes) · [`DECISIONES.md`](DECISIONES.md) (por qué los datos son como son) · [`mejoras.md`](mejoras.md) · [`docs/visibilidad.md`](docs/visibilidad.md) ·
[`insumos/00-PROBLEMA.md`](insumos/00-PROBLEMA.md) · [`insumos/01-SOLUCION.md`](insumos/01-SOLUCION.md) · [`documentacion/README.md`](documentacion/README.md).
