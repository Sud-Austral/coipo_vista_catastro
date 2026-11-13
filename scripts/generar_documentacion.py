# -*- coding: utf-8 -*-
"""Genera docs/Documentacion_Sistema2 completo desde scripts/docgen/.

    python scripts/generar_documentacion.py     (desde la raíz del repositorio)

Regenera todo: el contenido vive en scripts/docgen/, no en los DOCX. Antes de escribir,
corre las validaciones del mapeo (capturas, funcionalidades, reglas, ids) y se detiene
si alguna falla.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
for f in (sys.stdout, sys.stderr):
    f.reconfigure(encoding="utf-8")

from docgen.generar import (MODULOS, generar_analisis, generar_casos, generar_manual,  # noqa: E402
                            generar_qa, generar_trazabilidad, validar)


def main():
    errores = validar()
    if errores:
        print("VALIDACIÓN EN ROJO:")
        for e in errores:
            print("  -", e)
        sys.exit(1)
    print("Validaciones: 0 errores")
    rutas = [generar_analisis()]
    for mod in MODULOS:
        rutas += [generar_manual(mod), generar_casos(mod)]
    rutas += [generar_qa(), generar_trazabilidad()]
    for r in rutas:
        print("  %-70s %7.1f KB" % (r, os.path.getsize(r) / 1024))


if __name__ == "__main__":
    main()
