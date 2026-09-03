# CLAUDE.md

Notas para quien vaya a **modificar** este repo. Lo que ya se deduce leyendo el código no
está aquí; lo que costó una sesión averiguar, sí.

Verificado ejecutando el **2026-09-02**. Los números llevan fecha porque caducan.

---

## 1. Qué es y en qué estado está

Visor público del **Catastro de Usos de la Tierra y Recursos Vegetacionales** de CONAF,
publicado en <https://sud-austral.github.io/coipo_vista_catastro/>. Un mapa de
**1.827.933 polígonos** (sus centroides) con 23 controles de filtro, panel de indicadores,
descargas y un reporte imprimible.

**Funciona y está verificado.** No es una demo ni le falta backend: no hay backend, y es
deliberado — el sitio es estático y los datos viajan en un binario columnar de 49,4 MB que
**se commitea**.

### Dos documentos mandan sobre este

- **`DECISIONES.md`** manda sobre los DATOS. Doce secciones (A–L) con por qué cada decisión
  del ETL es como es, con las cifras medidas. **Léelo antes de tocar `ETL/`**: casi todo lo
  que parece un error ahí está explicado y medido.
- **`mejoras.md`** es el catálogo de mejoras pendientes y de hallazgos aún abiertos.

El **`README.md` no manda y no se edita a mano**: lo genera un bot
(`.github/workflows/readme.yml` llama a un generador centralizado en otro repo) y
`README_CANDIDATE.md` es su borrador. Hoy ya miente — dice que hay 3 workflows y hay 2, y
presenta `BASE_URL` como variable de entorno configurable cuando es la de Vite, derivada
del `base` que `frontend/vite.config.js` fija a mano.

---

## 2. Estructura, y qué NO se edita a mano

```
ETL/                     produce los datos publicados
  build_bin.py           el generador: DuckDB -> cbn_puntos.bin + manifest.json
  verificar_datos.py     28 aserciones D sobre lo PUBLICADO, con --negativas
  homologacion/          tablas de equivalencia (ver abajo)
frontend/
  src/datos/             carga del .bin y columnas derivadas
  src/mapa/              deck.gl sobre Leaflet, y la copia del mapa para el reporte
  verificacion/          el arnés de navegador y los dos mutadores
  public/datos/          GENERADO Y COMMITEADO. No se edita a mano.
spike/                   código de medición (se versiona; sus salidas no)
data/                    la base de origen. NO se versiona.
INSUMO/                  insumos de la Unidad (informe, libro de homologación, PDF modelo)
INSUMO_GRAFICO/          banners institucionales y sus capturas de verificación
notebooks/, scripts/     análisis suelto y el script del bot del README
```

**`frontend/public/datos/` es salida del ETL y está commiteada.** Es lo que despliega el
sitio. Se regenera con `python ETL/build_bin.py`; no se toca a mano.

**`data/catastro_gef_singeometria.duckdb` (300 MB) está en `.gitignore`.** Sin ese archivo
**el ETL no corre**, y por eso el CI no lo ejecuta: sólo comprueba que lo commiteado sea
íntegro y coherente. Si no lo tienes, puedes trabajar en el frontend y en la verificación,
pero no regenerar datos.

**`ETL/homologacion/*.csv` se generan** desde `INSUMO/homologacion_catastro_1.xlsx` con
`python ETL/homologacion/desde_xlsx.py`. Los `adiciones*.csv` **son nuestros** y viven
aparte a propósito: la regeneración no los pisa, y así se sabe quién decidió qué.

---

## 3. Comandos, con sus trampas

```bash
python ETL/build_bin.py                    # ~15 s. Necesita data/*.duckdb
python ETL/verificar_datos.py --negativas  # 28 aserciones + 26 controles negativos
cd frontend
npm install
npm run dev
npm run lint                               # oxlint. Verde en el estado base (0 avisos)
npm run build                              # ~1 s
npm run verify:cascada                     # el oráculo del cruce, en Node
cd ..
python frontend/verificacion/verificar.py       # ~15 min, necesita Chrome
python frontend/verificacion/mutaciones-visor.py # ~40 min
```

**Trampas que cuestan tiempo si no las sabes:**

- **`npm run verify:base` está roto.** Apunta a `node scripts/verify-base.mjs` y
  `frontend/scripts/` no existe. Verificado el 2026-09-02: falla con `requireStack`. O se
  escribe el script o se borra la entrada de `package.json`; el CI ya cubre el base path
  con un `grep` sobre `dist/index.html`.
- **`verificar.py` y los mutadores necesitan Chrome** y lo manejan por CDP
  (`spike/medir.py`). Bloquean la red hacia los proveedores de teselas a propósito: la
  verificación no puede depender de un tercero.
- **`mutaciones-visor.py` PARCHEA EL REPO** —fuentes y, en algunas mutaciones, el `.bin`
  entero— y restaura al terminar. Si lo interrumpes a media ejecución, comprueba
  `git status` antes de seguir.
- **`verificar_datos.py` es sólo biblioteca estándar**, y eso es deliberado: corre en el CI
  sin instalar nada. La única excepción es **D26**, que necesita `numpy` y `scipy`; si
  faltan **lo dice y cuenta como fallo**, nunca se salta en silencio. El workflow las
  instala.

### Lo que hay hoy, medido el 2026-09-02

| suite | cuánto | comando |
|---|---|---|
| Aserciones de datos (D1–D27) | 28, y **26 controles negativos** en rojo | `python ETL/verificar_datos.py --negativas` |
| Oráculo del cruce | 21 casos + 5 negativos | `npm run verify:cascada` |
| Arnés de navegador | **83 aserciones distintas**, 95 ejecuciones (V-1…V-67) | `python frontend/verificacion/verificar.py` |
| Mutaciones del visor | 28 | `python frontend/verificacion/mutaciones-visor.py` |
| Mutaciones de la aritmética | 6 | `python frontend/verificacion/mutaciones.py` |

Todo verde el 2026-09-02.

---

## 4. La regla de dependencia que no se puede romper

**`frontend/src/indicadores.js` y `frontend/src/datos/derivadas.js` no importan NADA.**
Cero imports, y no es casualidad: `frontend/verificacion/marginales.mjs` los importa desde
**Node** para contrastarlos contra un oráculo independiente. En cuanto uno de los dos
importe `config.js` —que usa `import.meta.env`, inexistente en Node— el oráculo del cruce
deja de correr, y ése es el gate que protege la aritmética de 1,8 M de filas.

Si necesitas una constante ahí, pásala como argumento o léela del manifest.

**El manifest es la única fuente del orden de los dominios.** El ETL decide el orden de
cada vocabulario y lo publica; el cliente lo LEE y nunca lo recalcula. Ordenar en los dos
lados es pedir que dos `sort` distintos coincidan sobre `«Sí»` y `«En Peligro Crítico»`, y
si no coinciden los índices apuntan a la clase equivocada sin ningún error visible.

**El número de esquema vive en tres sitios y suben juntos:** `ETL/build_bin.py`
(`"esquema": 5`), `ETL/verificar_datos.py` (D1) y `frontend/src/datos/binario.js`. D1 es la
aserción que caza que uno se quede atrás. Un `.bin` leído con el esquema equivocado abre
vistas tipadas perfectamente válidas sobre offsets corridos: el mapa sale **plausible** y
mal, que es el peor fallo posible aquí.

---

## 5. Reglas de los datos que no se pueden romper

- **El código de especie DISTINGUE MAYÚSCULAS.** `AB` es *Abies*, `Ab` es *Adesmia
  boronioides*, `ab` es *Calceolaria biflora*. De 207 grupos que sólo difieren en caja,
  **206 son especies distintas**. Un `upper()` sobre esa columna funde 206 especies en
  silencio. Ver `ETL/homologacion/13_NO_FUSIONAR.csv`.
- **El nombre común no es clave de unión.** 53 nombres designan más de una especie
  («álamo» son tres *Populus*). Se une siempre por código.
- **La acción `revisar` de la homologación NO se aplica.** Marca las grafías que difieren
  del nombre oficial por algo más que un acento —Calera/La Calera, Mariquina/San José de la
  Mariquina— y el libro dice «confirmar antes de aplicar». Aplicarlas sería que el ETL
  zanjara nomenclatura oficial.
- **El catálogo de homologación es CERRADO**: si el origen trae un valor que la tabla no
  nombra, el ETL revienta con el valor en pantalla. No lo relajes — así se descubrió que la
  hoja 12 del libro traía el código del raulí como la cadena literal `nan`.
- **Un conjunto de filtro VACÍO significa «ninguna», no «todas».** Ausente es «todas». Esa
  distinción es la que impide que un ámbito sin coincidencias vuelva a publicar cifras
  nacionales bajo rótulo regional, que es el defecto más caro que ha tenido este visor
  (`DECISIONES.md` §G).
- **`preserveDrawingBuffer: true` en `CapaPuntos.jsx` no es decorativo.** Sin él,
  `toDataURL()` sobre el lienzo de deck devuelve un PNG **válido y completamente
  transparente sin lanzar nada** —medido: 18 KB, cero píxeles— y el reporte imprime un
  recuadro en blanco con identidad institucional encima.

---

## 6. Cómo se escribe aquí

**Todo en español**, comentarios incluidos. Y los comentarios explican **por qué**, con la
medida al lado: «medido sobre las 1.827.933 filas», «se puso en false y dio 18 KB». Un
comentario que sólo repite lo que hace la línea siguiente sobra.

**Cuando una prueba y el código discrepan, la primera hipótesis es que la prueba está mal.**
Y una aserción que nunca se ha visto roja no es una prueba: por eso existen los dos
mutadores. Si añades una aserción, añade su mutación.

**Las cifras de la interfaz salen del manifest, nunca escritas a mano.** Ya se cayó una
aserción por llevar dentro un número de los datos.

---

## 7. Brechas conocidas — no las "arregles" sin leer esto

Comprobadas una a una el 2026-09-02:

1. **`npm run verify:base` roto** (arriba). Abierta.
2. **14 casos en `ETL/homologacion/14_REVISAR.csv`** esperando decisión institucional: pares
   de códigos que designan la misma especie, `Adulta`/`Adulto` en estructura, grafías
   oficiales en disputa. **No los resuelvas por tu cuenta.**
3. **Incoherencia del propio libro de la Unidad**: la provincia `Coihaique → Coyhaique` va
   marcada `ortografia` y se aplicó; la comuna, `revisar` y no. Hoy la provincia
   **Coyhaique** contiene la comuna **Coihaique**. Es del insumo, no del ETL.
4. **El tooltip de hover no existe y nunca existió.** `config.js` llegó a declararlo como
   uno de cuatro mecanismos de accesibilidad obligatorios; ese bloque ya está reescrito y
   cuenta lo que hay. Sigue siendo la mitigación natural de haber quitado la leyenda del
   panel (`mejoras.md` §2).
5. **El estado de conservación se publica con 976 de 989 especies sin verificar** contra el
   Reglamento de Clasificación de Especies. La Metodología lo dice tres veces. No es un
   descuido: fue una decisión, y está pendiente de validación institucional.
6. **La nota «Antes de publicar, CONAF debe validar la redacción contra la Ley 20.283»**
   sigue visible en la Metodología. Es cierta; corresponde decidirla, no borrarla.
7. **El `README.md` está desfasado** y se regenera solo. No lo edites: arregla el generador
   o ignóralo.

---

## 8. Git y despliegue

- Rama por defecto **`main`**. `.github/workflows/deploy.yml` se dispara con cada push a
  `main` que toque `frontend/**`, `ETL/**` o el propio workflow, y publica en GitHub Pages.
- Cuatro trabajos encadenados: **datos** (integridad de lo commiteado, con `--negativas`) →
  **build** (lint, oráculo del cruce, compilación y comprobación del base path en
  `dist/index.html`) → **deploy** → **humo** (pide el sitio publicado y sus datos).
- **Valores acoplados que se cambian juntos**: `base` en `frontend/vite.config.js`, el
  `BASE` del trabajo de humo en `deploy.yml` y el `<link rel="preconnect">` de
  `index.html`. Un `base` mal resuelto **funciona en la raíz y rompe publicado**, con
  código de salida 0.
- **`.gitattributes` marca `*.bin` como binario sin conversión de finales de línea.** Sin
  esa línea git convertiría cada `0x0A` en `0x0D0A` y corrompería el archivo en silencio:
  las vistas tipadas seguirían abriendo, con los puntos desplazados.
- **No se commitea** lo que lista `.gitignore`: el `.duckdb` de origen, `node_modules/`,
  `dist/`, las salidas del spike y las capturas intermedias de las mutaciones. Las
  `frontend/verificacion/captura-*.png` **sí** se versionan: son la evidencia mirable de
  cada tanda.

**El historial y la publicación los decide Luis.** No hagas commit ni push salvo que te lo
pida explícitamente.
