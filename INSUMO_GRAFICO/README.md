# INSUMO_GRAFICO — material gráfico del panel COIPO IAM

Fuente de verdad del material gráfico: el asset recibido, todo lo que se derivó de él, y la
evidencia de que la maqueta quedó bien. Nada de esto tiene datos personales — a diferencia de
`INSUMO/`, que está en `.gitignore` justamente porque sí los tiene.

El material llegó del **Consolidador Previred**, donde este banner se integró primero.
`implementacion_banner.md` es portable a propósito y se mantiene así; lo que se reescribió al
aterrizarlo aquí es la tabla de rutas de este README, porque las del proyecto anterior
(`App.css`, `components/Banner.jsx`, tokens en `index.css`) no existen en COIPO.

⚠️ **`banner3.jpg` se rediseñó conservando el nombre de archivo.** El asset actual es un banner
de cabecera web (17,13:1); el anterior era un membrete de documento (10,39:1). **El nombre no te
avisa de nada**: si heredas un CSS o unas medidas escritas contra el membrete, sus números están
todos mal. Por eso la copia que usa la app se llama `banner-conaf-uia.jpg`.

## Qué hay aquí

| Archivo | Qué es |
| --- | --- |
| `banner3.jpg` | **Original recibido, intacto.** 3032 × 177, 50 055 B. Es la procedencia; no se toca. |
| `implementacion_banner.md` | Prompt reutilizable para integrar un banner institucional en cualquier stack, con el anexo de medidas de este asset. Portable: sirve para otros proyectos tal cual. |
| `derivados/favicon-32.png` | 32 × 32. Isotipo CONAF recortado del banner sobre `#064928`. |
| `derivados/apple-touch-icon-180.png` | 180 × 180, mismo recorte. |
| `verificacion/` | Salida de `npm run verify:banner` en este repo: los seis anchos, el caso sin imagen, la marca ampliada ×4 a 390 px, las dos capturas de la app real y `medidas.json`. Línea base visual. |

No hay copia del banner en `derivados/`: la que usa la app es `frontend/src/assets/banner-conaf-uia.jpg`
y tiene los mismos bytes que `banner3.jpg` (SHA-256 `2f5d01a9…22f70`). Tres copias del mismo archivo
son 150 KB de lo mismo.

## Dónde vive cada cosa en el proyecto

| Qué | Dónde |
| --- | --- |
| El asset que compila Vite | `frontend/src/assets/banner-conaf-uia.jpg` (importado desde JS: hash de contenido y base resuelta sola) |
| El componente | `frontend/src/components/layout/Banner.jsx` |
| Dónde sale y dónde no | El banner cuelga de `AppLayout`, y en `App.jsx` `/login` y `/registro` viven **fuera** de él: sale en el panel autenticado, no en las pantallas públicas. No hay condicional; es el árbol de rutas |
| El isotipo de login y registro | `frontend/src/components/ui/IsotipoConaf.jsx` + `frontend/src/assets/isotipo-conaf.png` (mismo recorte que el apple-touch-icon) |
| Los números de la maqueta | `frontend/src/styles/tokens.css` → `--banner-ratio`, `--banner-min-height`, `--banner-bg` |
| La decisión de paleta, escrita | comentario de `.app-banner` en `frontend/src/styles/components.css` |
| El apilado banner + shell | `frontend/src/styles/base.css` → `.app-frame` / `.app-shell` |
| Los iconos que se publican | `frontend/public/favicon.png`, `frontend/public/apple-touch-icon.png` |
| Cómo se generan los iconos | **A mano**, con la caja de recorte de la tabla de abajo. No hay script: los PNG entregados ya están aceptados y el asset está congelado, así que un generador solo produciría archivos idénticos. |
| Cómo se verifica | `frontend/scripts/verify-banner.mjs` (`npm run verify:banner`). No corre en CI: el único workflow del repo (`deploy-prod.yml`) delega en un reusable externo y no hay job de frontend. |

## Medidas, en una tabla

Verificadas píxel a píxel sobre `banner3.jpg`. Si el asset cambia, **hay que volver a medirlas**.

| Dato | Valor |
| --- | --- |
| Tamaño y razón | 3032 × 177, **17,1299:1** |
| Campo izquierdo (bajo la marca) | `#15301d` |
| Campo principal | `#064928` |
| Filete, **sólo en el borde superior** | azul `#0e69b0` en x 67–169, rojo `#eb3d49` en x 170–283, filas y 1–14 |
| Remate decorativo derecho | `#5e8f19` / `#388429`, desde x = 2745 |
| Zona segura para cortar sin costura | 858 ≤ x ≤ 2744 |
| Marca (isotipo + logotipo UIA) | hasta x = 540 (17,8 % izquierdo) |
| Isotipo CONAF: copa | x 105–189, y 51–99 |
| Isotipo CONAF: tronco | x 134–157, y 100–125 |
| Palabra "conaf" | desde x ≈ 155, y 100–135 |
| Recorte del favicon | x 105–190, y 51–127, tapando x 153–190 / y 97–127 con `#064928` |

⚠️ Los valores del filete difieren unas unidades entre este README (`#0e69b0`/`#eb3d49`) y el anexo
de `implementacion_banner.md` (`#0c6bad`/`#f03c47`): es el mismo color leído en píxeles distintos.
Por eso `verify-banner.mjs` compara con **tolerancia Manhattan 60**, nunca por igualdad.

## Qué mide `npm run verify:banner`

Los seis anchos, con el alto pintado medido por dos vías que deben coincidir
(`getBoundingClientRect` en página y un barrido de la columna `0,75 × W` sobre el PNG capturado):

| viewport | alto pintado | columna del asset en el borde derecho |
| --- | --- | --- |
| 1920 | **112 px** | 3032 (sin recorte) |
| 1366 | **80 px** | 3032 (sin recorte) |
| 1165 | **68 px** | 3032 (justo en el cruce) |
| 1110 | **68 px** | 2889 (peor caso: 144 columnas dentro del remate) |
| 768 | **68 px** | 1999 (zona segura) |
| 390 | **68 px** | 1015 (zona segura) |

Más el filete azul→rojo íntegro y en orden en la fila `y=2` de los seis, y el caso sin imagen
(fondo `rgb(6,73,40)`, nunca blanco). Lo que el script **no** puede juzgar y hay que mirar:
`captura-banner-390-marca-x4.png` (¿se leen las tres líneas del logotipo UIA?) y
`captura-banner-1110.png` (¿es aceptable el corte del remate?).

El 1110 no está en la matriz del insumo; se añadió aquí porque es el ancho donde el piso corta más
adentro del remate decorativo, y «se ve bien» no es un juicio fiable sobre eso.

## Si el banner cambia

1. Reemplazar `banner3.jpg` y **volver a medirlo** (§1 de `implementacion_banner.md`).
2. Copiarlo a `frontend/src/assets/banner-conaf-uia.jpg`.
3. Actualizar `--banner-ratio` y `--banner-min-height` en `frontend/src/styles/tokens.css`, y las
   constantes `RATIO` / `MIN_H` / `FILETE_*` de `frontend/scripts/verify-banner.mjs`.
4. Regenerar los dos PNG de `derivados/` con la caja de recorte de la tabla de arriba (sharp o
   Pillow; hay que tapar la palabra «conaf» con `#064928` **antes** de reducir, no después) y
   copiarlos a `frontend/public/`.
5. `npm run build && npm run verify:banner`, **mirar** `captura-banner-390-marca-x4.png`, y dejar
   las capturas nuevas en `verificacion/`.
