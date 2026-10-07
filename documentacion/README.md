# documentacion/

Manual del visor y registro de cambios aplicados a los datos, para enviar fuera
del equipo.

| Archivo | Qué es |
|---|---|
| `visor_catastro.pdf` | El entregable. 43 páginas, dos partes. |
| `visor_catastro.tex` | La fuente. Se compila con Tectonic (XeTeX). |
| `correo.md` | Texto del correo para acompañarlo, en versión larga y breve. |
| `ejemplo-reporte-del-visor.pdf` | El reporte que genera el propio visor, sin filtros. Sirve de muestra. |
| `img/` | Capturas del sitio publicado, tomadas el 22-09-2026. |

## Regenerar el PDF

```bash
cd documentacion
tectonic -X compile visor_catastro.tex
```

Tarda unos segundos. La primera vez descarga los paquetes de LaTeX que necesita.

**Comprobar que salió bien no es que termine con código 0.** Tectonic escribe el
PDF igual aunque la fuente no tenga un carácter: lo deja en blanco. Hay que
mirar dos cosas:

```bash
tectonic -X compile visor_catastro.tex > compila.log 2>&1
grep -o 'could not represent character "[^"]*"' compila.log | sort | uniq -c
grep -c "Overfull \\\\hbox" compila.log
```

Ambas deben dar cero. En el estado actual las dos dan cero.

## Notas de composición

- **La fuente es Calibri**, no Open Sans (la institucional): Open Sans sólo se
  distribuye como fuente variable y XeTeX no sabe instanciar sus ejes, así que
  se quedaría sin negrita ni cursiva reales.
- **El verde `#064928` sale del propio visor** (`frontend/src/index.css`), igual
  que los nueve colores de la tabla de clases de uso, que se copiaron de
  `COLOR_USO` en `frontend/src/config.js`.
- **`☰` no existe en Consolas.** Si se vuelve a necesitar un icono de menú, hay
  que cambiar de fuente para ese carácter o describirlo con palabras, que es lo
  que hace hoy el texto.

## De dónde salen las cifras

Ninguna está escrita de memoria. Las del dato publicado salen de
`frontend/public/datos/manifest.json` y de `cbn_puntos.bin`; las del antes/después
salen de consultar la base de origen `data/catastro_gef_singeometria.duckdb`; y
las de la interfaz, de recorrer el sitio publicado en un navegador.

Si se regeneran los datos con `python ETL/build_bin.py`, **las cifras de este
documento caducan** y hay que rehacerlas contra el nuevo manifest.
