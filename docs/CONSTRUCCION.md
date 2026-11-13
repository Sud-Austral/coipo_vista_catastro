# Construcción con la fábrica

## 2026-11-13 · Documentación del sistema v1 (`docs/Documentacion_Sistema2`), rama `manueales2`

Tarea: generar el paquete documental (manual, casos de uso, checklist QA, trazabilidad,
capturas y PDF). No se tocó código de la app; se agregaron scripts de documentación en
`scripts/` (`generar_documentacion.py`, `exportar_pdf.py`, `capturar_pantallas.py`,
`docgen_demo_datos.py`, `docgen/`).

### Metodología consultada en IGNUS

Comando: `python coipo_mcp/mcp/llamar.py ver_metodologia '{"sombrero_id":"smb-metodologia-construir-una-aplicacion-coipo-con-la-fabrica","neo4j_instance":"conaf"}'`

- `success: true`, `orq: ORQ26_ver_metodologia`, **`correlation_id: corr-1794592900047-00011a98`**
- Sombrero: «Construir una aplicación COIPO con la fábrica», versión 1.0, estado vigente.
- Objetivos devueltos (núm., id, nombre):
  - 0 `obj-leer-el-encargo-y-la-fabrica-antes-de-nada-yqqp` · Leer el encargo y la fábrica antes de nada
  - 1 `obj-consultar-la-fabrica-antes-de-escribir-s4kt` · Consultar la fábrica antes de escribir
  - 2 `obj-sembrar-con-la-semilla-ji8z` · Sembrar con la semilla
  - 3 `obj-plan-de-implementacion-aprobado-yzoy` · Plan de implementación aprobado
  - 4 `obj-construir-por-capas-con-las-herramientas-fuera-del-producto-febv` · Construir por capas con las herramientas fuera del producto
  - 5 `obj-juzgarse-antes-de-decir-que-esta-08kn` · Juzgarse antes de decir que está
  - 6 `obj-antes-de-desplegar-y-registrar-lo-aprendido-gx9p` · Antes de desplegar y registrar lo aprendido
  - 7 `obj-revisar-la-interfaz-como-la-ve-la-persona-ipmc` · Revisar la interfaz como la ve la persona
  - 8 `obj-verificar-lo-publicado-despues-de-desplegar-itqi` · Verificar lo publicado después de desplegar
  - 100 `obj-enviar-correo-desde-una-aplicacion-coipo-gmail-api-con-bande-9trv` · Enviar correo desde una aplicación COIPO (Gmail API con bandeja de salida)
  - 101 `obj-autenticar-ciudadanos-con-clave-unica-en-una-aplicacion-coip-3n2b` · Autenticar ciudadanos con Clave Única en una aplicación COIPO

### Grafo consultado

Comando: `python coipo_mcp/mcp/consultar_grafo.py "documentacion manuales capturas"` (no
devuelve correlation_id). Salida literal:

```
grafo conaf · 2026-11-13 · terminos ['documentacion', 'manuales', 'capturas'] · repo todos · 2 seccion(es)
- COIPO_ERRORES/20260827/coipo-entrega-planta-documentacion-funcional-y-capturas.md · COIPO_ENTREGA_PLANTA — documentación funcional por rol, con capturas
    …r la API en el COIPO IAM, documentar la API del IAM, y generar el paquete `docs/Documentacion_Sistema/` (manuales por rol, casos de uso, checklist QA y matriz d…
- COIPO_ERRORES/20260827/coipo-entrega-planta-documentacion-funcional-y-capturas.md · 17. Entregué el paquete sin capturas
    ## 17. Entregué el paquete sin capturas  **Síntoma.** *«revise el contenido de Documentacion_Sistema y esta muy basico, necesita mas detalles y pantallazos»*.  …
```

Qué se aplicó: el paquete lleva capturas del visor real (compilado) mirando cada PNG, con
datos ficticios generados al azar (`scripts/docgen_demo_datos.py`), sin red y sin producción.
