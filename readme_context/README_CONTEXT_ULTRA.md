# PROJECT EVIDENCE CONTEXT
PROJECT=target
FILES=125
GENERATED=2026-08-31T00:42:03.218033

## EVIDENCE_POLICY

This context contains repository evidence.
Signals are not guaranteed business features.
Do not infer unsupported functionality.
Prefer explicit files, dependencies and source evidence.
If evidence is insufficient, omit the claim.

## STACK
LANG=React,Python,JavaScript,Markdown,JSON,HTML,YAML,CSS
TECH=Django[low],Leaflet[high],Mapbox[low],Node.js[high],NumPy[medium],Pandas[low],React[high],Vite[high],Vue[low]

## STRUCTURE
ROOTS=frontend(68),INSUMO_GRAFICO(32),spike(7),ETL(6),.github(3),.gitignore(1),.gitattributes(1),README.md(1),mejoras.md(1),DECISIONES.md(1),data(1),notebooks(1),scripts(1),INSUMO(1)

## KEY_FILES
frontend/package.json,INSUMO_GRAFICO/README.md,README.md,frontend/README.md,frontend/package-lock.json,.github/workflows/deploy.yml,frontend/vite.config.js,.github/workflows/readme.yml,.github/workflows/update-readme.yml,frontend/src/config.js

## API_EVIDENCE
FETCH ${DATA}/simef.json [frontend/src/App.jsx:114]
FETCH ${DATA}/oficiales.json [frontend/src/App.jsx:118]
FETCH ${SERVICIO}?${q} [frontend/src/hooks/useFechaImagen.js:80]

## ENV_EVIDENCE
BASE_URL [frontend/vite.config.js:7]

## CAPABILITY_SIGNALS
Autenticación [confidence=medium]
  token [mejoras.md:413]
  login [INSUMO_GRAFICO/README.md:37]
  token [INSUMO_GRAFICO/README.md:10]
  login [INSUMO_GRAFICO/implementacion_banner.md:331]
  token [INSUMO_GRAFICO/implementacion_banner.md:255]
  token [.github/workflows/update-readme.yml:14]
  token [.github/workflows/deploy.yml:21]
  jwt [frontend/package-lock.json:545]
Mapas / cartografía [confidence=medium]
  leaflet [mejoras.md:36]
  mapa [mejoras.md:4]
  mapa [ETL/cifras_oficiales.py:147]
  mapa [ETL/leer_bin.py:121]
  mapa [ETL/verificar_datos.py:96]
  leaflet [spike/spike_leaflet.html:5]
  mapa [spike/spike_leaflet.html:10]
  leaflet [spike/NOTAS.md:151]
Exportación [confidence=medium]
  export [mejoras.md:121]
  exportar [mejoras.md:364]
  csv [mejoras.md:85]
  excel [mejoras.md:86]
  csv [ETL/build_bin.py:124]
  excel [ETL/cifras_oficiales.py:13]
  export [ETL/leer_bin.py:301]
  csv [ETL/leer_bin.py:310]
Carga de archivos [confidence=medium]
  archivo [mejoras.md:89]
  file [mejoras.md:350]
  document [mejoras.md:10]
  document [DECISIONES.md:48]
  archivo [ETL/build_bin.py:568]
  file [ETL/build_bin.py:96]
  document [ETL/build_bin.py:39]
  file [ETL/cifras_oficiales.py:30]
Reportes / analítica [confidence=medium]
  estadistica [ETL/cifras_oficiales.py:95]
  estadistica [ETL/verificar_datos.py:225]
  report [frontend/src/App.css:904]
  reporte [frontend/src/App.css:904]
  report [frontend/src/App.jsx:33]
  reporte [frontend/src/App.jsx:33]
  report [frontend/src/mapa/CapaPuntos.jsx:272]
  report [frontend/src/components/Reporte.jsx:14]
Procesamiento de datos [confidence=medium]
  numpy [mejoras.md:208]
  etl [mejoras.md:21]
  etl [DECISIONES.md:5]
  numpy [ETL/build_bin.py:92]
  etl [ETL/build_bin.py:80]
  etl [ETL/cifras_oficiales.py:3]
  etl [ETL/build_simef.py:19]
  pandas [ETL/leer_bin.py:1]

## PYTHON
ETL/build_bin.py|F=sha256,indexar,canon,etiqueta_mayoritaria,orden_altura,codificar,agregados,construir,main,por_codigo,dominio|I=argparse,hashlib,json,os,re,sys,unicodedata,duckdb,numpy
ETL/cifras_oficiales.py|F=canon,numero,plantacion_por_especie,construir,main,es_especie|I=argparse,json,os,re,sys,unicodedata,duckdb
ETL/build_simef.py|F=sigla_a_anio,construir,main|I=argparse,hashlib,json,os,re,sys,duckdb,build_bin
ETL/leer_bin.py|F=leer_manifest,_categoria,_levantar,cargar,es,resumen,main|I=argparse,hashlib,json,os,sys,numpy,pandas
ETL/verificar_datos.py|F=TOL_TABLA,_canon,sha256,suma_ha,comprobar,leer_oficiales,leer,_cap,_off,_uso,_sub,_permutar_cobertura,_especie_cero,_altura_desordenada,_quitar_clase,_sin_dato,_sin_clase_na,main|I=argparse,copy,hashlib,json,os,re,sys,unicodedata
ETL/analisis_codigos.py|F=canon,cargar_oficial,comparar,bloque,informe,_semantico,analizar_cbn,analizar_simef,analizar_conjuntos,main|I=argparse,os,re,sys,unicodedata,collections,duckdb
spike/diag.py|F=main|I=json,os,shutil,sys,time,requests,medir
spike/medir.py|C=Cdp|F=servir,lanzar_chrome,contar_pixeles,main,_ms,_f,__init__,enviar,evaluar,cerrar|I=argparse,functools,http.server,json,os,shutil,socketserver,subprocess,sys,tempfile,threading,time
spike/gen_bin.py|F=main|I=json,os,sys,time,duckdb,numpy
scripts/update_readme.py|F=run_model,clean_response,main|I=argparse,subprocess,pathlib
frontend/verificacion/mutaciones-visor.py|C=Manejador|F=compilar,abrir,ir,sonda_botones,sonda_anclaje,sonda_uso,sonda_territorio,sonda_base,sonda_radio,_abrir_ficha,sonda_enlaces,sonda_ficha_correcta,sonda_tolerancia,sonda_ancho,sonda_orden,sonda_reporte,sonda_impresion,main|I=argparse,functools,http.server,json,math,os,re,shutil,socketserver,subprocess,sys,tempfile
frontend/verificacion/verificar.py|C=Manejador|F=servir,esperar,abrir_grupo,cerrar_grupo,grupo_filtro,marcar_clase,leer_fila,clic,pulsar_enter,enfocar_mapa,metros_por_pixel,puntos_bajo_el_clic,regiones_ofrecidas,diametro_del_disco,punto_aislado,punto_con_hueco,coord_de_la_ficha,centro_del_mapa|I=argparse,base64,functools,http.server,json,math,os,re,shutil,socketserver,sys,threading
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
frontend/src/hooks/useFechaImagen.js:SERVICIO
frontend/src/mapa/CapaPuntos.jsx:K,CapaPuntos
frontend/src/components/GrupoFiltro.jsx:BotonControl,CajaModal,BotonFiltro,ModalFiltro
frontend/src/components/Reporte.jsx:Donut,C,Tabla,Reporte
frontend/src/components/SeccionDescargas.jsx:TOPE_GEOJSON,SeccionDescargas,SEP
frontend/src/components/ModalFicha.jsx:ModalFicha
frontend/src/components/PanelLateral.jsx:SIN_DATO,PanelLateral
frontend/src/components/Tirador.jsx:PASO,PASO_GRANDE,Tirador
frontend/src/components/graficos.jsx:W,BarraFila,Elemento,Cifra,Composicion,Columnas,EJE,TECHO,TablaKpi,Advertencia,IconoIndicadores,BarraApilada,Discontinuidad
frontend/src/components/PanelIndicadores.jsx:PanelIndicadores,Seccion,SeccionSimef,SeccionAnios
frontend/src/components/PaginaMetodologia.jsx:PaginaMetodologia
frontend/src/components/EtiquetaImagen.jsx:EtiquetaImagen
frontend/src/components/CartelContexto.jsx:CartelContexto
frontend/src/components/ControlesPanel.jsx:Opcion,ModalTerritorio,ModalMapaBase
frontend/src/components/Banner.jsx:Banner

## EXISTING_README
# coipo_vista_catastro

## DEPLOYMENT_FILES
.github/workflows/deploy.yml,.github/workflows/readme.yml,.github/workflows/update-readme.yml

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