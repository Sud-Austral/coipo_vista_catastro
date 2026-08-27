"""Lee en pandas EXACTAMENTE lo que el visor pinta: cbn_puntos.bin + manifest.json.

Es la contraparte en Python de frontend/src/datos/binario.js. Mismo contrato,
mismas validaciones, mismos centinelas -- y por eso ninguna cifra que salga de
aqui puede discrepar de la que muestra el visor sin que uno de los dos este roto.

    from ETL.leer_bin import cargar
    df = cargar()                 # 1.827.933 filas x ~30 columnas

POR QUE LEER EL .bin Y NO LA FUENTE. El .duckdb de origen esta en .gitignore y
no viaja con el repo: quien clona no lo tiene. El .bin si esta versionado, pesa
43,8 MB y contiene las 1,83 M de filas con sus trece atributos ya limpios,
desambiguados y validados contra las cifras oficiales (ver ETL/build_bin.py y
ETL/verificar_datos.py). Para casi todo analisis es la fuente correcta; lo que
NO trae es la geometria del poligono, solo su centroide.

NADA HARDCODEADO. Offsets, tipos, centinelas y vocabularios salen del manifest,
igual que en el frontend. Si el ETL cambia el vocabulario, este lector cambia
solo. Lo unico que se afirma aqui es el numero de esquema, y se afirma a gritos:
un manifest de otra version abre vistas tipadas perfectamente validas sobre
offsets equivocados y el resultado sale PLAUSIBLE, con los puntos desplazados.

TRES TRAMPAS QUE ESTE MODULO YA DESACTIVA, y que muerden a quien lee el .bin a
mano con np.fromfile:

  1. `ha` se guarda como f32 y AQUI SE PROMUEVE A f64. Sumar 1,83 M de float32
     acumula error de redondeo suficiente para mover el total nacional varias
     hectareas. Con f64 el total cuadra al decimal con manifest['total']['ha'],
     y `cargar(verificar=True)` lo comprueba en cada carga.

  2. Los CENTINELAS no son datos. comuna/especie usan 65535 y el resto 255. Sin
     traducirlos a NA, las 1.431.130 filas fuera del SNASPE se convierten en
     silencio en la unidad del indice 255, y las 779.738 sin altura en una clase
     de altura real. Aqui todos entran como NaN/NA.

  3. Las ETIQUETAS SE REPITEN entre codigos distintos ('Sin Informacion' esta en
     varios subusos, 'No Aplica' en varias estructuras). Por eso cada dimension
     sale DOS veces: `<campo>` con la etiqueta legible y `<campo>_cod` con el
     codigo oficial, que es el unico identificador univoco. Agrupa por _cod
     siempre que la cifra vaya a compararse con algo publicado.

LA TRAMPA QUE ESTE MODULO NO PUEDE DESACTIVAR, y que hay que tener presente en
cada agregacion: `groupby` de pandas DESCARTA los NA por defecto. Como 79.731
filas no tienen comuna --y por tanto tampoco region--, todo corte territorial
pierde en silencio 1.962.476,04 ha, el 2,59 % de la superficie nacional. Medido
sobre el bosque nativo: `bn.ha.sum()` da las 15.536.329,01 ha oficiales, pero
`bn.groupby('region').ha.sum().sum()` da 14.597.858,03 y la diferencia no aparece
por ninguna parte. Usa `groupby(..., dropna=False)` cuando el total tenga que
cuadrar, o comprueba el cuadre a mano. Lo mismo vale para snaspe (78,3 % NA,
que ahi significa 'fuera de area protegida', no 'se desconoce') y para altura
(42,7 %).

PRECISION DE LAS COORDENADAS: lon/lat son f32, o sea ~1 m a la latitud de Chile.
Sobra para agregar y para mapear, y NO alcanza para trabajo predial. Ademas cada
punto es el CENTROIDE de un poligono, no una parcela ni un predio: su posicion
representa al poligono entero y la superficie real esta en `ha`.

Uso desde la linea de comandos:
    python ETL/leer_bin.py                      resumen y chequeos
    python ETL/leer_bin.py --parquet salida.parquet
"""

import argparse
import hashlib
import json
import os
import sys

import numpy as np
import pandas as pd

ESQUEMA = 3

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATOS = os.path.join(RAIZ, "frontend", "public", "datos")

TIPOS = {"f32": np.float32, "u16": np.uint16, "u8": np.uint8}
ANCHO = {"f32": 4, "u16": 2, "u8": 1}

# Cada campo categorico del .bin, la lista del manifest que indexa, y los
# atributos de esa lista que se levantan a columna propia porque habilitan
# analisis que el codigo solo no permite (agregar por clase IPCC, filtrar por
# genero botanico, ordenar por altura sin inventarse la escala).
CATEGORICOS = {
    "uso": ("usos", ("ipcc",)),
    "subuso": ("subusos", ()),
    "estruc": ("estructuras", ()),
    "tifo": ("tipos_forestales", ("legal",)),
    "snaspe": ("snaspe", ("categoria",)),
    "cober": ("coberturas", ("orden",)),
    "altura": ("alturas", ("escala", "desde", "hasta")),
    "stifo": ("subtipos_forestales", ()),
    "especie": ("especies", ("cientifico", "genero")),
    "comuna": ("comunas", ("provincia",)),
}


def leer_manifest(datos=DATOS):
    """El contrato. Se valida el esquema antes de tocar un solo byte del .bin."""
    ruta = os.path.join(datos, "manifest.json")
    with open(ruta, encoding="utf-8") as fh:
        man = json.load(fh)
    if man.get("esquema") != ESQUEMA:
        raise ValueError(
            f"{ruta} declara esquema {man.get('esquema')} y este lector lee el {ESQUEMA}. "
            "Vuelve a generar los datos con `python ETL/build_bin.py`."
        )
    return man


def _categoria(codigos, entradas, clave, centinela):
    """Categorica de pandas a partir de indices del .bin.

    Deduplica las etiquetas repetidas antes de construirla: Categorical.from_codes
    exige categorias unicas, y 'Sin Informacion' aparece en varios subusos. Se
    remapea el indice del manifest al indice de la etiqueta unica, conservando el
    -1 que pandas entiende como ausente.
    """
    valores = [e[clave] for e in entradas]
    unicas = list(dict.fromkeys(valores))
    remapa = np.array([unicas.index(v) for v in valores], dtype=np.int32)

    idx = codigos.astype(np.int32)
    falta = idx == centinela if centinela is not None else np.zeros(len(idx), dtype=bool)
    # Un indice fuera de rango no es un centinela: es un .bin que no corresponde
    # a este manifest, y hay que verlo, no absorberlo.
    fuera = ~falta & (idx >= len(valores))
    if fuera.any():
        raise ValueError(
            f"{fuera.sum()} filas indexan fuera de la lista de {len(valores)} entradas. "
            "El .bin y el manifest.json no son de la misma corrida del ETL."
        )
    salida = np.where(falta, -1, remapa[np.where(falta, 0, idx)])
    return pd.Categorical.from_codes(salida, categories=unicas)


def _levantar(codigos, entradas, clave, centinela):
    """Sube un atributo del vocabulario a columna, alineado fila por fila."""
    valores = [e.get(clave) for e in entradas]
    numerico = all(v is None or isinstance(v, (int, float)) for v in valores)
    idx = codigos.astype(np.int64)
    falta = idx == centinela if centinela is not None else np.zeros(len(idx), dtype=bool)
    seguro = np.where(falta, 0, idx)

    if numerico:
        tabla = np.array([np.nan if v is None else float(v) for v in valores])
        return np.where(falta, np.nan, tabla[seguro])
    # Texto: categorica, que para 1,83 M de filas es la diferencia entre 15 MB
    # de codigos y ~150 MB de objetos Python sueltos.
    unicas = list(dict.fromkeys(v for v in valores if v is not None))
    orden = {v: i for i, v in enumerate(unicas)}
    remapa = np.array([-1 if v is None else orden[v] for v in valores], dtype=np.int32)
    return pd.Categorical.from_codes(np.where(falta, -1, remapa[seguro]), categories=unicas)


def cargar(datos=DATOS, etiquetas=True, verificar=True):
    """Devuelve el DataFrame con las 1,83 M de filas que pinta el visor.

    etiquetas=False deja solo los indices crudos del .bin: mas rapido y mas
    ligero, util cuando el analisis va a agregar por indice y traducir al final.
    verificar=False salta sha256 y el cuadre del total nacional.
    """
    man = leer_manifest(datos)
    capa = man["capas"]["cbn_puntos"]
    n = capa["filas"]
    campos = capa["campos"]
    ruta = os.path.join(datos, capa["archivo"])

    # Mismo chequeo que hace el frontend, y por el mismo motivo: un .bin de otro
    # tamano abre vistas tipadas validas sobre basura y pone los puntos en medio
    # del Pacifico sin dar ningun error.
    esperado = sum(ANCHO[c["tipo"]] * n for c in campos.values())
    real = os.path.getsize(ruta)
    if real != esperado:
        raise ValueError(
            f"{ruta} mide {real} bytes y el manifest declara {esperado}. "
            "El archivo esta truncado o es de otra version de los datos."
        )

    if verificar:
        h = hashlib.sha256()
        with open(ruta, "rb") as fh:
            for bloque in iter(lambda: fh.read(1 << 20), b""):
                h.update(bloque)
        if h.hexdigest() != capa["sha256"]:
            raise ValueError(
                f"sha256 de {capa['archivo']} no coincide con el manifest.\n"
                f"  en disco:  {h.hexdigest()}\n  manifest:  {capa['sha256']}"
            )

    # memmap y no fromfile: se abren vistas sobre el archivo y solo se copia la
    # columna que de verdad se materializa. Leer 3 columnas no cuesta 43,8 MB.
    crudo = {
        nombre: np.memmap(ruta, dtype=TIPOS[c["tipo"]], mode="r", offset=c["offset"], shape=(n,))
        for nombre, c in campos.items()
    }

    df = pd.DataFrame(
        {
            "lon": np.asarray(crudo["lon"], dtype=np.float32),
            "lat": np.asarray(crudo["lat"], dtype=np.float32),
            # f64 a proposito: ver la trampa 1 de la cabecera del modulo.
            "ha": np.asarray(crudo["ha"], dtype=np.float64),
        }
    )

    if not etiquetas:
        for nombre in CATEGORICOS:
            df[nombre] = np.asarray(crudo[nombre])
        return df

    for nombre, (voca, extras) in CATEGORICOS.items():
        entradas = man[voca]
        centinela = campos[nombre]["centinela"]
        codigos = np.asarray(crudo[nombre])
        df[nombre] = _categoria(codigos, entradas, "etiqueta", centinela)
        df[f"{nombre}_cod"] = _categoria(codigos, entradas, "cod", centinela)
        for extra in extras:
            df[f"{nombre}_{extra}"] = _levantar(codigos, entradas, extra, centinela)

    # Region: no es una columna del .bin, se deduce de la comuna. Se arma aqui
    # porque es el corte con el que se publica y se compara TODO en el Catastro,
    # y reconstruirlo en cada analisis invita a que dos analisis lo hagan
    # distinto. Ojo con lo que significa agregar por region: cada una se
    # actualizo en un ano distinto entre 2014 y 2024, asi que compararlas entre
    # si compara fotos de anos distintos.
    comunas = man["comunas"]
    regiones = {r["cod"]: r for r in man["regiones"]}
    cod_reg = [c["region"] for c in comunas]
    cent_com = campos["comuna"]["centinela"]
    codigos_com = np.asarray(crudo["comuna"])
    df["region_cod"] = _categoria(codigos_com, [{"c": r} for r in cod_reg], "c", cent_com)
    df["region"] = _categoria(
        codigos_com,
        [{"n": regiones.get(r, {}).get("nombre", r)} for r in cod_reg],
        "n",
        cent_com,
    )
    df["region_anio"] = _levantar(
        codigos_com,
        [{"a": regiones.get(r, {}).get("anio")} for r in cod_reg],
        "a",
        cent_com,
    )

    if verificar:
        # El cuadre que hace inutil discutir si el lector es fiel: la suma de las
        # 1,83 M de hectareas tiene que dar el total que el ETL publico.
        total = df["ha"].sum()
        oficial = man["total"]["ha"]
        if abs(total - oficial) > 0.5:
            raise ValueError(
                f"la suma de `ha` da {total:,.2f} y el manifest declara {oficial:,.2f}"
            )

    return df


def es(x, dec=0):
    """Formato chileno: punto de miles y coma decimal. Un total nacional escrito
    a la inglesa en un informe de CONAF se lee mal o, peor, se lee al reves."""
    return f"{x:,.{dec}f}".translate(str.maketrans({",": ".", ".": ","}))


# Nombre interno anterior; se conserva para no romper lo que ya lo importaba.
_es = es


def resumen(df, man):
    """Lo minimo para saber, de un vistazo, que se cargo lo correcto."""
    lin = []
    lin.append(f"filas          {_es(len(df))}")
    lin.append(f"columnas       {len(df.columns)}")
    lin.append(f"memoria        {_es(df.memory_usage(deep=True).sum() / 1e6, 1)} MB")
    lin.append(f"superficie     {_es(df['ha'].sum(), 2)} ha")
    lin.append(
        f"bbox           lon [{df.lon.min():.4f}, {df.lon.max():.4f}]"
        f"  lat [{df.lat.min():.4f}, {df.lat.max():.4f}]"
    )
    lin.append("")
    lin.append("sin dato por columna (centinela traducido a NA):")
    for nombre in CATEGORICOS:
        faltan = int(df[nombre].isna().sum())
        if faltan:
            lin.append(f"  {nombre:8} {_es(faltan):>9}  ({_es(100 * faltan / len(df), 1)} %)")
    lin.append("")
    lin.append("superficie por uso (ha), contrastada con la cifra del manifest:")
    por_uso = df.groupby("uso_cod", observed=True)["ha"].sum()
    oficial = {u["cod"]: u["ha"] for u in man["usos"]}
    etiq = {u["cod"]: u["etiqueta"] for u in man["usos"]}
    for cod, ha in por_uso.items():
        d = ha - oficial[cod]
        marca = "ok" if abs(d) < 0.5 else f"DIFIERE {d:+.2f}"
        lin.append(f"  {cod} {etiq[cod][:34]:34} {_es(ha, 2):>16}  {marca}")
    return "\n".join(lin)


def main():
    p = argparse.ArgumentParser(description="Lee cbn_puntos.bin en pandas.")
    p.add_argument("--datos", default=DATOS, help="carpeta con manifest.json y cbn_puntos.bin")
    p.add_argument("--parquet", metavar="RUTA", help="exporta el DataFrame a Parquet y termina")
    p.add_argument("--sin-verificar", action="store_true", help="salta sha256 y el cuadre de superficie")
    args = p.parse_args()

    man = leer_manifest(args.datos)
    df = cargar(args.datos, verificar=not args.sin_verificar)
    print(resumen(df, man))

    if args.parquet:
        # Parquet y no CSV: conserva los tipos y las categoricas, pesa ~15x menos
        # y lo abren duckdb, polars, R y QGIS sin adaptador.
        df.to_parquet(args.parquet, index=False, compression="zstd")
        print(f"\nescrito {args.parquet} ({os.path.getsize(args.parquet) / 1e6:,.1f} MB)")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
