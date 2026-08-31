"""Carga las tablas de homologacion y las aplica como catalogo CERRADO.

Las tablas las entrego la Unidad de Informacion y Analisis en
`INSUMO/homologacion_catastro_1.xlsx`; aqui viven ya convertidas a CSV
versionados por `desde_xlsx.py`, mas un `adiciones.csv` con lo que el libro no
podia cubrir --las doce comunas de Los Rios, que no existian en los datos sobre
los que se construyo--.

TRES REGLAS, y las tres importan:

1. `revisar` NO SE APLICA. El libro marca asi los casos donde la grafia oficial
   difiere del dato por algo mas que un acento --Calera/La Calera,
   Coihaique/Coyhaique, Mariquina/San Jose de la Mariquina-- y dice
   expresamente «confirmar antes de aplicar». Aplicarlos de oficio seria que el
   ETL decidiera un asunto de nomenclatura oficial. El valor se queda como
   viene y el caso sigue abierto en 14_REVISAR.csv.

2. EL CATALOGO ES CERRADO. `exigir` revienta si el origen trae un valor que la
   tabla no nombra, con el valor en pantalla. Sin eso la tabla es una
   sugerencia: un dato nuevo se colaria sin homologar y nadie se enteraria.
   Es el mismo mecanismo que ya usa REGION_NOMBRE en build_bin.py.

3. NUNCA SE PLIEGA A MAYUSCULAS, ni aqui ni en ningun punto del proceso. El
   codigo de especie distingue caja y esa distincion es significativa: «AB» es
   Abies sp., «Ab» es Adesmia boronioides y «ab» es Calceolaria biflora. De los
   207 grupos que solo difieren en mayusculas, 206 son especies genuinamente
   distintas. Un upper() las fusionaria en silencio. Ver 13_NO_FUSIONAR.csv.

Y una cuarta, de lectura: estos CSV se leen con el modulo `csv`, que no
interpreta nada. Con pandas hay que pasar `keep_default_na=False` o el codigo de
especie del rauli --que es literalmente «NA»-- se convierte en nulo y se pierden
3.654 poligonos con 89.994,21 ha.
"""

import csv
import os

AQUI = os.path.dirname(os.path.abspath(__file__))

# Acciones que SI se aplican. `revisar` queda fuera a proposito (regla 1).
APLICABLES = {"sin_cambio", "ortografia", "fusion", "prefijo", "formato", "codificacion"}


def _leer(nombre):
    ruta = os.path.join(AQUI, f"{nombre}.csv")
    if not os.path.isfile(ruta):
        raise SystemExit(f"falta la tabla de homologacion: {ruta}")
    with open(ruta, encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def _adiciones(hoja):
    """Lo que anadimos NOSOTROS, en archivos aparte de los exportados.

    Dos formas, porque las hojas no comparten esquema:
      - `adiciones.csv`, con columna `hoja`, para las tablas de cinco columnas.
      - `adiciones_<hoja>.csv`, con la cabecera de esa hoja, para las anchas
        (12_especie tiene diez columnas, 15 tiene trece).

    Aparte de los CSV exportados y no dentro: son decisiones nuestras, no de la
    Unidad, y mezclarlas haria imposible saber quien decidio que. La proxima
    version del libro las pisaria sin dejar rastro.
    """
    filas = []
    propio = os.path.join(AQUI, f"adiciones_{hoja}.csv")
    if os.path.isfile(propio):
        with open(propio, encoding="utf-8", newline="") as fh:
            filas += list(csv.DictReader(fh))
    generico = os.path.join(AQUI, "adiciones.csv")
    if os.path.isfile(generico):
        with open(generico, encoding="utf-8", newline="") as fh:
            filas += [{k: v for k, v in f.items() if k != "hoja"}
                      for f in csv.DictReader(fh) if f["hoja"] == hoja]
    return filas


def tabla(hoja, clave="valor_origen", norm=None):
    """Las filas de una hoja, con las adiciones ya mezcladas, por valor de origen.

    Las adiciones van en su propio archivo y no dentro del CSV exportado porque
    son decisiones NUESTRAS, no de la Unidad: mezclarlas haria imposible saber
    quien decidio que, y la proxima version del libro las pisaria sin aviso.
    """
    filas = _leer(hoja) + _adiciones(hoja)
    out = {}
    for f in filas:
        v = norm(f[clave]) if norm else f[clave]
        if v in out and out[v] != f:
            raise SystemExit(f"homologacion {hoja}: «{v}» aparece dos veces con distinto destino")
        out[v] = f
    return out


def mapa(hoja, clave="valor_origen", destino="valor_canonico", norm=None):
    """origen -> canonico, ya aplicada la regla de `revisar`.

    `norm` normaliza la CLAVE de busqueda en los dos lados. Hace falta donde la
    tabla se consulta con una etiqueta y no con un codigo: la capa escribe la
    misma clase de altura como «2 - 4» y como «2 – 4» --guion tipografico-- y la
    tabla solo nombra una de las dos. Se le pasa el mismo `canon` que ya usa el
    ETL para agrupar, asi que la tabla hereda su tolerancia al ruido conocido:
    mayusculas, tildes, guiones tipograficos y saltos de linea.
    """
    return {
        v: (f[destino] if f.get("accion") in APLICABLES else f[clave])
        for v, f in tabla(hoja, clave, norm).items()
    }


def exigir(hoja, valores, etiqueta, clave="valor_origen", norm=None):
    """Revienta si el origen trae algo que la tabla no nombra.

    Ruidoso y con el valor delante: una tabla de homologacion que deja pasar lo
    que no conoce no homologa nada, solo da la impresion de hacerlo.
    """
    conocidos = set(tabla(hoja, clave, norm))
    fuera = sorted({v for v in valores
                    if v is not None and (norm(v) if norm else v) not in conocidos})
    if fuera:
        raise SystemExit(
            f"{etiqueta}: {len(fuera)} valores fuera del catalogo de homologacion "
            f"({hoja}). Anadelos a adiciones.csv o pide la tabla actualizada.\n  "
            + "\n  ".join(repr(v) for v in fuera[:20])
            + (f"\n  ... y {len(fuera) - 20} mas" if len(fuera) > 20 else ""))
    return True
