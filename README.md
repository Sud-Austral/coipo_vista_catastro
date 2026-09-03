# coipo_vista_catastro

## Stack técnico

- Frontend: React, Vite, Node.js, Leaflet
- Backend: Python (ETL y procesamiento de datos)
- Lenguajes: JavaScript, Python, Markdown, JSON, HTML, YAML, CSS
- Librerías: NumPy, Pandas

## Estructura del proyecto

- `frontend/`: Aplicación principal (71 archivos)
  - `src/`: Código fuente React
  - `package.json`: Dependencias y scripts
  - `vite.config.js`: Configuración de Vite
- `INSUMO_GRAFICO/`: Insumos gráficos (32 archivos)
- `spike/`: Código experimental (7 archivos)
- `ETL/`: Scripts de procesamiento (26 archivos)
- `.github/workflows/`: Flujos de GitHub (3 archivos)
  - `deploy.yml`: Despliegue
  - `readme.yml`: Actualización README
  - `update-readme.yml`: Actualización README
- `data/`: Datos del proyecto
- `notebooks/`: Notebooks de Jupyter
- `scripts/`: Scripts auxiliares
- `INSUMO/`: Insumos adicionales

## API

Endpoints consumidos:

- `${DATA}/simef.json`: Datos del sistema SIMEF
- `${DATA}/oficiales.json`: Datos oficiales
- `${SERVICIO}?${q}`: Servicio para fechas de imágenes (con parámetro `q`)

## Configuración

Variable de entorno utilizada:

- `BASE_URL`: URL base de la aplicación

## Despliegue

Flujos de GitHub Actions para despliegue y actualización automática del README.
