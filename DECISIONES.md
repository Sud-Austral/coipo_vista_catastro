# Decisiones sobre los datos

Bitácora de las decisiones que **no** son automatizables y de las que sí lo son pero
requieren justificación. Cada una dice qué se decidió, con qué evidencia medida, y cuántas
filas y hectáreas afecta. Reproducir: `python ETL/analisis_codigos.py`.

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

## Fallos propios cometidos al establecer todo esto

Se dejan escritos porque el diagnóstico falso fue plausible y podría repetirse.

1. **Indexé `usos_comb` por el código de 6 dígitos, que no es clave única.** Las claves
   `040201`, `040202` y `040203` tienen **40 variantes** cada una. El `dict` conservó la
   última y el informe dijo que *todo* el país era `siempreverde`, con 509 872 filas
   supuestamente divergentes. Diagnóstico plausible y completamente falso. La corrección es
   derivar cada campo de su propio código.
2. Tres intentos de editar una línea con heredoc y `sed` la dejaron peor cada vez. A la
   tercera hay que cambiar de herramienta, no insistir.
