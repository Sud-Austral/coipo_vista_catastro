"""Rompe el CODIGO del cruce a proposito y exige que `marginales.mjs` se entere.

Para que sirve, y por que no basta con `marginales.mjs --negativas`:

  - `--negativas` corrompe el RESULTADO y comprueba que el comparador lo caza.
    Verifica la prueba, no el codigo.
  - Esto corrompe el CODIGO FUENTE de `resumenYMarginales`, una linea cada vez, y
    comprueba que la prueba se entera. Verifica que la prueba PROTEGE de verdad
    lo que dice proteger.

La diferencia no es teorica: la primera version de `marginales.mjs` pasaba en
VERDE con la casilla del centinela rota. Comparaba las clases reales, y las filas
sin dato caian fuera del acumulador --un indice 255 sobre un Int32Array de 10 se
descarta en silencio-- asi que las clases salian identicas y solo mentian los
pies del panel. Lo encontro esta herramienta, no la prueba.

Hay un CONTROL POSITIVO entre las mutaciones: desactivar el atajo de "una sola
dimension" cambia el coste pero no el resultado, y tiene que salir VERDE. Si
saliera roja, la prueba estaria atada a la implementacion en vez de al
comportamiento, y estorbaria en el primer refactor.

NO va en el CI: parchea archivos del repo. Se corre a mano despues de tocar el
cruce, y restaura siempre, pase lo que pase.

Uso:  python frontend/verificacion/mutaciones.py
"""

import os
import shutil
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.dirname(AQUI)
OBJETIVO = os.path.join(FRONTEND, "src", "indicadores.js")
sys.stdout.reconfigure(encoding="utf-8")

# (que se rompe, parches, tiene que ponerse roja)
MUTACIONES = [
    ("el marginal deja de sumar lo que solo falla en su dimension",
     [("      d.mCuenta[j] = d.cuenta[j] + d.xCuenta[j]",
       "      d.mCuenta[j] = d.cuenta[j]")], True),
    ("el atajo de «una sola dimension» se aplica con dos",
     [("  const soloUna = na === 1", "  const soloUna = na <= 2")], True),
    ("el corte temprano deja pasar filas con dos fallos",
     [("        if (fallos > 1) break", "        if (fallos > 2) break"),
      ("    if (fallos > 1) continue", "    if (fallos > 2) continue")], True),
    ("el centinela deja de tener casilla propia",
     [("        const j = v === a.cent ? a.k : v\n        a.cuenta[j] += 1",
       "        const j = v\n        a.cuenta[j] += 1")], True),
    ("la mascara marca tambien las filas que fallan una",
     [("      mascara[i] = 1\n      nTotal += 1", "      nTotal += 1")], True),
    ("(control) desactivar el atajo no debe cambiar el resultado",
     [("  const soloUna = na === 1", "  const soloUna = false")], False),
]


def main():
    copia = tempfile.mkdtemp(prefix="mutaciones-")
    shutil.copy2(OBJETIVO, os.path.join(copia, "indicadores.js"))
    fallos = []
    try:
        for etiqueta, parches, espera_rojo in MUTACIONES:
            shutil.copy2(os.path.join(copia, "indicadores.js"), OBJETIVO)
            s = open(OBJETIVO, encoding="utf-8").read()
            encaja = True
            for viejo, nuevo in parches:
                if viejo not in s:
                    print(f"  !! el parche ya no encaja: {viejo[:55]!r}")
                    encaja = False
                    continue
                s = s.replace(viejo, nuevo, 1)
            if not encaja:
                # Un parche que no encaja NO es un aprobado: significa que el
                # codigo cambio y esta mutacion dejo de comprobar nada.
                fallos.append(f"{etiqueta} (el parche no encaja)")
                continue
            open(OBJETIVO, "w", encoding="utf-8").write(s)

            r = subprocess.run([shutil.which("node") or "node", "verificacion/marginales.mjs"],
                               cwd=FRONTEND, capture_output=True, text=True,
                               encoding="utf-8", errors="replace")
            rojo = r.returncode != 0
            acierto = rojo == espera_rojo
            if not acierto:
                fallos.append(etiqueta)
            cuantos = sum(1 for l in (r.stdout or "").splitlines() if "FALLA" in l)
            print(f"  {'OK  ' if acierto else 'MAL '} {etiqueta[:60]:<60} -> "
                  f"{'ROJA' if rojo else 'verde'}" + (f" ({cuantos} casos)" if rojo else ""))
    finally:
        shutil.copy2(os.path.join(copia, "indicadores.js"), OBJETIVO)
        shutil.rmtree(copia, ignore_errors=True)
        print("\noriginal restaurado")

    if fallos:
        print(f"{len(fallos)} SIN CAZAR: la prueba no protege de " + "; ".join(fallos))
        return 1
    print("TODO CORRECTO: cada forma de romper el cruce pone roja la prueba")
    return 0


if __name__ == "__main__":
    sys.exit(main())
