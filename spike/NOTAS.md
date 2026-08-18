# Fase 0 · Resultado del spike

Fecha: 2026-08-17. Todo lo de aquí está **medido ejecutando y mirando la captura**, no
derivado del código. Lo que no se midió lo digo con esas palabras.

Reproducir: `python spike/gen_bin.py && python spike/medir.py --gpu`

---

## Veredicto

**El plan sigue en pie.** deck.gl pinta los 1 827 933 puntos del CBN en menos de un segundo
y el mapa resultante es geográficamente correcto: norte árido en beige, centro en tonos
oliva, sur en verde de bosque nativo, cuerpos de agua y glaciares hacia Magallanes. Ver
`captura-base.png`.

---

## Medidas (Chrome headless, GPU real, ventana 1400×1100, zoom 3,6 nacional)

| | base | con SwiftShader |
|---|---:|---:|
| Filas cargadas | 1 827 933 | 1 827 933 |
| Descarga del `.bin` de 16,5 MB (local) | 77–208 ms | 208 ms |
| **Primer pintado** | **735–1 011 ms** | 1 833 ms |
| fps en paneo continuo | 16,9–32,6 | **0,1** |
| **Pasada de filtro en JS sobre 1,83 M filas** | **8–14 ms** | 12 ms |
| Píxeles pintados | 39 209 | 39 663 |
| Bandas horizontales con datos | 15/16 | 15/16 |
| Colores distintos | 106 | 106 |
| Avisos de deck.gl | 0 | 0 |

**La pasada de filtro tiene un margen enorme**: 8–14 ms contra el objetivo de 120 ms. El
riesgo R2 del plan queda prácticamente cerrado, aunque falta sumarle el coste de subir el
canal a la GPU y el de recalcular los histogramas cruzados.

**SwiftShader no sirve para paneo**: 0,1 fps. Afecta a la verificación en CI, que corre sin
GPU. Es exactamente el riesgo R6: en CI hay que medir el primer pintado y los píxeles (que
sí funcionan), nunca los fps, o reducir el conjunto a una región pequeña.

---

## Supuestos que se cierran

### S4 — `DataFilterExtension` con `uint8`: **FUNCIONA** ✅

`?filtro=u8` y `?filtro=f32` dan resultados **idénticos**: 28 850 píxeles, 5 colores,
14 bandas, 0 avisos, con 943 456 de 1 827 933 puntos visibles (uso 04, bosques). Ver
`captura-s4-u8.png`: el mapa muestra bosque solo desde Valparaíso al sur, con el vacío del
Atacama y la mancha aislada del altiplano nortino. Correcto.

⇒ El canal de filtro va en **`Uint8Array`, 1 byte por punto**. Sobre los 3,39 M de puntos
son **3,4 MB por cambio de filtro en vez de 13,6 MB**. La salida de contingencia R5 del
plan (caer a `Float32Array`) no hace falta.

### `getPosition` con `size:2` — la incompatibilidad **NO se reproduce** ❌

El plan obligaba a `size:3` porque `attribute.js:265` compara `binaryValue.size` contra
`this.size` (3 en LNGLAT) y, si no coincide, caería al bucle por fila sin avisar.

**Medido**: `?roto=size2` produce un render **idéntico** al bueno — 39 209 píxeles exactos,
106 colores, 15 bandas, 0 avisos, 467 ms de primer pintado. deck.gl 9.3.10 maneja `size:2`
correctamente.

⇒ Se mantiene `size:3` porque es el tamaño nativo de LNGLAT y no cuesta nada, pero **la
justificación del plan era falsa** y `size:2` está disponible si aparece presión de memoria
(ahorraría 7,3 MB de los 22 MB del buffer de posiciones).

### S5 — `TileLayer` como mapa base: **sin resolver, a propósito**

No se probó porque exige pedir teselas a un tercero, y el propio plan decide que una
herramienta institucional no llame a terceros sin decisión explícita. El modo por defecto
es sin mapa base y **la silueta de Chile se dibuja sola con los puntos**, como demuestra
`captura-base.png`. Queda como pregunta abierta para el usuario, no como bloqueo.

---

## Defecto encontrado MIRANDO, que ninguna aserción previa cazaba

La primera corrida pintó **el país entero en blanco**. La silueta era perfecta, los
1 827 933 puntos estaban ahí, y deck.gl **no emitió ni un aviso**.

Causa: `getFillColor: {value: col, size: 4, normalized: false}`. Con `Uint8Array`, el
shader espera el color en 0..1; con `normalized:false` recibe 0..255 crudo y satura todo a
blanco. La corrección es `normalized: true`.

Lo grave no es el bug, es que **las tres aserciones que existían entonces —píxeles, bandas
y ausencia de avisos— pasaron todas en verde sobre un mapa completamente roto**. Por eso se
añadió A4 (`casi-blanco < 50 %`), y se conserva el defecto como prueba negativa permanente
`?roto=colorcrudo`.

---

## Aserciones y sus umbrales

Los umbrales salen de la **línea base medida**, no de una cifra inventada. El plan proponía
«píxeles > 40 000»; la medición real de un render correcto es 39 209, así que ese umbral
habría nacido rojo sobre un mapa bueno — un gate con falso positivo entrena a ignorarlo y
acaba desactivado. Se fija en 25 000 (64 % de la línea base): distingue sin ambigüedad un
mapa pintado de un lienzo vacío.

| | Aserción | Línea base |
|---|---|---|
| A1 | píxeles > 25 000 | 39 209 |
| A2 | bandas ≥ 12 de 16 | 15 |
| A3 | ≥ 8 colores distintos | 106 |
| A4 | casi-blanco < 50 % | 1,9 % |
| A5 | 0 avisos de deck.gl | 0 |
| A6 | primer pintado < 3 000 ms | 735 ms |
| A7 | pasada de filtro < 120 ms | 10 ms |

A3 está calibrada para la **vista nacional sin filtrar**. Sobre una captura filtrada baja a
5 y falla, correctamente: no es un fallo del verificador, es que A3 mide diversidad temática.

## Pruebas negativas — vistas en rojo

| Defecto | Resultado | Código |
|---|---|---|
| `?roto=vacio` — `data: []` | A1, A2, A3 en **rojo** (0 píxeles, 0 bandas, 0 colores) | 1 |
| `?roto=colorcrudo` — `normalized:false` | A4 en **rojo** (98,3 % casi-blanco); A1, A2, A3 en verde | 1 |
| `?roto=size2` — `getPosition size:2` | **todo verde**: la incompatibilidad no existe | 0 |
| base | todo verde | 0 |

Los defectos se inyectan por query string **sobre el mismo archivo**, no sobre una copia:
una copia se desincroniza y acaba probando código que ya no existe.

---

## Fallos del propio arnés (la herramienta nueva es el primer sospechoso)

Tres, todos míos, ninguno del producto:

1. `websocket-client` manda cabecera `Origin` y Chrome responde **403** al handshake de CDP.
   Se arregla con `suppress_origin=True`, mejor que abrir el debugger con
   `--remote-allow-origins`.
2. `JSON.stringify(null)` devuelve la **cadena** `"null"`, que en Python es *truthy*: hay
   que decodificar antes de decidir, no después.
3. `python … | tail` y luego `$?` lee el código de salida de `tail`, no de Python: **las
   cuatro corridas parecían salir con código 0, incluidas las que estaban en rojo.** Un
   gate que nunca falla no es un gate. Verificado después sin pipe: 0 en verde, 1 en rojo.

---

## Pendiente antes de dar la Fase 0 por cerrada

- [ ] Decidir S5 (mapa base y proveedor de teselas) — es decisión del usuario, no técnica.
- [ ] Activar GitHub Pages con origen «GitHub Actions» en Settings del repo.
