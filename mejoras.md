# Prompt de trabajo: llevar `coipo_vista_catastro` al nivel de su espejo

Este repositorio es un **espejo** de `D:\GitHub\coipo_prevencion_incendio` con otros datos:
misma experiencia (banner institucional arriba, panel de filtros a la izquierda, mapa al
centro, panel de KPIs a la derecha, descargas, informe, estado compartible en URL), pero con
el **Catastro de Usos de la Tierra y Recursos Vegetacionales** (1.827.933 puntos en un
binario columnar de 23,8 MB renderizados con deck.gl) en vez de los ~14.705 incendios en
GeoJSON de la referencia.

Este documento es el backlog completo de lo que falta: **qué integrar** (existe en la
referencia y se porta), **qué mejorar** (existe aquí pero está por debajo del estándar),
**qué construir** (no se puede copiar porque los datos difieren) y **las dificultades
reales**, cada una con 3 formas de resolverla. Todo lo listado fue verificado contra el
código real de ambos repositorios a 2026-08-19.

## Reglas del trabajo

1. **Respetar el estilo de la casa**: nombres y comentarios en español, comentarios que
   explican el *porqué* (no el qué), decisiones con evidencia medida registradas en
   `DECISIONES.md`, nada de dominios hardcodeados (todo sale del `manifest.json`).
2. **No romper las invariantes del pipeline**: determinismo del ETL («re-ejecutar deja
   `git status` limpio»), gate D1–D9 sobre lo commiteado, sin marcas de tiempo en el
   manifest, base path de Pages verificado en CI.
3. **Cada bloque nuevo de UI llega con su verificación**: la referencia no publica nada que
   sus scripts de verificación visual no hayan mirado; aquí el equivalente es
   `frontend/verificacion/verificar.py` (V1–V8), que hay que ampliar a la par.
4. El repo de referencia es la plantilla: antes de escribir un componente, leer su
   equivalente en `coipo_prevencion_incendio/frontend/src/` y portar sus decisiones
   documentadas, no solo su código.

## Diferencias estructurales que condicionan todo

| | Referencia (incendios) | Este repo (catastro) |
|---|---|---|
| Datos | 6 capas GeoJSON/PMTiles, ~14.705 puntos con propiedades ricas | 1 capa binaria columnar, 1,83 M de puntos con 4 campos (`lon`,`lat`,`ha`,`uso`) |
| Render | Leaflet canvas (pool de `circleMarker`) + protomaps | Leaflet (base) + **deck.gl 9.3** (`ScatterplotLayer`, canvas WebGL) |
| Stack extra | `react-leaflet`, `pmtiles`, `protomaps-leaflet` | `@deck.gl/core·layers·extensions` |
| Datos en git | Gitignorados; CI los descarga | **Commiteados** (el insumo de 321 MiB no puede subir) |
| Atributos por punto | Viajan gratis en cada feature (`marker._p`) | Solo lo que el ETL emitió; cada campo nuevo es un cambio de contrato |

Consecuencia: el *layout*, la accesibilidad, la URL, el informe y las descargas se portan
como patrón; **todo lo que toca datos por punto se rediseña** (ver «Construir» y
«Dificultades»).

---

## 1. Faltantes por integrar (existen en la referencia, se portan)

### Prioridad alta

1. **Banner institucional CONAF/UIA (imagen).** Hoy la cabecera es una banda verde con
   `<h1>` de texto ([App.jsx:168-176](frontend/src/App.jsx#L168-L176)), pese a que el asset
   `banner-conaf-uia.jpg` **ya está copiado** en [frontend/src/assets/](frontend/src/assets/)
   y nadie lo importa. Portar `Banner.jsx` de la referencia casi tal cual: `<img>` 3032×177
   con `width`/`height` que reservan el alto, alto `max(68px, 100vw/17.1299)`,
   `fetchPriority="high"`, y la réplica del banner en el cascarón `#arranque` de
   `index.html`. Receta completa en `coipo_prevencion_incendio/INSUMO_GRAFICO/implementacion_banner.md`.

2. **Panel derecho de indicadores — armazón y primitivas.** No existe (la rejilla es de 2
   columnas; el propio [App.css](frontend/src/App.css) lo anuncia como «bloque 3»). De la
   referencia se porta el armazón (`PanelIndicadores.jsx`, 730 líneas: header, rótulo de
   ámbito, clase `.refrescando`) y las primitivas SVG de `graficos.jsx` (482 líneas: `Cifra`,
   `BarraFila`, `Columnas`, `Lineas`, `TablaKpi` — tabla gemela accesible por gráfico —,
   lienzo W=288, colores por `var(--…)`). El **contenido** (qué KPIs) va en «Construir».
   Ojo: hoy solo existe `--pista-panel` y `grid-template-columns` declara literalmente dos
   pistas ([App.css:9](frontend/src/App.css#L9)) — hay que añadir la tercera columna y la
   variable `--pista-kpi`, no basta con «activar» nada.

3. **Estado compartible en URL (`urlState.js`, 81 líneas).** Hoy no hay ni una lectura de
   `location.search`: filtros, encuadre y basemap se pierden al recargar, aunque
   `config.js` y `build_bin.py` dan por hecho que «el índice viaja en la URL compartible».
   Portar: `leerURL()` alimenta el estado inicial, `escribirURL()` con debounce 250 ms y
   bandera `empujar` (pushState para cambios deliberados, replaceState para paneo),
   `flush()` antes de Compartir/Informe, `popstate` repone vista sin animar. Adaptación:
   el parámetro de filtro es `usos` (índices 0–8, estables por diseño del manifest).

4. **Tres regímenes responsive.** Hoy hay UNA media query a 900 px que apila el panel bajo
   el mapa; las constantes `CORTE_KPI`/`CORTE_PANEL` existen en `config.js` pero nadie las
   lee. Portar `regimenDe(ancho)` con cortes 1200/900, cajones `fixed` con
   `translateX`+funda `overflow:hidden`, botones flotantes `.abrir` (☰) y `.abrir-kpi` con
   `aria-expanded`/`aria-controls`, foco gestionado, Escape cierra, y `data-regimen`
   publicado en `.app` para que la verificación detecte desincronización JS/CSS.

5. **Sección de descargas (UI y utilidades).** No existe nada de descarga. De
   `SeccionDescargas.jsx` (304 líneas) y `descargas.js` (251 líneas) se porta: CSV con `;`,
   coma decimal, BOM para Excel es-CL, escapado RFC 4180, guardia anti inyección de
   fórmulas; GeoJSON RFC 7946 con miembro `coipo` de procedencia (fuente, ámbito, filtros,
   URL, avisos); nombres slug `{capa}_{ambito}_{fecha}`; estados `aria-live` y errores
   `role=alert`; fila «archivo publicado sin filtrar». El **motor** para 1,83 M de filas se
   rediseña (ver Dificultad 3).

6. **Selección de puntos por teclado + lectores de pantalla (WCAG 2.1.1).** Hoy el único
   camino a la ficha es el clic de ratón sobre el canvas. La referencia: con foco en el
   mapa, Enter «pincha» el centro de la vista; punto de mira `.mira` solo con
   `:focus-visible`; `<main>` con `aria-describedby` a instrucciones ocultas
   (`.solo-lectores`, clase que aquí tampoco existe). Adaptación: el `MouseEvent` sintético
   no sirve con deck — llamar a `deck.pickObject({x, y})` con la coordenada del centro.

7. **Verificación visual bloqueando el despliegue.** En la referencia `deploy` tiene
   `needs: [build, verificar-visual]`; aquí `verificar.py` (V1–V8) solo se corre a mano y
   el [deploy.yml](.github/workflows/deploy.yml) publica sin que nadie mire la UI. Cómo
   llevarlo a CI sin GPU es la Dificultad 5. Portar también tres prácticas del job de la
   referencia: subir las capturas como artefacto con `if: always()` (cuando fallan es
   cuando hacen falta), `sparse-checkout` para no clonar datos que el job no usa, y resumen
   en `GITHUB_STEP_SUMMARY`.

### Prioridad media

8. **Tiradores + persistencia de disposición — solo falta cablearlos.** `Tirador.jsx`
   (role=separator con teclado completo) y `preferencias.js` (clave `coipo.disposicion`)
   están copiados y completos pero **huérfanos: cero imports**. Falta el cableado en
   App.jsx/App.css: pistas dinámicas, techos que garantizan mapa ≥ `MIN_MAPA`=520 px,
   re-guardado en cada arrastre, plegado anclado con `.sin-panel`/`.sin-kpi`.

9. **Informe imprimible (HTML → PDF vía `window.print`).** `informe.js` (253 líneas):
   portada institucional, ficha de metadatos (ámbito, filtros, URL de la vista), hoja de
   mapa apaisada con el PNG capturado, hoja de indicadores con `renderToStaticMarkup`,
   `paletaClara()` forzada, degradación honesta con motivo escrito si falla la captura.
   Depende de tener antes el panel KPI (ítem 2) y la captura PNG (ítem 10).

10. **Exportación del mapa a PNG (`mapaPNG.js`).** La rejilla de teselas re-descargadas con
    `fetch(mode:'cors')` y la banda de atribución se portan directas; la superposición del
    canvas **WebGL** de deck.gl no funciona con `drawImage` a secas (ver Dificultad 4).

11. **Compartir esta vista.** Sección del panel: `flush()` de la URL pendiente,
    `navigator.share` → `navigator.clipboard` → input readonly seleccionado (triple
    fallback), aviso `aria-live` «Enlace copiado». Depende del ítem 3.

12. **Cartel de contexto en la primera carga.** `CartelContexto.jsx` (75 líneas): aside
    fijo sobre el mapa (no modal, visible en cada carga por decisión de privacidad) con la
    frase anti-malentendido. Aquí los textos canónicos `AVISO_PUNTOS`/`AVISO_SERIE` ya
    existen en `config.js` pero enterrados al final del panel, donde un visitante primerizo
    no los ve antes de malinterpretar los puntos como predios.

13. **Pie de procedencia del panel.** El `PanelLateral` de la referencia cierra con
    «Publica: CONAF · Unidad de Información y Análisis», fuentes tomadas del manifest y
    contacto — con el comentario de que si el banner no carga, ese pie es la única
    atribución en texto de la página. Aquí `manifest.fuente` se emite
    ([build_bin.py:140](ETL/build_bin.py#L140)) y **ninguna superficie de la UI lo muestra**.

14. **Accesibilidad transversal que falta en CSS *y* en JS.** En CSS: `@media
    (pointer:coarse)` (objetivos táctiles 44 px), `@media (prefers-reduced-motion)`, clase
    `.solo-lectores`, regiones `aria-live` para avisos. En JS: la referencia consulta
    `menosMovimiento()` para apagar `fadeAnimation`/`markerZoomAnimation` al crear el mapa y
    condicionar `animate` en cada `fitBounds` — aquí quedan en `true` incondicional
    (`zoomAnimation:false` sí es fijo, y con razón: sincronía con deck).

15. **Encuadre por región (obligatorio cuando exista el filtro regional).** La pieza más
    delicada de la referencia: `limitesDeRegion()` calcula bounds desde los datos, un efecto
    encuadra al cambiar de región con banderas (`regionEncuadrada`, sellado para respetar el
    lat/lon de una URL compartida, rearme desde `popstate` — corrigió un bug real
    documentado), y el botón «Centrar el mapa en {región}» cubre los tres casos donde el
    automático no puede actuar. Portar junto con el canal `region` del `.bin` (Construir 2).

### Prioridad baja

16. **Metadatos OpenGraph/Twitter en `index.html`.** La referencia trae
    `og:type/site_name/locale/url/title/description` y `twitter:card` (sin `og:image` hasta
    tener el asset 1200×630, decisión documentada). Aquí: cero metadatos de tarjeta social.

---

## 2. Mejoras (existe aquí, pero por debajo del estándar)

### Prioridad alta

1. **El clic que abre la ficha es sospechoso de estar inerte — verificar antes que nada.**
   `CapaPuntos.jsx` confía en el `onClick` de la `ScatterplotLayer`, pero `.deck-overlay`
   tiene `pointer-events:none` ([App.css:51-56](frontend/src/App.css#L51-L56)) y el canvas
   lo hereda: los eventos DOM pueden no llegar nunca al EventManager de deck. El comentario
   del CSS («el picking de deck funciona igual porque deck lee del canvas, no del DOM»)
   confunde el picking por color con la *recepción del evento*. Ninguna aserción lo cubre.
   Acción: probar a mano; añadir aserción V9 «clic en un punto abre la ficha» vía CDP
   `Input.dispatchMouseEvent`; si está roto, capturar el `click` de Leaflet y llamar a
   `deck.pickObject`.

2. ~~**Tooltip de hover prometido y ausente.**~~ **Resuelto a medias, y en la dirección
   incómoda.** El bloque `SIMBOLOGIA` de `config.js` declaraba cuatro mecanismos obligatorios
   y decía que quitar cualquiera «rompe la accesibilidad del mapa». Dos de los cuatro no eran
   ciertos: el tooltip nunca se implementó, y la leyenda siempre visible salió del panel al
   pasar todos los controles a botonera. El bloque está reescrito y ahora **cuenta lo que hay**
   —aislar-al-marcar, tabla de superficie, la ficha del punto y los nombres dentro del modal de
   Uso— y dice explícitamente que la lectura del mapa *sin interactuar* depende más del color
   que antes.

   Lo que queda pendiente **no es documentación sino producto**: el tooltip sigue sin existir y
   sería el mecanismo que devuelve el nombre de la clase sin obligar a abrir nada. Con deck es
   directo: `onHover` con `info.index` + un div posicionado. Es la mitigación natural de haber
   quitado la leyenda.

   *Actualizado tras la homologación:* la afirmación absoluta de la Metodología —«todas las
   etiquetas salen del código oficial, nunca del texto»— ya está reescrita, y ahora enumera las
   cinco dimensiones sin código y remite a la tabla de homologación publicada, que es
   verificable por terceros. También se corrigió «39 subtipos distintos», que contradecía al
   manifest antes de la fusión y lo contradiría más después (son 33).

### Prioridad media

3. **Script `verify:base` roto.** `package.json` declara `"verify:base": "node
   scripts/verify-base.mjs"` y `frontend/scripts/` no existe. Crear el script (la trampa del
   base path está cubierta en el `verify-banner.mjs` de la referencia) o borrar la entrada:
   hoy el CI ya cubre el base path con un grep sobre `dist/index.html`.

4. **Pantalla de error sin botón Reintentar.** Explica y muestra el detalle técnico, pero
   con un `.bin` de 23,8 MB en redes móviles el fallo transitorio es el caso común y la
   única salida es recargar a mano. La referencia incluye reintento por capa.

5. **READMEs vacíos o de plantilla.** El raíz tiene 26 bytes; `frontend/README.md` es la
   plantilla de Vite. Documentar al menos: qué es, cómo regenerar los datos (`build_bin.py`
   contra el `.duckdb` local), cómo correr gate y verificación visual, y por qué los datos
   van commiteados.

6. **El ETL no declara dependencias — compromete la reproducibilidad prometida.** No hay
   `requirements.txt`; `build_bin.py` necesita `duckdb`, `numpy` y `pyarrow` (implícito en
   `.to_arrow_table()`) y ninguna parte del repo lo dice. El determinismo («git status
   limpio») depende del comportamiento de la versión concreta de DuckDB, hoy sin fijar.
   La referencia publica `ETL/requirements.txt` con rangos y lo usa como clave de caché en CI.

### Prioridad baja

7. **Pasada muerta de ~7,3 MB en la carga.** `cargarPuntos()` devuelve
   `color: tablaColor(…)` ([binario.js:45](frontend/src/datos/binario.js#L45)) — una pasada
   completa sobre 1,83 M de filas que produce un `Uint8Array` de n×4 ≈ 7,3 MB — y **nadie
   lee `datos.color`**: App.jsx recalcula la misma tabla en su `useMemo` (necesita rehacerla
   al cambiar de tema). Eliminar el campo, el parámetro `paletaRGB` de `cargarPuntos` y el
   `eslint-disable` que existía para no refetchear al cambiar el tema.

8. **La cifra 1.827.933 hardcodeada en TRES sitios.** La píldora de carga
   ([App.jsx:251](frontend/src/App.jsx#L251)), la **meta description** de
   [index.html:12-15](frontend/index.html#L12-L15) (lo que ven buscadores y tarjetas; es
   HTML estático, así que el arreglo es distinto: redactar sin cifra o regenerar en build) y
   el comentario de cabecera de `CapaPuntos.jsx`. Tras cualquier reproceso, las tres mienten.

9. **Encuadre inicial fijo en vez del bbox del manifest.** `VISTA_INICIAL` constante; la
   referencia hace `fitBounds(limitesDelManifest(manifest))` solo si la URL no trae
   lat/lon. El manifest **ya trae** `capas.cbn_puntos.bbox`. Añadir también el
   `ResizeObserver → invalidateSize` (imprescindible en cuanto los tiradores cambien el
   ancho del mapa).

10. **Escritura no atómica del ETL.** `build_bin.py` escribe `.bin` y `manifest.json` con
    `open()` directo: un corte a mitad deja un `.bin` truncado junto a un manifest viejo.
    El `gj_io.py` de la referencia escribe a `.tmp` y hace `os.replace`. Tres líneas.

11. **El frontend no valida `manifest.esquema`.** `binario.js` valida capa, bytes y offsets
    pero nunca `esquema === 1`, que `build_bin.py` emite y D1 trata como versión del
    contrato. Cuando el esquema suba a 2 (canal de región), datos nuevos con frontend viejo
    abrirían las vistas tipadas con offsets equivocados sin un error que nombre la causa.
    Es un `if` de una línea.

12. **Comentarios heredados que citan infraestructura del otro repo.**
    `useFechaImagen.js:26` cita `scripts/verify-banner.mjs`/`verify-panel.mjs` y
    `preferencias.js` cita «la aserción B17»; nada de eso existe aquí. Ajustar a
    `frontend/verificacion/verificar.py` o crear las aserciones al llegar el bloque 3.

13. **Huérfanos y artefactos regenerables commiteados.** Sin una sola referencia:
    `DIACRITICOS` exportado en `config.js` (lo consume `claveRegion()` en la referencia —
    es la miga del futuro selector de región), `public/icons.svg` (¡se copia a `dist/` y se
    publica en cada deploy!), `src/assets/hero.png`, `react.svg`, `vite.svg`. Además
    `frontend/verificacion/captura-app.png` es la *salida* de `verificar.py` y está
    trackeada: cada corrida local ensucia `git status`, chocando con la invariante del repo.
    Decidir: borrar, ignorar o (DIACRITICOS/banner) conservar con un comentario de destino.

---

## 3. Construir (no se puede copiar: los datos difieren)

1. **Definir e implementar los KPIs propios del Catastro** *(alta)*. Los de la referencia
   (causa humana, temporadas, avance OECV) no tienen equivalente aquí. Candidatos con los
   datos existentes: composición de superficie por uso (barras, % del total nacional),
   superficie/n del ámbito filtrado, histograma de tamaños de polígono (calculable del
   `Float32Array` de `ha`), agregación por clase IPCC (derivable de `manifest.usos[].ipcc`),
   y — cuando el `.bin` traiga región — superficie por región con su año de vigencia. El
   patrón de `indicadores.js` (funciones puras sobre arrays, verificables desde Node, una
   sola pasada) se copia; ninguna métrica se copia.

2. **Extender el `.bin` y el ETL con más dimensiones** *(alta)*: región, SUBUSO/ESTRUCTURA,
   TIPO_FORES. `DECISIONES.md` ya resolvió CÓMO derivar cada campo (del código de 6 dígitos;
   TIPO_FORES de `ID_TIFO` con un alias; SUBTIPOFOR/ALTURA del texto con columna de
   procedencia; la §C sigue ABIERTA y se resuelve con evidencia). Hacerlo implica: canales
   `u8`/`u16` respetando la alineación (campos de 4 bytes primero), tablas de vocabulario en
   el manifest (patrón `codificar()` de la referencia), ampliar D1–D9, regenerar en local y
   commitear. Cada canal `u8` ≈ +1,8 MB. Ver Dificultad 2.

3. **Descargas adaptadas al volumen** *(alta)*. El motor de la referencia materializa todo
   el texto en memoria; con 1,83 M de filas un CSV nacional ronda 100+ MB. Generar desde los
   TypedArrays por trozos, respetar el filtro activo y declararlo, techo con aviso, y la
   fila «archivo completo publicado». Ver Dificultad 3.

4. **Ficha de punto enriquecida sin engordar la capa de render** *(media)*. Hoy la ficha
   muestra lo único que hay (uso, IPCC, ha, lat/lon). Decidir el vehículo de los atributos
   de detalle: canal binario para lo *filtrable* + archivo lateral indexado por posición
   para lo que solo se lee al clic. `ModalFicha` ya está portado; se construye el
   «fichas.js del catastro» y su fuente de datos. Ver Dificultad 2.

5. **Captura del mapa compatible con WebGL** *(media)*. En la referencia todos los canvases
   son 2D y se componen con `drawImage`; el canvas de deck es WebGL sin
   `preserveDrawingBuffer` y leerlo fuera del frame devuelve transparente. Ver Dificultad 4.

6. **Modelar la «fecha de los datos» sin timestamp de generación** *(media)*. La referencia
   muestra «datos al {manifest.generado}»; aquí el manifest no tiene ni debe tener marca de
   tiempo (D2 exige determinismo). Lo que sí es dato es la **vigencia por región**
   (2014–2024, hoy solo en prosa en `AVISO_SERIE`): emitir un bloque `vigencia` en el
   manifest desde la base y mostrarlo en panel, ficha, informe y procedencia de descargas.

7. **Aserciones de layout y descargas para la verificación del catastro** *(media)*. Al
   construir bloque 3 y descargas, escribir los equivalentes de B1–B23: geometría de pistas
   en ambos cortes, no-desbordamiento con cajón abierto, `data-regimen` coherente,
   `coipo.disposicion` con exactamente 4 campos, aritmética de KPIs recalculada con código
   independiente contra el manifest, CSV con BOM verificado en bytes, clic-abre-ficha vía
   CDP. El arnés (servidor propio + CDP + medir píxeles) ya existe en `spike/medir.py` y
   `verificar.py`; se copia la arquitectura, no las aserciones. Nota de exactitud: V1–V8 no
   son «solo píxeles» — V1 y V7 ya son aserciones de DOM.

---

## 4. Dificultades, con 3 formas de resolver cada una

### D1. KPIs y filtros cruzados sobre 1,83 M de filas en el cliente

Hoy el resumen de «Ámbito» sale de agregados precomputados (`manifest.usos`) y el único
filtro es por uso — la pasada de filtro **en JS (CPU)** sobre los TypedArrays cuesta 8–14 ms
(el refiltrado punta a punta con deck midió 14 ms en el spike). Con más dimensiones
(región × uso × subuso), cualquier combinación no precomputada exige recorrer los arrays y
agregar; el panel de la referencia recalcula todo en cada cambio (~1,6 ms para 14.705
features — aquí serían pasadas de ~2 M de elementos por indicador).

| Opción | Pros | Contras |
|---|---|---|
| **A. Pasadas directas sobre TypedArrays en el hilo principal** — `indicadores.js` estilo referencia: una sola pasada acumulando en `Float64Array` por código, memoizada sobre el filtro (~10–40 ms en escritorio). | Cero infraestructura; mismo patrón verificable desde Node; una pasada única alimenta todos los indicadores. | Bloquea el hilo (jank en hardware modesto; 100–200 ms en móviles); cada indicador nuevo tienta a añadir otra pasada. |
| **B. Web Worker con el buffer transferido** — la agregación vive en un Worker que recibe el `ArrayBuffer` una vez y responde sumas por grupo; el hilo principal solo pinta. | UI siempre fluida; escala a indicadores caros (histogramas, percentiles); el Worker comparte código con la verificación Node. | Sincronización (filtro duplicado, respuestas fuera de orden); `SharedArrayBuffer` exige COOP/COEP que GitHub Pages no permite — toca transferir/clonar; depurar es incómodo. |
| **C. Precomputar el cubo de agregados en el ETL** — `build_bin.py` emite las sumas n/ha por celda uso×región (9×16 = 144 celdas) en el manifest o un `kpis.json`; el frontend solo combina celdas. | Respuesta instantánea e independiente del tamaño; cifras bajo el gate (verificables contra la cifra oficial, como D8); frontend trivial. | Solo cubre combinaciones previstas: un tercer eje multiplica celdas, y un filtro libre (rango de ha, bbox) vuelve a necesitar la pasada; hay que versionar el esquema del manifest. |

Recomendación práctica: C para lo previsible (uso×región) + A para lo que el cubo no cubra,
y B solo si la medición (no la intuición) muestra jank.

### D2. El `.bin` transporta 4 campos y la experiencia espejo exige atributos ricos

Por punto viajan solo `lon, lat, ha, uso`. La ficha de la referencia muestra ~10 campos y
sus filtros usan región/temporada/causas. Cada campo nuevo cuesta bytes (~1,8 MB por canal
`u8` sobre 23,8 MB) y contrato (offsets, vocabularios, D3/D4/D5, regeneración + commit).

| Opción | Pros | Contras |
|---|---|---|
| **A. Ampliar el `.bin` con canales enteros para lo filtrable** — `region` (u8, 16 valores), `subuso`/`estructura` contra tablas del manifest; filtros con `DataFilterExtension` `filterSize>1` o combinando canales en CPU. | Un solo fetch; mismo patrón cero-copia ya probado; el filtrado sigue siendo una pasada u8; tablas en el manifest, nada hardcodeado. | El `.bin` crece con cada campo (región+subuso+estructura ≈ +5,5 MB) y todos lo pagan; cambiar vocabulario invalida enlaces compartidos con índices; cada cambio de esquema toca ETL, gate, `binario.js` y manifest a la vez. |
| **B. Archivo lateral de detalle bajo demanda** — un segundo artefacto columnar (`cbn_detalle.bin` o parquet) con los campos de ficha, leído por HTTP Range al clic (offset = índice × ancho de fila) o descargado en segundo plano tras el primer render. | El primer pintado no engorda un byte; campos de solo-ficha (SUBTIPOFOR, ALTURA, procedencia §E) sin tabla ni índice; separa contrato de render y de consulta. | El Range en Pages con `Accept-Encoding: identity` ya demostró ser traicionero (el job humo lo documenta); una petición por clic añade latencia y errores nuevos; dos artefactos que mantener coherentes bajo el gate. |
| **C. Capa de consulta en PMTiles con atributos completos** — teselas de puntos con tippecanoe usadas SOLO para la ficha (patrón `CapaTiles` + `queryTileFeaturesDebug` de la referencia), deck sigue con el render masivo. | Atributos ilimitados sin tocar el `.bin`; el patrón de consulta por clic ya está escrito en la referencia; Range trae solo el viewport. | Introduce tippecanoe + pmtiles + protomaps a un stack que no los tiene (y tippecanoe no corre en Windows, donde vive este ETL); duplica datos en dos formatos que pueden divergir; PMTiles de decenas de MB commiteados. |

### D3. Descargar «lo filtrado» cuando lo filtrado puede ser 1,83 M de filas

La promesa de la referencia («todo lo que se descarga respeta el filtro activo») es barata
con 14.705 features y carísima aquí: un CSV nacional ronda 100+ MB y construir la cadena en
memoria (patrón `descargas.js`: join de strings + Blob) puede agotar la pestaña.

| Opción | Pros | Contras |
|---|---|---|
| **A. Generación en cliente por trozos** — CSV desde los TypedArrays acumulando partes de ~1 MB en `new Blob(partes)` (o File System Access API donde exista), con progreso `aria-live` y el mismo BOM/`;`/coma decimal. | Cumple la promesa espejo exacta; sin servidor ni artefactos extra; el Blob por partes evita la cadena gigante y funciona en Pages. | El Blob final igual vive en memoria/disco del navegador (100+ MB); en móviles puede fallar sin mensaje claro; serializar 1,8 M de filas bloquea el hilo salvo que también se lleve a un Worker. |
| **B. Techo de filas + enlace al dato completo publicado** — CSV filtrado hasta un techo (p. ej. 200k filas) declarando el corte, y siempre la fila «archivo publicado sin filtrar» (`cbn_puntos.bin` + manifest, o un CSV completo emitido por el ETL). | Predecible en cualquier dispositivo; honesto (el motivo escrito es patrón de la casa); el caso de uso real (una clase en una zona) suele caber bajo el techo. | El usuario con selección grande no se lleva exactamente su vista; el techo es arbitrario y habrá que defenderlo; el `.bin` crudo no lo abre Excel (un CSV nacional commiteado rozaría el límite de 100 MB de GitHub). |
| **C. Descargas precomputadas por dimensión en el ETL** — un CSV/parquet por clase de uso y/o región, commiteados y listados en el manifest; el botón elige el archivo si el filtro coincide con una partición. | Cero riesgo en cliente; archivos bajo el gate de integridad; particiones por región dan tamaños manejables. | Explota el tamaño del repo justo donde es más frágil (datos commiteados, 100 MB/archivo); la partición por uso más grande es **Bosques, 943.456 filas** (no ~550k), que dimensiona el peor caso; no cubre filtros combinados; cada reproceso reescribe decenas de binarios en el historial. |

### D4. Capturar el mapa a PNG con el canvas WebGL de deck.gl

`mapaPNG.js` compone «todos los `<canvas>` del contenedor» con `drawImage`: funciona porque
en la referencia son canvases 2D. El de deck es WebGL y, sin `preserveDrawingBuffer`, leerlo
fuera del rAF del propio render devuelve píxeles transparentes.

| Opción | Pros | Contras |
|---|---|---|
| **A. `preserveDrawingBuffer: true` permanente en el Deck.** | El cambio más pequeño posible (una opción del constructor); captura síncrona y fiable; el resto de `mapaPNG.js` se porta línea a línea. | Coste permanente para todos por una función que usan pocos: en algunos drivers desactiva optimizaciones de swap y puede costar fps justo donde el spike peleó cada milisegundo; habría que re-medir con el arnés. |
| **B. Redibujo síncrono al capturar** — forzar un render (`deck.redraw()` / esperar `onAfterRender`) y hacer el `drawImage` dentro de ese mismo frame, sin preservar el buffer el resto del tiempo. | Cero coste en uso normal; `onAfterRender` es API pública, no un hack; compatible con la degradación honesta del informe (si falla, sale el motivo escrito). | Sensible al timing (el `drawImage` debe ocurrir antes del siguiente composite); acoplado al ciclo de render de deck 9.x; más difícil de verificar determinísticamente en CDP. |
| **C. Deck efímero de exportación** — segundo Deck offscreen con los mismos attributes (los ArrayBuffers son reutilizables) y el viewState actual, un render con `preserveDrawingBuffer`, copiar y `finalize()`. | Aísla la exportación del mapa vivo; permite exportar a mayor resolución que la pantalla (mapa del informe con más detalle); sin coste permanente. | Duplica temporalmente ~30 MB de atributos en VRAM y el tiempo de un primer pintado (~0,6–1 s); más código propio; dos contextos WebGL simultáneos pueden chocar con límites en móviles. |

### D5. Verificación visual en CI sin GPU (SwiftShader ≈ 0,1 fps con 1,8 M de puntos)

Riesgo R6 documentado en `spike/NOTAS.md` y motivo real de que V1–V8 no estén en
`deploy.yml`: en runners de Actions deck cae a render por software, las medidas de
rendimiento no significan nada y el primer pintado puede rozar timeouts. La referencia
bloquea el deploy con verificación visual; aquí hoy se publica a ciegas.

| Opción | Pros | Contras |
|---|---|---|
| **A. Correr `verificar.py` en CI con datos reales y umbrales solo-funcionales** — job `visual` que sirve `dist` (los datos SÍ están commiteados), espera con timeout generoso (60–120 s) y aplica V1–V8, que no miden fps. | Gate real sobre datos y código publicados de verdad (mejor que el fixture de la referencia en ese punto); V1–V8 ya existen y ya se vieron fallar en local; SwiftShader pinta correcto, solo lento. | El primer pintado por software de 1,8 M de puntos es el caso patológico: flakiness por timeout que degenera en re-runs y en desactivar el gate («un gate con falso positivo acaba desactivado»); alarga cada despliegue varios minutos. |
| **B. Fixture reducido para CI, datos reales en local** — un `.bin` sintético de ~50k puntos con manifest inyectado (el generador casi existe: `spike/gen_bin.py`), servido por `verificar.py` con `--fixture`; en local se sigue verificando contra los datos reales. | Rápido y determinista (50k puntos los pinta hasta SwiftShader); las aserciones futuras de layout/aritmética/descargas corren igual con fixture; patrón ya validado por la referencia (modo «ficticios»). | No valida el `.bin` real contra la UI (aunque D1–D9 cubre los datos); doble camino de datos que mantener; una regresión que solo aparece a escala real (p. ej. el defecto `normalized:false` saturando a blanco) podría pasar el fixture. |
| **C. Formalizar la verificación manual + captura como artefacto no bloqueante** — checklist en el README («correr `verificar.py` antes de empujar datos o frontend») y un job con `continue-on-error` que sube `captura-app.png` para revisión humana. | Cero flakiness; el juicio humano sobre la captura es algo que la referencia también reserva explícitamente; coste casi nulo. | No bloquea nada: una regresión visual llega a producción igual (exactamente lo que el patrón de la referencia existe para impedir); depende de la disciplina de una persona; el artefacto no bloqueante tiende a no mirarse. |

Nota: cualquiera de las tres debe subir las capturas con `if: always()` y usar
`sparse-checkout` (prácticas ya presentes en el deploy.yml de la referencia).

### D6. Crecimiento del repo con artefactos binarios commiteados

El insumo (321 MiB) está gitignorado, así que los derivados se commitean
(`cbn_puntos.bin`, 23,8 MB hoy). Cada campo nuevo suma MB; cada reproceso suma una copia
completa al historial (git no delta-comprime binarios y `.gitattributes` ya los marca
`binary`); las opciones de D2/D3 empujan hacia más artefactos. Límite duro: 100 MB/archivo;
blando: ~1 GB/repo.

| Opción | Pros | Contras |
|---|---|---|
| **A. Seguir commiteando y presupuestar los bytes** — presupuesto explícito (p. ej. `.bin` ≤ 60 MB) vigilado por una aserción nueva del gate, prefiriendo canales u8 + archivo lateral bajo demanda sobre engordes indiscriminados. | Conserva la propiedad más valiosa del diseño («git status limpio = nada cambió» + gate autocontenido); cero infraestructura; el Catastro se reprocesa pocas veces al año. | El clon crece ~25–60 MB por reproceso para siempre; si el esquema crece a SIMEF o series, el presupuesto se agota; D6 (la aserción) ya avisa a 50 MiB — el margen se pensó estrecho. |
| **B. Git LFS para los artefactos de datos** — `*.bin` (y futuros parquet/CSV) a LFS; `actions/checkout` con `lfs: true`; el gate sigue verificando los archivos materializados. | Historial liviano y clones rápidos; transparente para frontend y gate; levanta el techo por artefacto. | Cuota LFS de GitHub (1 GB almacenamiento / 1 GB banda gratis) que un visor público con CI activo puede agotar; Pages NO sirve punteros LFS — hay que garantizar que el artefacto de Pages lleve el binario real; una dependencia operativa más que documentar. |
| **C. Sacar los datos del repo fuente** — publicar `.bin`+manifest como asset de un Release (o rama huérfana `datos`) que el job `build` descarga antes de `vite build` (análogo al `npm run datos` de la referencia, pero en CI). | Repo fuente mínimo; los datos versionan con tags legibles (`catastro-2026-08`); Releases admite hasta 2 GB por archivo (sirve para CSV completos de descarga). | Rompe la invariante central: el gate ya no verifica «lo commiteado» sino un artefacto remoto, y un push del frontend puede publicarse contra datos que nadie re-verificó; dos fuentes sincronizadas a mano; reproducir en local requiere más pasos. |

---

## 5. Lo que ya está al nivel (no rehacer)

- Armazón Leaflet: `preferCanvas`, un solo renderer `L.canvas({padding:0.5, tolerance:8})`,
  `maxBounds` Chile con viscosity, controles con títulos en español, escala métrica.
- Los 7 mapas base (Claro/Oscuro/Relieve/Calles/Topográfico/Satelital/Sentinel-2) con las
  decisiones documentadas capa por capa. Cinco salen de Esri (`server.arcgisonline.com`)
  desde agosto de 2026, cuando CARTO empezó a estampar «API KEY REQUIRED» dentro del PNG;
  el patrón de Esri es `{z}/{y}/{x}` —fila antes que columna— y cada capa lleva su
  `maxNativeZoom` **medido**, porque el `tileInfo` declara niveles que no tiene cacheados
  (Claro y Oscuro 16, Relieve 13, Sentinel-2 14). Licencias y fechas de retiro anotadas en
  `config.js`: las dos capas Canvas vencen en 12/2029.
- `EtiquetaImagen` + `useFechaImagen` portados y al día (identify de Esri con debounce y
  AbortController, fecha fija para Sentinel-2, parseo sin retroceso de día UTC−4/−3).
- `ModalFicha`: `<dialog>` nativo, cierre por backdrop/Escape, chip de color, deep links a
  Google Maps/Earth sin API.
- Tema claro/oscuro por `prefers-color-scheme` con tokens, **más** una paleta de datos
  validada con OKLab/ΔE para daltonismo que la referencia no necesita a esta escala.
- Copia canónica anti-malentendido (`AVISO_PUNTOS`/`AVISO_SERIE`) en una sola redacción.
- Cascarón de arranque `#arranque` con aviso de lentitud a 15 s, `<noscript>` con enlace al
  manifest, preconnect sin crossorigin, canonical, theme-color, favicons.
- Base path de Pages fijado y comprobado sobre el ARTEFACTO en CI (más estricto que la
  referencia en este punto).
- Contrato `manifest.json` sin dominios hardcodeados; punto fuera de vocabulario se hace
  visible (alfa 0) en vez de silenciarse.
- Gate de integridad D1–D9 en CI. Precisión: el modo `--negativas` solo reintroduce
  defectos para 6 aserciones (D2, D3, D5, D7, D8, D9) — D1, D4 y D6 no tienen prueba
  negativa; añadirlas sería una mejora menor del propio gate.
- Prueba de humo contra el sitio publicado real (index, manifest, Range del `.bin` con
  `Accept-Encoding: identity`, bytes declarados vs servidos) — la referencia NO tiene
  equivalente.
- Filtro por clase con `DataFilterExtension` (la pasada CPU de `canalFiltro` cuesta
  8–14 ms sobre 1,83 M de filas; el refiltrado punta a punta, 14 ms) — resuelve a otra
  escala lo que la referencia hace con pertenencia a `layerGroup`.
- Verificación visual local con Chrome/CDP midiendo píxeles y DOM (V1–V8) + arnés del spike
  con defectos inyectables (A1–A7). Lo pendiente es llevarla a CI y ampliarla.
- Pantalla de error dedicada con detalle técnico en `<details>` (solo falta Reintentar).
- Registro de decisiones con evidencia (`DECISIONES.md`, `spike/NOTAS.md`) y código
  comentado con el porqué: el estilo documental de la referencia está plenamente adoptado.

## Orden sugerido de ejecución

1. **Verificar el clic de la ficha** (Mejora 1) — si está roto, todo lo demás hereda el bug.
2. Banner (F1) + regímenes responsive (F4) + cablear tiradores (F8) + tercera pista de la
   rejilla → el **esqueleto espejo** queda completo.
3. Estado en URL (F3) → habilita Compartir (F11) y las URLs del informe/descargas.
4. Panel KPI: armazón (F2) + KPIs propios (C1) + decisión D1 (recomendado: cubo
   precomputado + pasadas locales).
5. Extensión del `.bin` (C2, decisión D2) → filtros por región/atributos + encuadre por
   región (F15) + ficha rica (C4).
6. Descargas (F5 + C3, decisión D3) e informe/PNG (F9 + F10 + C5, decisión D4).
7. Verificación en CI (F7, decisión D5) y saneamientos: requirements.txt (M6), esquema en
   binario.js (M11), huérfanos (M13), atomicidad del ETL (M10), READMEs (M5).
