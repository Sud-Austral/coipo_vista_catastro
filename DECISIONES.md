# Decisiones sobre los datos

Bitácora de las decisiones que **no** son automatizables y de las que sí lo son pero
requieren justificación. Cada una dice qué se decidió, con qué evidencia medida, y cuántas
filas y hectáreas afecta. Reproducir: `python ETL/analisis_codigos.py`.

La sección **M** no trata cómo se calculan los datos sino cómo se **publican**: qué ven de
ellos un buscador, un asistente de IA y la vista previa de un enlace compartido. Va aquí
porque sus decisiones también dicen qué cifra sale con qué nombre, y eso es de los datos.

Estado a 2026-08-18.

---

## A. La guía oficial de códigos es el diccionario de SIMEF, no el de CBN

`tab.xls_guia_codigos_v3_descriptores` (188 filas) define 8 familias de códigos. Contrastada
contra los datos:

| Dataset | Campo | Resultado |
|---|---|---|
| **SIMEF** | `USO_IPCC21` vía `ID_USO_21` | **1 565 516 / 1 565 516 idéntico** |
| **SIMEF** | `T_F_21` vía `ID_TIFO_21` | **1 565 516 / 1 565 516 idéntico** |
| **SIMEF** | `D_TC_19_21` vía `TC_19_21` | **1 565 516 / 1 565 516 idéntico** |

Comparando **conjuntos**, no conteos: `SIMEF.T_F_21` tiene 13 formas observadas y 13
oficiales, con intersección total — nada sobra, nada falta.

**Para CBN la misma guía solo sirve en algunos campos**, porque CBN usa otro sistema de
codificación en `ID_ESTRUC` y `ID_STIF`. Decodificar CBN con los descriptores de SIMEF
produce basura silenciosa y plausible:

| Campo de CBN | Vía | Filas que divergen | Veredicto |
|---|---|---:|---|
| `USO` | código de 6 dígitos (`usos_comb`) | **0** | ✅ derivar del código |
| `SUBUSO` | código de 6 dígitos | 51 054 | ✅ derivar (ver B y C) |
| `ESTRUCTURA` | código de 6 dígitos | 99 352 | ✅ derivar (solo ortografía) |
| `ESTRUCTURA` | `ID_EST` + descriptores | **897 281** | ❌ sistema distinto |
| `TIPO_FORES` | `ID_TIFO` + descriptores | 6 060 | ✅ derivar (ver D) |
| `SUBTIPOFOR` | `ID_STIF` + descriptores | **464 666** | ❌ sistema distinto |

Ejemplos de la basura: por `ID_EST`, `renoval` se decodifica como `nativo con exóticas
asilvestradas` (330 654 filas); por `ID_STIF`, `roble` sale como `tepú` (92 062 filas) y
`lenga` como `bosques de neblina` (59 944).

**Decisión.** `USO`, `SUBUSO` y `ESTRUCTURA` de CBN se derivan del código de 6 dígitos
contra `usos_comb`. `TIPO_FORES` se deriva de `ID_TIFO`. **`SUBTIPOFOR` y `ALTURA` se toman
del texto**, normalizado con alias, porque no hay código fiable para ellos en CBN.

Esto confirma la regla que el plan ya traía, pero por un motivo distinto del que decía: no
es que "los códigos se contradigan entre capas", es que **CBN y SIMEF son dos sistemas de
codificación distintos** y la guía documenta el de SIMEF.

---

## B. Derivar del código en vez de mantener un diccionario de alias

El plan preveía 42 alias escritos a mano para reparar el texto. Medido, el texto diverge del
código oficial en 51 054 filas de `SUBUSO` y 99 352 de `ESTRUCTURA`, y **la práctica
totalidad son la misma cosa escrita distinto**:

- `matorral pradera` / `matorral-pradera` (8 563)
- `terrenos de uso agrícola` / `terreno de uso agrícola` (3 909)
- `campos de hielos` / `campos de hielo` (1 248)
- `praderas perennes` / `pradera perenne` (52 093)
- `nativo con exotcas asilvestradas` / `nativo con exóticas asilvestradas` (3 593, con errata)
- `de exóticas asilvestradas` / `bosque de exóticas asilvestradas` (34 062)

**Decisión.** No se mantiene diccionario de alias para estos campos: la etiqueta canónica es
la que dicta el código oficial. Se elimina una fuente de mantenimiento y de desincronización.
El diccionario de alias queda solo para `SUBTIPOFOR`, `ALTURA` y la toponimia.

---

## C. `SUBUSO`: 7 191 polígonos donde el texto dice «Bosque» y el código dice «Plantación»

**24 591 ha.** Es la única divergencia de fondo, no ortográfica, entre texto y código en
`SUBUSO`. Coincide con las 24 590,98 ha que la verificación de cifras ya había señalado como
la trampa de desglosar bosques por `SUBUSO` en vez de por `ESTRUCTURA`.

**Estado: ABIERTA.** No se automatiza. Pendiente de contraste contra
`tab.xls_cifras_oficiales_*`: si las cifras publicadas de plantaciones cuadran al asignarlas
a `Plantación`, gana el código. Se resolverá con evidencia, no por mayoría.

---

## D. `TIPO_FORES` de CBN necesita exactamente un alias

Comparando conjuntos: 14 formas observadas frente a 13 oficiales. La única sobrante es
`roble - hualo` (con espacios) frente a `roble-hualo`. Afecta a 6 060 filas / 168 401 ha.
Nada falta respecto de la guía.

**Decisión.** Un alias, no cuarenta.

---

## E. Filas sin código utilizable

- **11 262 filas** no tienen el triplete completo (`ID_ESTRUC` o `ID_COBER` nulos). Coincide
  exactamente con los nulos ya conocidos de esas columnas.
- **1 fila** trae el código `040200`, que no existe en la guía.

**Decisión.** Ambos casos caen a la etiqueta del texto normalizado y quedan marcados en una
columna de procedencia, para que la app pueda decir de dónde salió cada etiqueta. Nunca se
descartan: la decisión del usuario es no podar nada.

---

## F. «No aplica» se decía de dos formas, y sólo en dos de las cuatro dimensiones era lo mismo

Cuatro columnas traían el mismo concepto por dos vías a la vez: el **centinela** (255, la fila
no trae código) y una **clase «No Aplica»** del vocabulario. La una salía como fila de la lista
de filtros, con su superficie; la otra, como nota al pie no filtrable. Para tipo forestal eso
eran 1.114.688 polígonos por un lado y 63.848 por el otro, diciendo lo mismo.

**No son cuatro casos iguales.** Medido sobre las 1.827.933 filas, cruzando el centinela y la
clase contra la subclase de cada polígono:

| | centinela | clase «No Aplica» | |
|---|---:|---:|---|
| `tifo` · Bosque Nativo | **0** | **0** | los 649.397 tienen tipo forestal |
| `tifo` · Plantación | 262.602 | 787 | |
| `tifo` · Bosque Mixto | 30.624 | 46 | |
| `stifo` · Plantación | 262.603 | 786 | |
| `cober` | 11.261 | 783.698 | y 11.261 de ellas tienen **también** el centinela en `estruc` |
| `altura` · Bosques | 293.181 | 12 | |

**Decisión, dimensión por dimensión.**

- **`tifo` y `stifo`: se funden.** Ni un solo polígono al que el tipo forestal *sí* le aplica
  —el bosque nativo— está en el centinela. Y a plantación y bosque mixto, donde no aplica, la
  fuente les pone el código `00` en el 0,3 % de los casos y nada en el 99,7 %: es la misma
  cosa escrita de dos maneras, no dos cosas. El propio contrato de `build_bin.py` ya declaraba
  `tifo … 255 = no aplica`. Fundirlos no pierde ninguna distinción y saca 1,1 M de polígonos
  de una nota al pie que no se podía filtrar.
- **`cober`: no se toca.** Su centinela son 11.261 filas, y 11.261 de ellas llevan también el
  centinela en `estruc`: son las filas de triplete roto de la sección E. Ahí «no sabemos» y
  «no aplica» son cosas distintas, y fundirlas borraría la única marca de que a esas filas les
  falta el dato.
- **`altura`: no se toca.** Su centinela mezcla las dos cosas. 293.181 polígonos de Bosques no
  traen altura de dosel, y un bosque **sí** tiene altura: eso es dato que falta, no una
  pregunta sin sentido. Separarlo del «no aplica» de los cuerpos de agua exigiría deducirlo
  del contexto, que es justo lo que este ETL no hace.

**Vigilado por `D21`**, en los dos sentidos: exige que `tifo` y `stifo` tengan el centinela a
cero y una única clase «No Aplica» con filas, y que `cober` y `altura` **conserven** el suyo.
Las cuatro pruebas negativas se han visto en rojo.

Efecto en las cifras: ninguno. El total nacional sigue en 75.661.200,40 ha y el bosque nativo
en 15.536.329,01 ha. Lo que cambia es dónde se leen 1,1 M de polígonos.

## G. La comuna de Los Ríos venía en otra columna, y eso publicó cifras nacionales

**El síntoma.** Elegir la Región de Los Ríos movía el mapa, rotulaba «Los Ríos» y entregaba
**75.661.200,39 ha y 1.827.933 polígonos**: el país entero. Corresponden 1.835.307,15 ha y
79.727 polígonos. Era la única de las dieciséis regiones donde ocurría, y la región tampoco
ofrecía provincias ni comunas: su desglose territorial completo era inaccesible.

**La causa, medida.** El `.bin` no llevaba columna de región, así que los tres niveles del
ámbito se derivaban de la columna `comuna`. Ninguna de las 331 comunas publicadas pertenecía a
la región 14, de modo que el conjunto salía vacío — y un conjunto vacío significaba «todas», no
«ninguna», tanto en `App.jsx` como en el cruce. El visor no podía distinguir «no elegí región»
de «elegí una región que no calza con nada».

**Lo que el informe de la Unidad daba por perdido no lo estaba.** El informe pedía «recuperar el
atributo de comuna desde la capa de origen». No hizo falta: el código está en la columna
**`Codcomun`**, poblada en las 79.727 filas de Los Ríos y **NULL en las otras quince regiones**
— el complemento exacto de `CODCOM`. Medido:
`count(COALESCE(CODCOM, Codcomun)) = 1.827.929` de 1.827.933. Las doce comunas estaban
completas, con códigos 14101–14204. El arreglo del dato es un `COALESCE`.

**Tres cambios, y hacen falta los tres.** Cada uno cierra un eslabón distinto:

1. **El dato**: `COALESCE(CODCOM, Codcomun)`. Comunas 331 → 343, provincias 53 → 55, y
   `sin_dato.comuna` de 79.731 a **4**.
2. **La columna de región** (`u8` desde `reg_cod`, esquema 3 → 4, +1,74 MB sobre 43,87). El
   ámbito regional deja de derivarse. Esto cierra además el hallazgo H4: los 4 polígonos de
   «Áreas no Reconocidas» de Magallanes no tienen ningún dato territorial en el origen pero sí
   `reg_cod`, así que vuelven a contar en su región — 286.529, no 286.525.
3. **La ambigüedad del conjunto vacío**, que es lo único que impide que el próximo hueco vuelva
   a publicarse como cifra nacional. Estaba en DOS sitios y el primer arreglo sólo cerró uno:
   `App.jsx` dejaba el ámbito fuera del filtro, y `resumenYMarginales` además *saltaba* los
   filtros con el conjunto vacío. Con la primera mitad arreglada, `?reg=15&prov=Valdivia`
   —una provincia que no existe en esa región— seguía devolviendo la región entera, 1,7 M ha,
   rotulada «Arica y Parinacota › Valdivia». Lo encontró una sonda, no una aserción.

**Por qué ninguna prueba lo cazaba.** No había ni una aserción que comparara un ámbito contra el
manifest, y quince de las dieciséis regiones cuadraban: cualquier prueba sobre *una* región
elegida al azar tenía quince de dieciséis de pasar. Ahora **V-59 recorre las dieciséis**, y
**D22** exige en el ETL que toda región tenga al menos una comuna — que es la comprobación que
sobrevive a un defecto del ETL, porque no compara el visor con el manifest sino el manifest
consigo mismo.

## H. La homologación: cuatro unidades y cuatro subtipos llegaban partidos en dos

Cinco dimensiones no tienen código utilizable —altura, subtipo forestal, especie, SNASPE y
comuna— y su vocabulario se deduce del texto de la capa, así que **cualquier variante de
escritura genera una clase nueva**. El Parque Nacional Bernardo O'Higgins figuraba como
«Ohiggins» (2.849.820,93 ha) y como «OHiggins» (962.126,98 ha): quien consultara una de las dos
obtenía poco más de la mitad de su superficie. Lo mismo con la Reserva Nacional Ñuble, el Parque
Nacional Pan de Azúcar y el Nahuelbuta; y cuatro pares de subtipos forestales, con 75.918,86 ha
en la variante minoritaria.

`canon()` ya fundía mayúsculas, tildes, guiones tipográficos y saltos de línea, pero **no los
espacios alrededor del guion**: «Roble-Hualo» y «Roble - Hualo» sobrevivían como dos clases. No
se resuelve con una regla más agresiva, y ése es el punto: fundir por plegado destruiría
distinciones reales. **El Parque Nacional Villarrica y la Reserva Nacional Villarrica son dos
unidades distintas** que comparten topónimo, y el código de especie distingue caja — `AB` es
*Abies*, `Ab` es *Adesmia boronioides*, `ab` es *Calceolaria biflora*; de 207 grupos que sólo
difieren en mayúsculas, **206 son especies genuinamente distintas**.

Por eso se aplica una **tabla revisada** y no una heurística: `ETL/homologacion/`, convertida a
CSV versionados desde el libro de la Unidad. Resultado: SNASPE 94 → **90**, subtipos 37 → **33**,
20 comunas y 6 provincias con sus tildes, el separador decimal de las alturas a coma.

**Dos fronteras deliberadas.** La acción `revisar` **no se aplica**: el libro marca así las
grafías que difieren del nombre oficial por algo más que un acento —Calera/La Calera,
Coihaique/Coyhaique, Mariquina/San José de la Mariquina— y dice «confirmar antes de aplicar».
Y la homologación de especie toca **etiquetas, nunca códigos**: la hoja 12 propone dos cambios de
código y ninguno puede aplicarse a ciegas —uno es el marcador `(recuperar del origen)` y el otro
una fusión que la propia hoja 14 manda a decisión—.

**El catálogo es cerrado**: si el origen trae un valor que la tabla no nombra, el ETL revienta con
el valor en pantalla. Encontró tres cosas al estrenarse, y la tercera es la que importa: que la
hoja 12 del libro trae el código del raulí como la cadena literal **`nan`**. El código es `NA`, y
pandas lo leyó como nulo al construir el libro — exactamente lo que el propio informe advertía.
Son 3.654 polígonos y 89.994,21 ha de una especie comercial. Se repone en `adiciones_12_especie.csv`.

**Los enlaces ya compartidos.** Al fundir dos grafías desaparece un código que ya viaja en URLs,
y el visor no distingue «el filtro no encuentra» de «no hay filtro»: un enlace con
`?snaspe=Nuble` habría mostrado el país entero bajo el nombre de una reserva. El manifest publica
un mapa `alias` (37 en SNASPE, 4 en subtipos) que `filtrosDesdeURL` consulta antes de rendirse.

## I. Los discos de igual área tienen que solaparse, y por eso se recortan

**El síntoma.** Al acercarse, los puntos se tapaban unos a otros. Medido sobre las 1.827.933
filas: **el 56 % de los puntos invadía a su vecino más cercano**, y en Valdivia a z13 el **45 % de
los centros quedaba debajo de un disco mayor**, con la suma de áreas en el **86 % de la pantalla**.
Y como el `.bin` no está ordenado —correlación índice·superficie −0,009—, cuál disco quedaba
encima era azar.

**Encoger no servía.** Se midió qué escala uniforme haría falta:

| escala | puntos que siguen solapando |
|---|---:|
| 1,0 | 1.019.786 (56 %) |
| 0,7 | 718.110 (39 %) |
| 0,5 | 456.162 (25 %) |
| **0,1** | **28.718 (2 %)** |

Ni al décimo. No era calibración: los polígonos **teselan** el territorio, y círculos de la misma
área que celdas que teselan tienen que solaparse. Cualquier factor uniforme era un parche.

**La regla que sí lo resuelve, y es demostrable:**

```
r = min( √(ha · 10.000 / π) , distancia al vecino más cercano / 2 )
```

Si `r_i ≤ d_ij/2` y `r_j ≤ d_ij/2` para todo par, entonces `r_i + r_j ≤ d_ij`. Cero solape, no
estimado. Se calcula en el ETL con `cKDTree` —**0,9 s** para 1,83 M de puntos— y viaja en una
columna `u16` de metros: el máximo recortado es 13.131 m, así que cabe. El `.bin` pasa de 45,7 a
**49,4 MB** (+8 %) y el esquema de 4 a 5.

**Efecto medido, Valdivia a z13:** centros tapados **45 % → 0 %**, superficie pintada
**86 % → 16 %**.

**Lo que cuesta.** Para el **56 %** de los puntos el disco ya no cubre el área del polígono sino el
sitio disponible; la mediana de los recortados baja al 54 % de su radio, o sea al 29 % de su área.
El tamaño deja de leerse como superficie en zonas densas, y los tres textos que prometían «la misma
área» —panel, metodología y el Anexo C del reporte impreso— lo dicen ahora.

**Y el límite que no se puede saltar.** Por debajo de z11 la separación mediana entre vecinos
(185 m) cae bajo los 2,4 px que necesitan dos discos en el suelo de `radiusMinPixels`. A escala de
país hay 1,8 M de puntos sobre unos 700.000 píxeles: no es una decisión de diseño, es una división.
La garantía se enuncia como lo que es —**sin solape a partir de z11**— y no como una promesa
general.

**Lo verifica D26**, que rehace el KD-tree sobre el `.bin` publicado y exige `r_i + r_j ≤ d_ij` con
1 m de tolerancia por el redondeo. No es vacía: con la regla anterior reporta **1.112.479 discos
invadiendo, el peor 55.969 m dentro**. Y **D26b** exige que el radio mediano no baje de 50 m
(medido: 67), porque recortar a cero cumpliría D26 de forma perfecta dejando el mapa en blanco.

## J. El panel se quedó sin una sola línea de prosa

Tenía seis párrafos de nota, una sección de simbología y un pie con cuatro atribuciones,
compitiendo por el sitio con los diecisiete controles que son su razón de estar. Todo eso pasó a
tres botones —**Información, Descargar y Compartir**— de la misma forma que los demás, usando
`BotonControl` y `CajaModal` sin piezas nuevas.

**Información absorbió también la Metodología**, que era un `<dialog>` aparte: eran dos superficies
de información y había que saber cuál abrir para cada duda.

**El efecto que se acepta a sabiendas:** con el pie dentro de un modal, si la imagen del banner no
carga la página se queda **sin atribución institucional visible**, y el hash de los datos deja de
estar a la vista. Queda anotado en el componente para que no se lea como descuido.

`descargas` y `metodologia` llegan al panel como **elementos**, igual que antes llegaba la sección
de descargas como `children`: el panel sigue sin saber nada de exportar ni de la guía de códigos, y
App no reenvía `datos`, `filtro`, `resumen`, `oficiales` y `simef` por dos niveles.

## K. El reporte lleva una copia del mapa, y por qué se pudo

El PDF ahora abre con **una lámina del mapa tal como estaba al emitirlo**: mismo encuadre, mismo
fondo, mismos filtros. Se compone en un `<canvas>` 2D a partir de las dos capas que forman el mapa
—las teselas, que son `<img>` colocadas por Leaflet, y el lienzo WebGL de deck.gl— y se inserta
como PNG.

**Las teselas se dibujan por su rectángulo en pantalla** y no reconstruyendo la proyección:
`getBoundingClientRect()` ya trae resueltas todas las transformaciones que Leaflet encadena.
Replicar esa aritmética sería una segunda fuente de verdad para la misma pregunta.

**Hizo falta pedirlas en modo CORS.** Sin `crossOrigin`, dibujar una tesela en un canvas lo
**mancha** y `toDataURL()` lanza `SecurityError` — medido. Se comprobaron **los siete fondos uno a
uno**: todos mandan `Access-Control-Allow-Origin`, incluido eox.at, que refleja el origen y
funciona también desde `localhost`. Sin eso, la lámina se habría quedado sin mapa base.

**Y el fallo silencioso que esto podía introducir, visto de frente.** Un lienzo WebGL sin
`preserveDrawingBuffer` devuelve un PNG **perfectamente válido y completamente transparente, sin
lanzar nada**. Se midió poniéndolo en `false`: **18 KB y cero píxeles**, contra 703 KB y 27,8 % con
él. deck.gl 9.3.10 lo pone en `true` por su cuenta —comprobado leyendo `getContextAttributes()`—,
pero un valor por omisión de una dependencia no es un contrato cuando el PDF depende de él, así que
se declara. Un recuadro en blanco rotulado «mapa» dentro de un documento con identidad
institucional es el peor fallo que puede tener este visor.

**La guarda en tiempo de ejecución NO descarta la imagen por salir vacía**, y esto se pensó dos
veces. «Vacía por un fallo» y «vacía porque el filtro no deja nada» se ven igual: con `?uso=09`
quedan cinco polígonos en todo Chile. Descartar esa copia sería llamar error a un mapa correcto.
Se devuelve siempre lo compuesto, con la fracción de contenido medida, y la lámina se rotula. Del
fallo sistemático se encargan la declaración explícita y **V-57d**, que decodifica la imagen y
cuenta píxeles en cada verificación: separa 0,0 % de 1,1-17 %.

## L. Tres filtros que responden preguntas que el visor no dejaba hacer

Ninguno cuesta un byte: los tres se derivan de columnas que ya viajan, igual que los seis de la
clasificación de especies.

**¿Dentro o fuera del SNASPE?** — de `snaspe`. El centinela de esa columna no significa «no
sabemos» sino **«fuera del Sistema»**, y por eso `SIN_DATO_POR_COL` lo excluye a propósito. Pero
esa respuesta no se podía **filtrar**: la dimensión SNASPE lista las 90 unidades, así que se podía
pedir «el Parque Nacional Villarrica» y no «todo lo protegido» ni, sobre todo, «todo lo que no lo
está» — que son **1.431.130 polígonos y 59,8 M ha, el 79 % de la superficie**.

**Tamaño del polígono** — de `ha`. Ninguna de las veintiuna dimensiones tocaba la superficie, que
es justo la variable que suman **todas** las cifras del visor. Los tramos son logarítmicos porque
así se reparte el dato, y el reparto dice algo por sí solo:

| tramo | polígonos | superficie |
|---|---:|---:|
| menos de 1 ha | 465.613 (25,5 %) | 237.883 ha (0,3 %) |
| 1 – 5 ha | 668.115 (36,6 %) | 1,6 M ha (2,1 %) |
| 5 – 20 ha | 384.796 (21,1 %) | 3,9 M ha (5,1 %) |
| 20 – 100 ha | 217.491 (11,9 %) | 9,5 M ha (12,6 %) |
| 100 – 500 ha | 73.201 (4,0 %) | 15,3 M ha (20,2 %) |
| **500 ha o más** | **18.717 (1,0 %)** | **45,1 M ha (59,6 %)** |

El 1 % de los polígonos concentra el 59,6 % del país, y el 62 % que no llega a 5 ha suma el 2,4 %.

**Año del catastro** — de `region`. El visor llevaba meses advirtiendo en tres sitios que cada
región se levantó en un año distinto, y no había forma de **usar** ese aviso: para ver lo
catastrado desde 2020 había que ir región por región. **Los periodos no se colapsan a un año**:
cinco regiones traen «2017-2019» o «2020-2022» y elegir uno de sus extremos sería inventar una
fecha que el Catastro no da.

**Los cortes de superficie viven en el ETL y se publican** con `desde`/`hasta` en cada clase; el
cliente los aplica en vez de repetirlos. Dos listas de números iguales en dos lenguajes son dos
listas que se desincronizan.

**Lo que costó, medido.** La pasada del cruce recorre TODAS las dimensiones por cada fila que pasa
el filtro, y pasó de diez a veinte. En el navegador, la mediana subió de ~85 ms a **195-218**, con
un peor caso de 337. El techo de `verificar.py` estaba en 400 y se subió a **900**: dejarlo habría
garantizado un rojo intermitente, y una aserción que parpadea acaba desactivada. Sigue siendo un
gate de orden de magnitud, que es para lo que está; el fino sigue en Node, con techo de 500 y
medida de 128-197 ms.

## M. Publicar para buscadores, asistentes de IA y vistas previas

Lo pide la guía `implementacion_ceo.md`, destilada de la implementación de Botón Rojo
(`coipo_boton_rojo`, DECISIONES §AL). Aquí no aplica tal cual: Botón Rojo tiene nginx, SSI y
datos que cambian cada día; este visor es un sitio **estático en GitHub Pages**, sin
cabeceras propias ni redirecciones de servidor, y sus datos sólo cambian con un commit. Se
implementa por pasos, un PR cada uno, y cada paso agrega aquí lo que decidió y lo que midió.

### M.0 Línea base, medida en vivo el 2026-09-26

| qué | resultado |
|---|---|
| 10 User-Agents (navegador, Googlebot, bingbot, OAI-SearchBot, Claude-SearchBot, ClaudeBot, PerplexityBot, WhatsApp, facebookexternalhit, LinkedInBot) | los 10 reciben 200 y los mismos **5.128 B**: no hay filtro por agente |
| texto del `<body>` sin JavaScript | sólo «Cargando el Catastro nacional…» y «Está tardando más de lo normal» |
| un asistente (WebFetch) ante «¿cuántas ha de bosque nativo tiene Panguipulli?» | «la página no proporciona datos» |
| `https://sud-austral.github.io/robots.txt` | **404**: la organización no tiene repositorio raíz, así que hoy cualquier bot lee todo |
| `robots.txt` y `sitemap.xml` bajo `/coipo_vista_catastro/` | 404; y un `robots.txt` bajo un subpath no lo lee ningún rastreador |
| vista previa | canonical y `og:*` presentes, **sin `og:image`**, `twitter:card=summary`; `?reg=13` muestra la misma que la portada |
| Pages | `Cache-Control: max-age=600`; no admite `X-Robots-Tag`; http→https con 301 |

Un asistente que no ejecuta JavaScript no podía citar una sola cifra del Catastro.

### M.1 Se indexa ya, sin rótulo de estado

**Luis Monsalve, profesional de la UIA, 2026-09-26.** El `<title>`, la descripción y las
frases citables no llevan «en validación». Los pendientes que sí existen —la redacción de la
Ley 20.283, el estado de conservación sin verificar contra el RCE, los términos de uso—
siguen visibles donde estaban, en la Metodología. **Pendiente**: si esta decisión necesita
ratificación de la Gerencia.

### M.2 Los bots de entrenamiento se bloquean desde un repositorio raíz nuevo

**Luis Monsalve, 2026-09-26.** GPTBot, ClaudeBot, CCBot, Applebot-Extended,
meta-externalagent y Bytespider no pasan mientras los términos de uso de los datos no estén
definidos (la Metodología dice que están pendientes). Bloquearlos no impide que un asistente
cite el sitio: eso lo hacen OAI-SearchBot, Claude-SearchBot, PerplexityBot y los `*-User`.
**Google-Extended queda permitido**, porque también controla el anclaje de Gemini.

En Pages el único `robots.txt` que cuenta es el de la raíz del host, y ese host es de la
organización: el archivo vive en un repositorio nuevo, `Sud-Austral/sud-austral.github.io`,
y **afecta a los 68 repositorios de la organización que publican en Pages** (contados el
2026-09-26 con `gh api orgs/Sud-Austral/repos`). Se aprobó sabiéndolo. Lo crea un admin de la
organización; mientras no exista, todo sigue permitido.

### M.3 Quién dice cada cifra

**Luis Monsalve, 2026-09-26.** Cada frase citable dice «según el Visor del Catastro de Usos
de la Tierra y Recursos Vegetacionales publicado por CONAF (Gerencia de Fiscalización
Forestal y Evaluación Ambiental), calculado sobre los polígonos de la actualización AAAA del
Catastro para la región…» y cierra con «las cifras del visor pueden diferir levemente de las
oficiales de CONAF». No es modestia: el visor suma polígonos y la planilla oficial es otra
fuente. El país da **75.661.200,40 ha** en el visor y **75.661.194,48** en la planilla. Las
páginas de región muestran además la cifra oficial, con el año de su planilla.

### M.4 Una tarjeta de vista previa por región y por comuna

**Luis Monsalve, 2026-09-26.** PNG de 1200×630 dibujadas en el CI y **no commiteadas**, más
una genérica versionada. Un enlace a Valdivia enseña Valdivia, no la portada.

### M.5 Se cuentan las visitas con el Umami de la flota

**Luis Monsalve, 2026-09-26.** Revierte lo que declaraba `frontend/src/preferencias.js`
(«ni telemetría de ninguna clase»). En Pages no hay nginx del host que inserte el script,
así que va escrito en el HTML; el identificador del sitio lo crea un admin de Umami y está
**pendiente**. Qué se mide y cómo se escribe se registra al implementarlo.

### M.6 El humo reintenta y espera a su build, y los PR corren las guardas

El despliegue del 2026-09-03 (corrida 33760242075) quedó **en rojo con el sitio bien
publicado**: la petición de rango del `.bin` tardó 60 s y devolvió un 503 de Pages un minuto
después de publicar, y el bloque de `curl` no reintentaba. Un rojo que no es un fallo enseña
a ignorar los rojos.

El humo pasó a `frontend/scripts/humo.mjs`: reintenta ocho veces cada 15 s ante red, 429 y
5xx (un 404 no se reintenta, es una respuesta); **espera a que Pages sirva la huella del
build** —sha256 de `index.html` más el manifest—, pidiendo con `?humo=<corrida>` para que la
caché de 600 s no conteste por el origen, y así no puede aprobar el sitio de ayer; y compara
el `.bin` servido con el declarado. Sus negativas montan diez sitios en memoria —cuatro
sanos, seis rotos— y exigen que cada uno dé lo que debe; corren sin red en el job `build`.
Verificado contra el sitio vivo: la huella de un build local, con los saltos de línea como
los deja el CI, coincidió al primer intento.

Además, **hasta el 2026-09-26 los PR no corrían ninguna guarda**: `deploy.yml` sólo
escuchaba `push`. Ahora un PR corre `datos` y `build` y no publica, en su propio grupo de
concurrencia para no cancelar un despliegue de `main`.

### M.7 Las cifras de la prosa salen de los datos

La prosa del visor —la Metodología, las advertencias del panel, las cabeceras de las
descargas— llevaba cifras de los datos escritas a mano: «entre 2014 y 2024» en cinco sitios,
«976 de 989» en tres, la cifra oficial del país como literal, el Pinus radiata, el polígono más
grande. Antes daba igual; desde que esa prosa se hornea en HTML para buscadores y asistentes,
una cifra vieja la cita un asistente, suelta y con el nombre de CONAF delante.

Ahora salen de `frontend/src/hechos.js`, sin imports para que lo carguen el navegador, Node y el
generador de páginas. Cada valor se comprobó contra el literal que reemplazaba, sobre los datos
publicados: rango 2014–2024; 976 sin verificar de 989 especies; 56 % de discos recortados;
residuo máximo por uso 6,32 ha; Bernardo O'Higgins 3.811.947,91 ha; Pinus radiata
1.714.737,31 ha contra 1.714.736,78 oficiales; polígono mayor 1.295.122,75 ha. La planilla
oficial casa con las 16 regiones por nombre salvo Magallanes, que usa la misma regla que
`ETL/cifras_oficiales.py`; si una región deja de casar, lanza en vez de atribuir una cifra a
otra región.

El filtro del ámbito salió de `App.jsx` a `filtroDelAmbito` (`indicadores.js`), porque el
generador de páginas por región y comuna tiene que usar el mismo: una página publicada no
puede citar para una comuna otra cifra que la del panel. La regla de §G viaja con él.

**Lo que costó.** El arnés de navegador quedaba en rojo o se caía en un 30–40 % de las
aperturas de un filtro, **igual en `main` que en la rama** (medido: 3 y 4 fallos de 10 en
cada una). No era la app: `esperar()` devolvía los milisegundos transcurridos, y con
`time.time()` —que en Windows avanza a saltos de ~16 ms— una condición ya cumplida en la
primera consulta daba exactamente `0.0`, que es falso, y `abrir_grupo` informaba «no abrió» con
el modal abierto. Con `perf_counter` y un piso de 0,001 ms: 0 fallos de 10, dos veces. Con eso
el arnés completo dio 95 de 95 en `main` y 95 de 95 en la rama. Queda una intermitente
conocida, **V-39** (encuadre al filtrar por Palma Chilena): quedó en z=5 en una de dos
corridas completas de la rama y pasó 2 de 2 aislada; no toca nada de lo que cambió aquí.

### M.8 La portada se hornea, y se dibuja también cuando el .bin no llega

`dist/index.html` traía `<div id="root"></div>` vacío. Ahora `npm run build` hornea dentro
la portada: el banner, el título, la **frase citable con las cifras nacionales**, «Qué es este
visor» y la tabla de superficie por uso. Lo que recibe un lector sin JavaScript pasó de dos
líneas («Cargando…») a unos 4.000 caracteres con 1.827.933 polígonos, 75.661.200 ha y
15.536.329 ha de bosque nativo. La descripción, el canonical y la vista previa del `<head>`
se generan del manifest al construir (se cierra mejoras M8: la cifra de la descripción ya
no se escribe a mano).

Cómo se hace. Una construcción SSR aparte con la API de Vite (`scripts/prerender.mjs`,
el patrón probado en Botón Rojo) y un reemplazo de texto en `index.html`, no un reparseo.
`npm run build` pasó de ~1 s a **~2 s**; importa, porque `mutaciones-visor.py` compila una
vez por mutación. `scripts/validar-html.mjs` (postbuild) comprueba el artefacto con 18
negativas: si alguna no la caza, el validador está roto y el build falla.

**Lo que no se veía y habría salido mal.** Google no indexa el HTML que llega sino el DOM
que queda después de ejecutar el JavaScript, y no baja un archivo de 49 MB: cada recurso
tiene un límite. `createRoot` borra lo horneado, `cargarPuntos` falla con el `.bin`
incompleto y la app dejaba la pantalla «No se pudieron cargar los datos del Catastro». Eso
es lo que Google habría guardado del sitio. Ahora la misma `<Portada>` se dibuja también
en la rama de carga (encima del mapa, bajo la píldora «Descargando…») y en la de error,
con el manifest, que llega antes que el `.bin` y pesa 636 kB. V-69 lo comprueba cortando
el `.bin` a 2 MB en el navegador.

**Se quitó `#arranque`**, la capa `position:fixed` que tapaba `#root` mientras cargaba. Con
texto horneado debajo, eso habría sido texto que leen los robots y no las personas:
ocultación. Su banda y su «Cargando…» viven ahora dentro de la portada; el aviso de 15 s
cambia el texto de esa línea en vez de destapar un párrafo oculto, que un asistente habría
leído igual.

**V-8 era una tautología.** `length >= 0 ? 0 : 1` da 0 siempre: la aserción «sin errores de
consola» salía verde sin mirar nada. Ahora cuenta las excepciones que Chrome reporta, y
una mutación (un `throw` en un efecto) la pone roja.

### M.9 Una página por región y por comuna

Un enlace al visor con `?com=14101` mostraba la vista previa de la portada, y ninguna URL decía
las cifras de una comuna sin ejecutar JavaScript. Ahora `npm run build:web` escribe **16 páginas
de región y 343 de comuna** (las 346 del país menos Juan Fernández, Isla de Pascua y Antártica,
que el Catastro publicado no trae), un índice con el `Dataset` y la Metodología, el
`sitemap.xml` (361 URL) y `web/indice.json`. Cada página lleva su frase citable, la tabla de
usos, sus bosques y tipos forestales, sus unidades del SNASPE, su canonical, su vista previa y
su JSON-LD. La de Panguipulli responde la pregunta de la línea base: **216.838 ha de bosque
nativo**, calculadas sobre la actualización 2024 de la región.

**Las cifras son las del panel por construcción**: `resumenYMarginales` con `filtroDelAmbito`,
las funciones del visor. Para no recorrer 1,8 M de filas 359 veces se le pasa a cada región el
subconjunto de sus filas en el mismo orden: el resultado es idéntico bit a bit, y se comprueba en
cada corrida contra la pasada completa (Valdivia, Santiago con un solo polígono, Magallanes con
polígonos sin comuna). Cuesta **~4,5 s** de cifras y ~7 s en total. Cada entidad cuadra con el
manifest: `n` exacto y `ha` con la tolerancia del oráculo del cruce (medido: ninguna comuna
difiere en más de 0,059 ha, porque el manifest suma en float64 y el `.bin` guarda float32).
`validar-paginas.mjs` recalcula polígonos y hectáreas con un oráculo propio, a pelo sobre las
columnas, y exige esos enteros en la frase de las 359 páginas.

**La frase de una comuna empieza siempre por «La comuna de X».** Seis comunas se llaman como su
región (Antofagasta, Coquimbo, Valparaíso, Maule, O'Higgins, Los Lagos), y «Valparaíso (Región de
Valparaíso) tiene 30.900 ha» se leería como la cifra de la región: el mismo defecto de §G. Por lo
mismo las URL van bajo `/region/…/` y `/comuna/…/`.

**La cifra oficial de una región va con el año de su planilla.** En Arica y Parinacota,
Antofagasta y Coquimbo ese año no es el de las capas; sin decirlo, la tabla pondría lado a lado
dos cifras de años distintos. Magallanes dice además que 4 polígonos, con 127.169 ha, no traen
comuna.

**PROPUESTA, a confirmar: los ceros.** 25 comunas no tienen ninguna hectárea clasificada como
bosque y 33 no tienen bosque nativo (Santiago tiene un solo polígono, de 2.310 ha). Una frase
«X no tiene bosque» la citaría un asistente como un hecho. La redacción publicada dice «el
Catastro no clasifica como bosque ningún polígono de la comuna de X (los rodales menores que la
unidad mínima cartografiable no se dibujan, así que eso no prueba que no los haya)». Si la Unidad
prefiere otra, es un cambio de una línea en `src/web/textos.js`.

**Las URL publicadas no desaparecen.** `scripts/slugs-publicados.json` es un registro sólo de
alta: el generador falla si una URL registrada ya no corresponde a nada, y si CONAF resuelve una
grafía en disputa (`14_REVISAR`: Coihaique, Calera, Mariquina…) la URL vieja pasa a ser un alias
que lleva a la nueva por su código. Los nombres se publican como vienen del manifest; aquí no se
resuelve ninguna grafía.

**El robots.txt de la raíz** queda escrito en `docs/robots-raiz.txt` y vigilado por
`scripts/robots.mjs` (lector RFC 9309, 8 negativas); el humo lo lee publicado y avisa mientras
no exista. **Lo que no se hace**: páginas por provincia (sólo existen como nombre, sin código),
estado de conservación en las páginas (sin validar contra el RCE) y `noindex` para `/datos/`
(Pages no deja poner cabeceras, y bloquearlo impediría a Googlebot renderizar).

## Fallos propios cometidos al establecer todo esto

Se dejan escritos porque el diagnóstico falso fue plausible y podría repetirse.

1. **Indexé `usos_comb` por el código de 6 dígitos, que no es clave única.** Las claves
   `040201`, `040202` y `040203` tienen **40 variantes** cada una. El `dict` conservó la
   última y el informe dijo que *todo* el país era `siempreverde`, con 509 872 filas
   supuestamente divergentes. Diagnóstico plausible y completamente falso. La corrección es
   derivar cada campo de su propio código.
2. Tres intentos de editar una línea con heredoc y `sed` la dejaron peor cada vez. A la
   tercera hay que cambiar de herramienta, no insistir.
3. **Di por cerrada la ambigüedad del conjunto vacío arreglando sólo `App.jsx`.** El mismo
   defecto vivía también en `resumenYMarginales`, que saltaba los filtros vacíos, y el visor
   siguió devolviendo la región entera para un ámbito imposible. Lo encontré probando el caso a
   mano; ninguna aserción lo cubría todavía. Arreglar la mitad de un defecto y declararlo cerrado
   es peor que no tocarlo, porque la siguiente persona lo lee como resuelto.
4. **Metí las seis dimensiones derivadas dentro de `sin_dato` del manifest** sin volver a correr
   `verificar_datos.py`. D13 declara que las claves de `sin_dato` son exactamente las columnas
   del `.bin` con centinela, y se puso roja con razón. Lo cazó el control positivo del mutador,
   no yo. Van en `sin_dato_derivado`.
5. **Al limpiar el panel dejé tres botones sin cuenta con un `.gf-total` vacío**, y V-17b los leyó
   como dimensiones con cero clases. El fallo era del componente, no de la aserción: Información,
   Descargar y Compartir no tienen clases que contar y ahora no dibujan ese hueco.
6. **Borré una sonda del mutador con un corte por índices y me llevé cinco por delante.** El
   archivo dejó de importar con `NameError`. Un `s[:a] + s[b:]` sobre un archivo grande no es una
   edición, es una apuesta.
7. **Escribí una guarda que no podía fallar.** La que decide si la copia del mapa salió vacía
   contaba píxeles con alfa > 0 — y como la propia función rellena el fondo antes de dibujar, el
   alfa vale 1 en toda la imagen y la medida daba 100 % siempre, también sobre un lienzo en blanco.
   Ahora compara contra el color más repetido.
8. **Y la arreglé mal a la primera:** muestreaba una rejilla de 9 px sobre discos de 1,2 px, así
   que encontraba el 0,48 % de lo que había y descartaba capturas correctas. Una malla más gruesa
   que aquello que busca no mide, sortea. Se muestrean filas enteras.
9. **Puse el botón del reporte dentro de un modal y no comprobé qué pasaba al abrirlo.** Un
   `<dialog>` modal pinta en la top layer: el reporte salía debajo del modal que lo había abierto,
   por mucho z-index que llevara.
10. **Inicialicé la columna de tramos con ceros.** Cualquier fila fuera de todos los cortes caía en
    silencio en la primera clase —«menos de 1 ha»—, el reparto seguía sumando 1.827.933 y las
    cifras seguían cuadrando entre sí. Lo destapó una mutación que acortaba el último tramo y pasó
    en VERDE con los polígonos de más de 10.000 ha metidos entre los de menos de una hectárea.
    Ahora el ETL revienta si queda una fila sin tramo, y **D27** exige además que las hectáreas de
    cada clase quepan entre sus propios cortes: comprobar que se reparte TODO no basta, hay que
    comprobar que se reparte DONDE TOCA.
