# PROJECT EVIDENCE CONTEXT
PROJECT=target
FILES=154
GENERATED=2026-09-03T13:17:32.104700

## EVIDENCE_POLICY

This context contains repository evidence.
Signals are not guaranteed business features.
Do not infer unsupported functionality.
Prefer explicit files, dependencies and source evidence.
If evidence is insufficient, omit the claim.

## STACK
LANG=React,Python,JavaScript,Markdown,JSON,HTML,YAML,CSS
TECH=Django[medium],Leaflet[high],Mapbox[medium],Node.js[high],NumPy[high],Pandas[high],React[high],Vite[high],Vue[medium]

## STRUCTURE
ROOTS=frontend(71),INSUMO_GRAFICO(32),ETL(26),spike(7),readme_context(3),INSUMO(3),.github(2),README_CANDIDATE.md(1),CLAUDE.md(1),.gitignore(1),.gitattributes(1),README.md(1),mejoras.md(1),DECISIONES.md(1),data(1),notebooks(1),scripts(1)

## KEY_FILES
frontend/package.json,INSUMO_GRAFICO/README.md,README.md,frontend/README.md,frontend/package-lock.json,.github/workflows/deploy.yml,frontend/vite.config.js,.github/workflows/readme.yml,frontend/src/config.js

## API_EVIDENCE
FETCH ${DATA}/simef.json [frontend/src/App.jsx:129]
FETCH ${DATA}/oficiales.json [frontend/src/App.jsx:133]
FETCH ${SERVICIO}?${q} [frontend/src/hooks/useFechaImagen.js:80]

## ENV_EVIDENCE
BASE_URL [frontend/vite.config.js:7]

## CAPABILITY_SIGNALS
Autenticación [confidence=medium]
  token [mejoras.md:419]
  login [INSUMO_GRAFICO/README.md:37]
  token [INSUMO_GRAFICO/README.md:10]
  login [INSUMO_GRAFICO/implementacion_banner.md:331]
  token [INSUMO_GRAFICO/implementacion_banner.md:255]
  login [readme_context/README_CONTEXT_ULTRA.md:35]
  jwt [readme_context/README_CONTEXT_ULTRA.md:41]
  token [readme_context/README_CONTEXT_ULTRA.md:34]
Mapas / cartografía [confidence=medium]
  leaflet [README_CANDIDATE.md:5]
  leaflet [CLAUDE.md:45]
  mapa [CLAUDE.md:13]
  leaflet [README.md:5]
  leaflet [mejoras.md:36]
  mapa [mejoras.md:4]
  leaflet [DECISIONES.md:302]
  mapa [DECISIONES.md:150]
Exportación [confidence=medium]
  csv [CLAUDE.md:63]
  xlsx [CLAUDE.md:63]
  export [mejoras.md:121]
  exportar [mejoras.md:370]
  csv [mejoras.md:85]
  excel [mejoras.md:86]
  export [DECISIONES.md:295]
  exportar [DECISIONES.md:295]
Carga de archivos [confidence=medium]
  archivo [README_CANDIDATE.md:12]
  archivo [CLAUDE.md:58]
  document [CLAUDE.md:21]
  archivo [README.md:12]
  archivo [mejoras.md:89]
  file [mejoras.md:356]
  document [mejoras.md:10]
  archivo [DECISIONES.md:396]
Reportes / analítica [confidence=medium]
  report [CLAUDE.md:15]
  reporte [CLAUDE.md:15]
  report [DECISIONES.md:267]
  reporte [DECISIONES.md:267]
  report [ETL/build_bin.py:946]
  reporte [ETL/build_bin.py:946]
  estadistica [ETL/cifras_oficiales.py:95]
  estadistica [ETL/verificar_datos.py:228]
Procesamiento de datos [confidence=medium]
  pandas [README_CANDIDATE.md:8]
  numpy [README_CANDIDATE.md:8]
  etl [README_CANDIDATE.md:6]
  numpy [CLAUDE.md:98]
  etl [CLAUDE.md:24]
  pandas [README.md:8]
  numpy [README.md:8]
  etl [README.md:6]

## PYTHON
ETL/build_bin.py|F=sha256,indexar,canon,etiqueta_mayoritaria,orden_altura,codificar,agregados,construir,main,por_codigo,dominio|I=argparse,hashlib,json,math,os,re,sys,unicodedata,duckdb,scipy.spatial,homologacion,numpy
ETL/cifras_oficiales.py|F=canon,numero,plantacion_por_especie,construir,main,es_especie|I=argparse,json,os,re,sys,unicodedata,duckdb
ETL/build_simef.py|F=sigla_a_anio,construir,main|I=argparse,hashlib,json,os,re,sys,duckdb,build_bin
ETL/leer_bin.py|F=leer_manifest,_categoria,_levantar,cargar,es,resumen,main|I=argparse,hashlib,json,os,sys,numpy,pandas
ETL/verificar_datos.py|F=TOL_TABLA,_canon,sha256,suma_ha,comprobar,leer_oficiales,leer,_cap,_off,_uso,_sub,_permutar_cobertura,_especie_cero,_altura_desordenada,_quitar_clase,_sin_dato,_sin_clase_na,_tramo_imposible|I=argparse,copy,hashlib,json,os,re,sys,unicodedata,numpy,scipy.spatial
ETL/analisis_codigos.py|F=canon,cargar_oficial,comparar,bloque,informe,_semantico,analizar_cbn,analizar_simef,analizar_conjuntos,main|I=argparse,os,re,sys,unicodedata,collections,duckdb
ETL/homologacion/__init__.py|F=_leer,_adiciones,tabla,mapa,exigir|I=csv,os
ETL/homologacion/desde_xlsx.py|F=exportar,main|I=csv,os,sys,openpyxl
spike/diag.py|F=main|I=json,os,shutil,sys,time,requests,medir
spike/medir.py|C=Cdp|F=servir,lanzar_chrome,contar_pixeles,main,_ms,_f,__init__,enviar,evaluar,cerrar|I=argparse,functools,http.server,json,os,shutil,socketserver,subprocess,sys,tempfile,threading,time
spike/gen_bin.py|F=main|I=json,os,sys,time,duckdb,numpy
scripts/update_readme.py|F=run_model,clean_response,main|I=argparse,subprocess,pathlib
frontend/verificacion/mutaciones-visor.py|C=Manejador|F=compilar,construir_datos,abrir,ir,sonda_botones,sonda_anclaje,sonda_uso,sonda_territorio,sonda_base,sonda_radio,_abrir_ficha,sonda_enlaces,sonda_ficha_correcta,sonda_tolerancia,sonda_ancho,sonda_datos,sonda_regiones,sonda_ambito_vacio|I=argparse,functools,http.server,json,math,os,re,unicodedata,shutil,socketserver,subprocess,sys
frontend/verificacion/verificar.py|C=Manejador|F=servir,esperar,abrir_grupo,cerrar_grupo,grupo_filtro,marcar_clase,leer_fila,clic,pulsar_enter,enfocar_mapa,metros_por_pixel,columnas,puntos_bajo_el_clic,regiones_ofrecidas,diametro_del_disco,punto_aislado,punto_con_hueco,coord_de_la_ficha|I=argparse,base64,functools,http.server,json,math,os,re,shutil,socketserver,sys,threading
frontend/verificacion/mutaciones.py|F=main|I=os,shutil,subprocess,sys,tempfile

## COMPONENTS
frontend/src/urlState.js:PARAMS_FILTRO,RESERVADAS
frontend/src/indicadores.js:DIMENSIONES,SIN_DATO_POR_COL
frontend/src/filtros.js:NINGUNO,FILTROS,TOPE_LISTA
frontend/src/App.jsx:MAX_ZOOM_ENCUADRE,PADDING_ENCUADRE,HOLGURA_ENCUADRE,App
frontend/src/descargas.js:SEP,BOM
frontend/src/config.js:DATA,VISTA_INICIAL,LIMITES,CORTE_KPI,CORTE_PANEL,MIN_PANEL,MAX_PANEL,ANCHO_PANEL,ANCHO_KPI,MAX_KPI,MIN_MAPA,DIACRITICOS,BASEMAPS,COLOR_USO,AVISO_PUNTOS
frontend/src/preferencias.js:CLAVE,POR_OMISION
frontend/src/datos/binario.js:CONSTRUCTOR,ANCHO
frontend/src/datos/derivadas.js:DERIVADAS
frontend/src/hooks/useFechaImagen.js:SERVICIO
frontend/src/mapa/CapaPuntos.jsx:CapaPuntos
frontend/src/components/GrupoFiltro.jsx:BotonControl,CajaModal,BotonFiltro,ModalFiltro
frontend/src/components/Reporte.jsx:Donut,C,Tabla,Reporte
frontend/src/components/SeccionDescargas.jsx:TOPE_GEOJSON,SeccionDescargas,SEP
frontend/src/components/ModalFicha.jsx:ModalFicha
frontend/src/components/PanelLateral.jsx:SIN_DATO,PanelLateral
frontend/src/components/Tirador.jsx:PASO,PASO_GRANDE,Tirador
frontend/src/components/graficos.jsx:W,BarraFila,Elemento,Cifra,Composicion,Columnas,EJE,TECHO,TablaKpi,Advertencia,IconoIndicadores,BarraApilada,Discontinuidad
frontend/src/components/PanelIndicadores.jsx:PanelIndicadores,Seccion,SeccionSimef,SeccionAnios
frontend/src/components/PaginaMetodologia.jsx:CuerpoMetodologia
frontend/src/components/EtiquetaImagen.jsx:EtiquetaImagen
frontend/src/components/CartelContexto.jsx:CartelContexto
frontend/src/components/ModalesPanel.jsx:ModalInformacion,ModalDescargas,ModalCompartir
frontend/src/components/ControlesPanel.jsx:Opcion,ModalTerritorio,ModalMapaBase
frontend/src/components/Banner.jsx:Banner

## EXISTING_README
# coipo_vista_catastro
## Stack técnico
- Frontend: React, Vite, Node.js, Leaflet
- Backend: Python (ETL y procesamiento de datos)
- Lenguajes: JavaScript, Python, Markdown, JSON, HTML, YAML, CSS
- Librerías: NumPy, Pandas
## Estructura del proyecto
- `frontend/`: Aplicación principal (68 archivos)
- `src/`: Código fuente React
- `package.json`: Dependencias y scripts
- `vite.config.js`: Configuración de Vite
- `INSUMO_GRAFICO/`: Insumos gráficos (32 archivos)
- `spike/`: Código experimental (7 archivos)
- `ETL/`: Scripts de procesamiento (6 archivos)
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

## DEPLOYMENT_FILES
.github/workflows/deploy.yml,.github/workflows/readme.yml

## README_RULES

Generate README.md only from repository evidence.
Do not invent features.
Do not invent technologies.
Do not invent endpoints.
Do not invent database tables.
Do not invent environment variables.
Do not invent commands.
Do not infer production architecture from filenames alone.
Treat capability signals as signals, not confirmed features.
Prefer explicit source evidence.
Omit unsupported sections.