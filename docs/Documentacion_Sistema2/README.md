# Documentación del sistema — Visor del Catastro (v1.0, 2026-11-13)

Paquete documental del visor público del **Catastro de Usos de la Tierra y Recursos
Vegetacionales**: manual de usuario, casos de uso, checklist de QA, matriz de trazabilidad,
capturas y copia en PDF.

**Es la primera versión del paquete en este repositorio.** No existía
`docs/Documentacion_Sistema`; la carpeta se llama `Documentacion_Sistema2` por la convención
de la flota, no porque haya una versión anterior. Las fichas de QA parten todas en NOT TESTED.

## Qué leer primero

1. `00_Analisis/Analisis_y_Matriz_de_Roles.docx`: el sistema, el único rol, reglas, hallazgos
   (sección 7), sondas (7 ter) y cobertura calculada.
2. `01_Manuales/Manual_Rol_Usuario_Visor.docx`: el manual del usuario.
3. `02_Casos_de_Uso/`, `03_QA/` y `04_Trazabilidad/`.
4. `_pdf/`: los mismos documentos en PDF, con el índice calculado.

## Un solo rol

El visor es un sitio estático sin sesión: no hay roles en el código. Se documenta un rol,
«Usuario del visor» (cualquiera que lo abre). El ETL y la publicación no tienen pantalla y van
en «Roles que NO se documentan».

## Capturas con datos ficticios

Las 14 capturas de `_imagenes/` son del visor real compilado, pero con **datos ficticios**
(`scripts/demo_datos.py`: 40.000 puntos al azar con los vocabularios reales). Ninguna cifra de
superficie o de polígonos es del Catastro. `oficiales.json` y `simef.json` se dejaron tal cual
(cifras institucionales publicadas), por eso la «cifra oficial» no cuadra con la ficticia.
Chrome corrió sin red: las teselas del mapa base se reemplazaron por una lisa.

## Cifras

<!-- cifras -->
| Indicador | Valor |
|---|---|
| Versión | 1.0 (2026-11-13), primera del paquete en este repositorio |
| Roles documentados | 1 |
| Funcionalidades | 11 |
| Casos de uso (y fichas QA) | 18 |
| Funcionalidades con caso | 11 de 11 |
| Capturas | 14 |
| Páginas en PDF | 73 |
| &nbsp;&nbsp;Analisis_y_Matriz_de_Roles.pdf | 9 páginas |
| &nbsp;&nbsp;Casos_Uso_Rol_Usuario_Visor.pdf | 23 páginas |
| &nbsp;&nbsp;Checklist_QA_Casos_de_Uso.pdf | 15 páginas |
| &nbsp;&nbsp;Manual_Rol_Usuario_Visor.pdf | 26 páginas |
<!-- /cifras -->

## Cómo se regenera

Desde la raíz del repositorio (Windows, con Word para el PDF):

```
python scripts/generar_documentacion.py   # valida el mapeo y escribe DOCX + XLSX
python scripts/exportar_pdf.py            # índice, PDF y las cifras de este README
```

Capturas: generar los datos ficticios con `python scripts/demo_datos.py <carpeta>/frontend/public/datos`
sobre una COPIA de `frontend/` (fuera del repo), compilarla (`vite build`, `prerender.mjs`,
`web.mjs`), servir `dist/` bajo `/coipo_vista_catastro/` con un servidor estático local y
correr `python scripts/capturar_pantallas.py --url http://127.0.0.1:<puerto>/coipo_vista_catastro`.
Nunca contra el sitio publicado, y nunca escribir los datos ficticios en `frontend/public/datos`.

Todo el contenido vive en `scripts/docgen/` (`datos_base.py`, `rol_usuario_visor.py`,
`imagenes.py`); los DOCX son su salida y no se editan a mano.
