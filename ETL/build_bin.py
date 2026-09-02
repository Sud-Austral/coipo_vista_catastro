"""Emite la capa de render (nivel N2) que consume el visor.

Salida en frontend/public/datos/:
    cbn_puntos.bin   columnar puro, sin cabecera, little-endian
    manifest.json    el CONTRATO con el frontend: offsets, dominios, cifras

FORMATO DEL .bin -- regla de oro: primero los campos de 4 bytes, luego los de 2,
luego los de 1. Con N filas los offsets quedan siempre alineados al tamano de su
tipo. Romper ese orden lanza RangeError al construir la vista tipada.

    offset  0N   lon     Float32Array[N]   EPSG:4326
    offset  4N   lat     Float32Array[N]   EPSG:4326
    offset  8N   ha      Float32Array[N]   SUPERF_HA
    offset 12N   comuna  Uint16Array[N]    indice en manifest.comunas, 65535 = sin dato
    offset 14N   especie Uint16Array[N]    indice en manifest.especies, 65535 = sin dato
    offset 16N   uso     Uint8Array[N]     indice en manifest.usos
    offset 17N   subuso  Uint8Array[N]     indice en manifest.subusos, 255 = sin dato
    offset 18N   estruc  Uint8Array[N]     indice en manifest.estructuras, 255 = sin dato
    offset 19N   tifo    Uint8Array[N]     indice en manifest.tipos_forestales (sin centinela:
                                           «no aplica» es la clase '00')
    offset 20N   snaspe  Uint8Array[N]     indice en manifest.snaspe, 255 = fuera del SNASPE
    offset 21N   cober   Uint8Array[N]     indice en manifest.coberturas, 255 = sin dato
    offset 22N   altura  Uint8Array[N]     indice en manifest.alturas, 255 = sin dato
    offset 23N   stifo   Uint8Array[N]     indice en manifest.subtipos_forestales (sin
                                           centinela: «no aplica» es una clase)
    offset 16N   radio   Uint16Array[N]    radio del disco EN METROS, ya recortado
    offset 18N   uso …                        (las nueve columnas de 1 byte corridas 2N)
    offset 26N   region  Uint8Array[N]     indice en manifest.regiones (sin centinela: reg_cod
                                           esta poblado en las 1.827.933 filas)
                                           total = 27 bytes por fila

EL RADIO SE PUBLICA, no se calcula en el cliente, y la razon es que YA NO ES
FUNCION DE UNA SOLA FILA. Era `sqrt(ha*10000/pi)` --el circulo de igual area-- y
eso se calculaba en el navegador sin costar nada. Pero circulos de la misma area
que celdas que TESELAN el territorio tienen que solaparse: medido, el 56 % de los
puntos invadia a su vecino, y en Valdivia a z13 el 45 % de los centros quedaba
debajo de un disco mayor. Ninguna escala uniforme lo arregla -- ni al decimo:
al 0,1 seguian solapando 28.718 puntos.

Lo que si lo arregla, y de forma demostrable, es recortar cada radio a la MITAD
de la distancia a su vecino mas cercano: si r_i <= d_ij/2 y r_j <= d_ij/2 para
todo par, entonces r_i + r_j <= d_ij y no hay solape. Eso exige una consulta
espacial sobre 1,8 M de puntos --cKDTree, 0,9 s medido-- que no tiene sentido
repetir en cada navegador, y que ademas D26 comprueba desde fuera sobre lo
publicado.

LA REGION VA EN COLUMNA PROPIA, y no se deriva de la comuna. Se derivaba, y esa
indireccion publico cifras NACIONALES bajo el rotulo «Los Rios» durante meses:
las 79.727 filas de esa region llegaban sin comuna, el conjunto de comunas del
ambito salia vacio, y un conjunto vacio significa «todas» en el cliente. Con
columna propia el nivel region filtra directo, y los 4 poligonos de Magallanes
que no tienen comuna --«Areas no Reconocidas», 127.168,89 ha-- vuelven a contar
en su region, que es el hallazgo H4 del informe de la Unidad.

LAS ETIQUETAS SALEN DEL CODIGO SIEMPRE QUE HAYA CODIGO, y donde no lo hay, de
una TABLA DE HOMOLOGACION revisada --ETL/homologacion/--, nunca de una
heuristica sobre el texto. Cinco dimensiones no tienen codigo utilizable
(altura, subtipo forestal, especie, SNASPE, comuna) y para esas manda la tabla.
Decia «nunca del texto», a secas, y era falso desde el primer dia. Medido sobre las 1.827.933
filas: agregando por codigo, las cuatro estructuras del bosque nativo suman
15.536.329,01 ha, que es EXACTAMENTE su total -- diferencia +0,00. Agregando por
texto faltaban 95.626 ha, que resultaron ser Coquimbo entera (48.474,86, escrita
'Bosque Adulto') y Arica entera (47.151,34, 'Bosque Adulto/Renoval'). El texto no
esta un poco sucio: esta sucio por region.

Y EL VOCABULARIO SALE DE LA GUIA OFICIAL, NUNCA DE LOS DATOS. Construyendolo
desde los datos, un codigo que la guia no nombra no se detecta jamas y acaba en
pantalla con su numero crudo por etiqueta.

TRES EXCEPCIONES DOCUMENTADAS, y son excepciones porque la guia NO las nombra:
altura, subtipo forestal y especie. Para las tres el vocabulario sale del dato y
se declara asi en el manifest (`vocabulario: "datos"`), para que nadie lo lea
como oficial. Medido, para justificar de donde sale cada una:

  * COBERTURA -> del CODIGO. La guia no reparte codigo por codigo, pero SI lista
    el vocabulario ("Denso, Semidenso, Abierto, Muy Abierto, Escaso") y su orden
    coincide con el de los codigos 01..05. Eso se COMPRUEBA (ver verificar_datos
    D17), no se supone. El texto trae 12 grafias para 6 codigos.

  * ALTURA -> del CODIGO, etiquetada con su grafia mayoritaria. El texto trae 24
    grafias para 12 codigos, con '\n' y guiones tipograficos dentro. OJO: son DOS
    ESCALAS. A-F (2 a >32 m) mide Bosques, G-I (0 a 2 m) mide Praderas y
    Matorrales, y J/K ('<2', '>2') son una escala gruesa que SE SOLAPA con las
    otras dos. Ponerlas en un solo eje ordenado seria falso, asi que cada clase
    declara `escala` y el frontend las separa.

  * SUBTIPOFOR -> del TEXTO. Aqui el codigo NO sirve: ID_STIF tiene 10 codigos
    para 39 subtipos, y usar (ID_TIFO, ID_STIF) como clave compuesta lo empeora
    (12 combinaciones ambiguas de 37, frente a 10 del codigo solo).

  * ESPECIE -> del CODIGO ID_ESP1 (991 codigos, solo 16 ambiguos). El nombre
    COMUN no sirve de clave: tiene 347 grafias canonicas para esas 991 especies
    porque 'eucalipto' son muchas. Se publica el nombre cientifico y el comun.
    Es la especie PRINCIPAL del poligono, y que eso baste lo confirma la propia
    planilla oficial de plantaciones por especie: asignando el poligono entero a
    la especie 1 salen 1.714.737,31 ha de Pinus radiata contra 1.714.736,78
    oficiales, y Prosopis tamarugo y Pseudotsuga menziesii cuadran al centimo.

CENTINELAS: cada columna que puede no tener valor declara el suyo en el manifest
y sus filas se CUENTAN aparte. Sin centinela, las filas sin codigo de estructura
se convertirian en silencio en la estructura del indice 0.

MEMORIA: nada de to_pylist() sobre columnas de 1,8 M -- ya reviento con
MemoryError. Las claves compuestas se arman en SQL, las categoricas se traducen
con el diccionario de Arrow, y los agregados salen de np.bincount en vez de una
mascara booleana por categoria (331 comunas x 1,74 MiB tambien reviento).

Determinismo: sin ORDER BY (el orden natural de la vista union es estable con
preserve_insertion_order=true) y sin ninguna marca de tiempo en el manifest.

Uso:  python ETL/build_bin.py [--check]
"""

import argparse
import hashlib
import json
import math
import os
import re
import sys
import unicodedata

import duckdb
from scipy.spatial import cKDTree

import homologacion as H
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(RAIZ, "data", "catastro_gef_singeometria.duckdb")
SALIDA = os.path.join(RAIZ, "frontend", "public", "datos")

SIN_U8 = 255
SIN_U16 = 65535

# Codigos oficiales de USO, en ORDEN DE CODIGO y jamas por frecuencia: el indice
# viaja en el .bin y en la URL compartible, asi que reordenarlo por frecuencia
# haria que un enlace guardado apuntase a otro uso tras cualquier reproceso.
USOS = ["01", "02", "03", "04", "05", "06", "07", "08", "09"]

# Estatus legal. SOLO se rotula lo que se puede citar: Alerce y Araucaria son
# Monumento Natural por decreto. Cipres de la Cordillera, Cipres de las
# Guaitecas y Palma Chilena tienen figuras que NO estan verificadas, asi que no
# se rotulan. Y no existe ninguna categoria llamada "proteccion especial": es
# una invencion, y con ella se cae la cifra de 1.080.187 ha que la acompanaba.
ESTATUS_LEGAL = {
    "Alerce": "Monumento Natural (D.S. 490/1976, MINAGRI)",
    "Araucaria": "Monumento Natural (D.S. 43/1990, MINAGRI)",
}

# Nombres de region. La columna reg_nombre viene normalizada a ASCII
# ('Aysen', 'Biobio', 'Nuble', 'La Araucania'), y eso no puede llegar a
# pantalla: son nombres propios mal escritos. NOM_REG si trae tildes pero tiene
# tres valores defectuosos, asi que la fuente es este diccionario curado.
#
# `corto` es lo que cabe en un panel de 320 px; `oficial` es el nombre completo
# de la Ley 21.074, que viaja al title, al CSV y al PDF. En los toponimos
# chilenos el articulo es parte del nombre propio: Los Rios, La Araucania.
REGION_NOMBRE = {
    "15": ("Arica y Parinacota", "Región de Arica y Parinacota"),
    "01": ("Tarapacá", "Región de Tarapacá"),
    "02": ("Antofagasta", "Región de Antofagasta"),
    "03": ("Atacama", "Región de Atacama"),
    "04": ("Coquimbo", "Región de Coquimbo"),
    "05": ("Valparaíso", "Región de Valparaíso"),
    "13": ("Metropolitana", "Región Metropolitana de Santiago"),
    "06": ("O'Higgins", "Región del Libertador General Bernardo O'Higgins"),
    "07": ("Maule", "Región del Maule"),
    "16": ("Ñuble", "Región de Ñuble"),
    "08": ("Biobío", "Región del Biobío"),
    "09": ("La Araucanía", "Región de La Araucanía"),
    "14": ("Los Ríos", "Región de Los Ríos"),
    "10": ("Los Lagos", "Región de Los Lagos"),
    "11": ("Aysén", "Región de Aysén del General Carlos Ibáñez del Campo"),
    "12": ("Magallanes", "Región de Magallanes y de la Antártica Chilena"),
}

# Los seis ejes con los que se puede filtrar la VEGETACION, y no el poligono.
# Salen de la hoja 15 del libro de homologacion, que clasifica las 989 especies
# del Catastro. No son columnas del .bin y no engordan la descarga: son funcion
# del codigo de especie, que ya viaja, asi que se derivan --aqui para las cifras
# del manifest, y en el cliente para filtrar--. Mandarlas en el .bin serian
# ~9 MB por un dato que cabe en 989 filas de manifest.
#
# EL ORDEN DEL DOMINIO LO FIJA ESTE SCRIPT y el cliente lo lee del manifest. No
# se ordena en los dos sitios: 'Si' y 'En Peligro Critico' llevan tilde, y el
# orden de JS y el de Python no tienen por que coincidir en eso.
# Tramos de superficie del poligono. LOS CORTES VIVEN AQUI Y SE PUBLICAN en el
# manifest, para que el cliente los aplique en vez de repetirlos: dos listas de
# numeros iguales en dos lenguajes son dos listas que se desincronizan.
#
# Escala logaritmica porque la distribucion lo es: la mediana son 2,8 ha y el
# maximo 1.295.122. Medido con estos cortes, el reparto dice algo por si solo --
# el 1 % de los poligonos de 500 ha o mas concentra el 59,6 % de la superficie,
# y el 62 % que baja de 5 ha apenas suma el 2,4 %.
TRAMOS_HA = (
    (0.0, 1.0, "menos de 1 ha"),
    (1.0, 5.0, "1 - 5 ha"),
    (5.0, 20.0, "5 - 20 ha"),
    (20.0, 100.0, "20 - 100 ha"),
    (100.0, 500.0, "100 - 500 ha"),
    (500.0, float("inf"), "500 ha o más"),
)

DERIVADAS_ESPECIE = (
    ("grupos", "grupo"),
    ("habitos", "habito"),
    ("arboreas", "arboreo"),
    ("origenes", "origen"),
    ("invasoras", "invasora"),
    ("conservaciones", "conservacion"),
)

CATEGORIAS_SNASPE = ("Parque Nacional", "Reserva Nacional", "Monumento Natural")

# Cuatro unidades traen la categoria mal escrita o vacia en la capa de origen.
# Verificado consultando la base: son exactamente estas cuatro y ninguna otra.
# La correccion NO se aplica en silencio: viaja al manifest y de ahi al panel de
# metodologia.
CORRECCION_SNASPE = {
    "Pan de Azúcar": "Parque Nacional",                       # sin categoria (69 pol)
    "Pinguino de Humboldt": "Reserva Nacional",               # "Reserva Natural" (24)
    "Monumentro Nacional Lahuen Ñadi": "Monumento Natural",   # y errata en el nombre (20)
    "Mon. Natural Islotes de Puñihuil": "Monumento Natural",  # "Monumento Nacional" (6)
}


def sha256(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as fh:
        for bloque in iter(lambda: fh.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def indexar(valores):
    """valor -> indice, y la lista ordenada. Se ordena por el CODIGO para que el
    indice sea estable entre reprocesos."""
    orden = sorted(v for v in valores if v is not None)
    return {v: i for i, v in enumerate(orden)}, orden


def canon(s):
    """Grafia canonica para agrupar variantes del MISMO valor.

    Los campos de texto del CBN vienen con cuatro clases de ruido medidas:
    mayusculas ('No Aplica'/'No aplica'), concordancia de genero ('Denso'/
    'Densa'), guion tipografico U+2013 ('2 – 4') y saltos de linea incrustados
    ('2 - 4\\n'). Las cuatro son la misma clase escrita distinto, y no fundirlas
    parte una categoria en varias filas del panel.

    NO quita el genero: eso lo resuelve la etiqueta mayoritaria, que elige la
    forma mas frecuente en vez de inventar una.
    """
    if s is None:
        return None
    s = s.replace("–", "-").replace("—", "-").replace(" ", " ")
    s = re.sub(r"\s+", " ", s).strip().lower()
    return "".join(ch for ch in unicodedata.normalize("NFD", s)
                   if unicodedata.category(ch) != "Mn")


def etiqueta_mayoritaria(grafias):
    """De {grafia: filas} a la grafia que se muestra: la mas frecuente.

    El desempate es alfabetico y no arbitrario: dos grafias con el mismo numero
    de filas tienen que dar SIEMPRE la misma etiqueta, o el manifest deja de ser
    reproducible y --check empieza a fallar sin que nada haya cambiado.
    """
    return sorted(grafias.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


# Escala de cada clase de altura. Sale de medir que uso predomina en cada codigo:
# A-F son Bosques, G-I Praderas y Matorrales, y J/K una escala gruesa de dos
# tramos que se usa en ambos y SE SOLAPA con las finas ('<2' cubre lo mismo que
# G+H+I). El frontend las separa por este campo; mezclarlas en un eje ordenado
# contaria dos veces el mismo tramo.
ESCALA_ALTURA = {
    "G": ("fina", 0.0, 0.5), "H": ("fina", 0.5, 1.0), "I": ("fina", 1.0, 2.0),
    "A": ("fina", 2.0, 4.0), "B": ("fina", 4.0, 8.0), "C": ("fina", 8.0, 12.0),
    "D": ("fina", 12.0, 20.0), "E": ("fina", 20.0, 32.0), "F": ("fina", 32.0, None),
    "J": ("gruesa", None, 2.0), "K": ("gruesa", 2.0, None),
    "0": ("no_aplica", None, None),
}


def orden_altura(cod):
    """Posicion de una clase de altura DENTRO de su escala, empezando en 1.

    Dentro de su escala y no global: '<2' y '0 - 0,5' son ambos el primer tramo
    de la suya, y numerarlos en una sola secuencia sugeriria que uno va antes
    que el otro cuando en realidad miden lo mismo con otra regla.

    El orden NO puede salir de la etiqueta: alfabeticamente '12 - 20' va antes
    que '2 - 4'.
    """
    escala = ESCALA_ALTURA[cod][0]
    if escala == "no_aplica":
        return None
    # El limite inferior de '<2' es None, que ordena por delante de todos.
    piso = lambda c: ESCALA_ALTURA[c][1] if ESCALA_ALTURA[c][1] is not None else -1.0
    hermanas = sorted((c for c, v in ESCALA_ALTURA.items() if v[0] == escala), key=piso)
    return hermanas.index(cod) + 1


def codificar(tabla, columna, idx, centinela, etiqueta, estricto=True):
    """Columna de codigos -> indices canonicos, sin materializar objetos Python.

    Devuelve (array, filas en el centinela, {codigo desconocido: cuantas filas}).
    Un codigo que la guia no nombra NO se absorbe en silencio: se cuenta aparte,
    porque "no tiene valor" y "tiene un valor que no sabemos nombrar" son cosas
    distintas y el .bin no tiene dos centinelas para distinguirlas.
    """
    arr = tabla.column(columna).combine_chunks().dictionary_encode()
    voc = arr.dictionary.to_pylist()
    # Los nulos apuntan a una entrada extra al final, que traduce al centinela.
    # Sin esto, to_numpy() sobre indices con nulos devuelve float64 con NaN.
    ind = arr.indices.fill_null(len(voc)).to_numpy(zero_copy_only=False).astype(np.intp)

    tipo = np.uint16 if centinela == SIN_U16 else np.uint8
    trad = np.full(len(voc) + 1, centinela, dtype=tipo)
    desconocidos = {}
    for i, v in enumerate(voc):
        if v is None:
            continue
        j = idx.get(v)
        if j is None:
            desconocidos[v] = int((ind == i).sum())
        else:
            trad[i] = j
    if desconocidos and estricto:
        raise SystemExit(f"{etiqueta}: fuera del vocabulario oficial: {desconocidos}")
    col = trad[ind]
    return col, int((col == centinela).sum()), desconocidos


def agregados(codigos, ha, k, centinela):
    """Conteo y superficie por indice, en UNA pasada con bincount.

    Nada de `codigos == i` por categoria: son 331 comunas x 1,74 MiB de mascara
    booleana, y eso ya reviento la memoria una vez.
    """
    idx = codigos.astype(np.intp)
    tope = centinela + 1
    cuenta = np.bincount(idx, minlength=tope)[:k]
    suma = np.bincount(idx, weights=ha, minlength=tope)[:k]
    return cuenta, suma


def construir():
    con = duckdb.connect(BASE, read_only=True)
    # Obligatorio para el determinismo: con false, el orden de las vistas union
    # multitabla cambia entre ejecuciones y los bytes dejan de ser reproducibles.
    con.execute("SET preserve_insertion_order=true")

    # ---- vocabularios oficiales, de la guia de codigos de la propia base -----
    # usos_comb da el triplete USO/SUBUSO/ESTRUCTURA por codigo de 6 digitos.
    # OJO: esos 6 digitos NO son clave unica -- 040201 aparece con 40 tipos
    # forestales distintos-- asi que de aqui SOLO sale el triplete.
    lbl_subuso, lbl_estruc = {}, {}
    for iu, isu, ie, est, des in con.execute("""
        SELECT id_uso, id_sub, id_est, est, des_uso
        FROM tab.xls_guia_codigos_v3_usos_comb
    """).fetchall():
        if not (iu and isu and ie):
            continue
        partes = [p.strip() for p in (des or "").split(",")]
        lbl_subuso.setdefault(f"{iu}{isu}",
                              ", ".join(partes[1:-1]) if len(partes) >= 3 else None)
        lbl_estruc.setdefault(f"{iu}{isu}{ie}", est)

    # El tipo forestal SI se deriva de su propio codigo: medido, 701.987 de
    # 708.047 concuerdan y la unica divergencia es la grafia 'roble - hualo'.
    d_tifo = dict(con.execute("""
        SELECT id, des FROM tab.xls_guia_codigos_v3_descriptores
        WHERE tipo_id='ID_TIFO_' AND campo_des='T_F_'
    """).fetchall())

    # La etiqueta que ve el usuario es la del CATASTRO (USO), no la clase IPCC:
    # 'Bosques', no 'Tierras Forestales'.
    nombres_uso = dict(con.execute("""
        SELECT DISTINCT ON (ID_USO) ID_USO, USO FROM cbn_nacional_atributos
        WHERE ID_USO IS NOT NULL AND USO IS NOT NULL ORDER BY ID_USO
    """).fetchall())
    ipcc_uso = dict(con.execute("""
        SELECT id, des FROM tab.xls_guia_codigos_v3_descriptores
        WHERE tipo_id='ID_USO_' AND campo_des='USO_IPCC_'
    """).fetchall())

    # ---- vocabularios de las dimensiones descriptivas -----------------------
    # Las tres primeras se agrupan por CODIGO y se etiquetan con la grafia
    # mayoritaria; la cuarta se agrupa por texto canonico porque no tiene codigo
    # utilizable. Son tablas de decenas de filas: aqui si cabe traerlas a Python.
    def por_codigo(col_cod, col_txt):
        """{codigo: {grafia: filas}}, para etiquetar por mayoria."""
        g = {}
        for cod, txt, cuenta in con.execute(f"""
            SELECT {col_cod}, {col_txt}, count(*) FROM cbn_nacional_atributos
            WHERE {col_cod} IS NOT NULL AND {col_txt} IS NOT NULL
              AND centroide_lon IS NOT NULL
            GROUP BY 1, 2
        """).fetchall():
            g.setdefault(cod, {})[txt.strip()] = cuenta
        return g

    graf_cober = por_codigo("ID_COBER", "COBERTURA")
    graf_altura = por_codigo("ID_ALTU", "ALTURA")

    # El vocabulario de cobertura SI lo lista la guia, en una celda unica y en
    # orden de densidad decreciente. No reparte codigo por codigo, asi que el
    # reparto sale del dato -- pero que el orden de la guia coincida con el de
    # los codigos 01..05 es COMPROBABLE, y se comprueba abajo.
    voc_guia_cober = None
    for (celda,) in con.execute("""
        SELECT unnamed_13 FROM tab.xls_metadato_y_diccionario_catas_codigos_y_descriptor
        WHERE unnamed_3 = '01'
    """).fetchall():
        if celda and "," in celda:
            voc_guia_cober = [p.strip() for p in celda.split(",") if p.strip()]
            break
    if not voc_guia_cober:
        raise SystemExit("la guia no lista el vocabulario de cobertura")

    lbl_cober = {c: etiqueta_mayoritaria(g) for c, g in graf_cober.items()}
    # '00' es No Aplica y no entra en la escala de densidad; los demas se
    # contrastan por POSICION contra la lista de la guia.
    escala_cober = sorted(c for c in lbl_cober if c != "00")
    desajuste_cober = [
        {"codigo": c, "en_los_datos": lbl_cober[c], "en_la_guia": voc_guia_cober[i]}
        for i, c in enumerate(escala_cober)
        if i >= len(voc_guia_cober) or canon(lbl_cober[c]) != canon(voc_guia_cober[i])
    ]
    if desajuste_cober:
        # Ruidoso: si el orden de la guia deja de coincidir con el de los
        # codigos, el reparto que hace este script deja de estar respaldado y
        # 'Denso' podria acabar rotulando lo que el catastro llama 'Escaso'.
        raise SystemExit(f"cobertura: el orden de la guia no cuadra: {desajuste_cober}")

    # El separador decimal a coma, que es el del resto del visor: las clases
    # llegaban como «0 - 0.5» junto a cifras escritas «1.835.307,15».
    hom_alt = H.mapa("07_altura", norm=canon)
    H.exigir("07_altura", (etiqueta_mayoritaria(g) for g in graf_altura.values()),
             "clase de altura", norm=canon)
    lbl_altura = {c: hom_alt.get(canon(etiqueta_mayoritaria(g)), etiqueta_mayoritaria(g))
                  for c, g in graf_altura.items()}
    for c in lbl_altura:
        if c not in ESCALA_ALTURA:
            raise SystemExit(f"clase de altura sin escala declarada: {c!r}")

    # Subtipo forestal: por TEXTO canonico. idx traduce cada GRAFIA CRUDA al
    # indice de su grupo, que es justo lo que codificar() necesita para traducir
    # el diccionario de Arrow sin materializar 1,8 M de cadenas.
    filas_stifo = con.execute("""
        SELECT SUBTIPOFOR, count(*) FROM cbn_nacional_atributos
        WHERE SUBTIPOFOR IS NOT NULL AND centroide_lon IS NOT NULL GROUP BY 1
    """).fetchall()

    # DOS ETAPAS DE AGRUPACION, y hacen falta las dos.
    #
    # Etapa 1, la de siempre: `canon` funde mayusculas, tildes, guiones
    # tipograficos y saltos de linea, y la etiqueta del grupo es la grafia
    # mayoritaria. De ahi salen las 37 clases que el visor publica hoy.
    #
    # Etapa 2, la nueva: esas 37 etiquetas pasan por la tabla de homologacion,
    # que funde cuatro pares que `canon` NO funde porque solo se diferencian en
    # los espacios alrededor del guion --«Roble-Hualo» y «Roble - Hualo»--. Son
    # 75.918,86 ha en la variante minoritaria, y quien consultaba una de las dos
    # obtenia poco mas de la mitad de la superficie de su clase.
    #
    # La tabla se consulta con la ETIQUETA PUBLICADA, no con cada grafia cruda:
    # sus `valor_origen` son lo que se ve en el visor. Aplicarla sobre el crudo
    # reventaba el catalogo con 'No aplica' y 'Roble-Rauli-Coihue', que son
    # grafias que la etapa 1 ya habia absorbido.
    graf0, crudas0 = {}, {}
    for txt, cuenta in filas_stifo:
        k0 = canon(txt)
        # `crudas0` guarda el valor CRUDO --sin recortar-- porque es el que trae
        # el diccionario de Arrow, y `idx_stf` tiene que traducir eso. Recortar
        # tambien aqui deja fuera del vocabulario a las filas con espacio
        # sobrante.
        graf0.setdefault(k0, {})[txt.strip()] =             graf0.get(k0, {}).get(txt.strip(), 0) + cuenta
        crudas0.setdefault(k0, []).append(txt)
    lbl0 = {k0: etiqueta_mayoritaria(g) for k0, g in graf0.items()}

    hom_stf = H.mapa("05_subtipo_forestal", norm=canon)
    H.exigir("05_subtipo_forestal", lbl0.values(), "subtipo forestal", norm=canon)

    graf_stifo, crudas_stifo, lbl_stifo_canon = {}, {}, {}
    alias_stf = {}
    for k0, etq0 in lbl0.items():
        etq = hom_stf.get(canon(etq0), etq0)
        k = canon(etq)
        # EL CODIGO PUBLICADO DE ESTA DIMENSION ES SU TEXTO CANONIZADO, y al
        # fundir dos clases el de la minoritaria deja de existir. `filtrosAURL`
        # escribe ese codigo en la URL, asi que un enlace ya compartido con
        # ?stifo=roble-hualo filtraria NADA, en silencio. El alias lo traduce.
        if k0 != k:
            alias_stf[k0] = k
        lbl_stifo_canon[k] = etq
        graf_stifo[k] = graf_stifo.get(k, 0) + sum(graf0[k0].values())
        crudas_stifo.setdefault(k, []).extend(crudas0[k0])

    ord_stf = sorted(graf_stifo)
    # La etiqueta la manda la TABLA, no la grafia mayoritaria: cuando dos
    # variantes se funden, la mayoritaria seria una de las dos y la tabla ya
    # eligio cual, con el criterio de la grafia oficial del tipo forestal.
    lbl_stifo = {k: lbl_stifo_canon[k] for k in ord_stf}
    idx_stf = {raw: i for i, k in enumerate(ord_stf) for raw in crudas_stifo[k]}

    # A que tipo forestal pertenece cada subtipo, para poder agrupar los 37 bajo
    # los 12 en pantalla. Se publica SOLO si el subtipo vive bajo un unico tipo:
    # si aparece bajo varios, queda en null y el frontend lo lista suelto en vez
    # de colgarlo del que mas filas tenga, que seria una jerarquia inventada.
    bajo_tifo = {}
    for txt, tifo, cuenta in con.execute("""
        SELECT SUBTIPOFOR, ID_TIFO, count(*) FROM cbn_nacional_atributos
        WHERE SUBTIPOFOR IS NOT NULL AND ID_TIFO IS NOT NULL
          AND centroide_lon IS NOT NULL GROUP BY 1, 2
    """).fetchall():
        # Por el canon del texto HOMOLOGADO, igual que el dominio. Agrupando por
        # el crudo, los cuatro subtipos fundidos quedarian sin tipo forestal en
        # el manifest y el frontend los listaria sueltos.
        bajo_tifo.setdefault(canon(hom_stf.get(canon(txt), txt.strip())), set()).add(tifo)
    tifo_de_stifo = {k: (sorted(v)[0] if len(v) == 1 else None)
                     for k, v in bajo_tifo.items()}

    # Especies: la clave es ID_ESP1 y las etiquetas son las dos grafias
    # mayoritarias, la cientifica y la comun. `genero` es la primera palabra del
    # nombre cientifico, que es como agrega la planilla oficial ('Eucalyptus sp.').
    graf_esp_ci = por_codigo("ID_ESP1", "ESPECI1_CI")
    graf_esp_co = por_codigo("ID_ESP1", "ESPECI1_CO")
    # LA HOMOLOGACION DE ESPECIE SE APLICA A LAS ETIQUETAS Y NUNCA AL CODIGO, y
    # esto es una frontera deliberada, no una omision. La hoja 12 propone dos
    # cambios de codigo y ninguno de los dos puede aplicarse a ciegas:
    #
    #   - 'ÃÂ' -> '(recuperar del origen)'. Es un MARCADOR DE POSICION, no un
    #     codigo: aplicarlo crearia una especie llamada asi.
    #   - 'wÃ' -> 'wñ'. Es una FUSION de dos codigos, y la propia hoja 14 la
    #     manda a decision. Cambiar un codigo re-enlaza 1,83 M de filas.
    #
    # El codigo es ademas la unica clave de union valida --53 nombres comunes
    # designan mas de una especie, «alamo» son tres Populus-- y distingue caja:
    # 'AB' es Abies, 'Ab' es Adesmia boronioides y 'ab' es Calceolaria biflora.
    # Ver 13_NO_FUSIONAR.csv.
    hom_esp = H.tabla("12_especie", clave="cod_origen")
    clas_esp = H.tabla("15_especie_clasificada", clave="especie_cod")

    esp_meta = {}
    for cod in sorted(set(graf_esp_ci) | set(graf_esp_co)):
        ci = etiqueta_mayoritaria(graf_esp_ci[cod]) if cod in graf_esp_ci else None
        co = etiqueta_mayoritaria(graf_esp_co[cod]) if cod in graf_esp_co else None
        h = hom_esp.get(cod)
        if h and h["accion"] in H.APLICABLES:
            ci = h["cientifico_canonico"] or ci
            co = h["especie_canonica"] or co
        k = clas_esp.get(cod, {})
        esp_meta[cod] = {
            "cientifico": ci,
            "comun": co,
            # El genero lo manda la tabla cuando lo trae: la primera palabra del
            # cientifico se cuela con el mojibake de 'Oxychlo�'.
            "genero": (h or {}).get("genero_canonico") or (ci.split()[0] if ci else None),
            # Los siete atributos de la hoja 15. No son del poligono sino de la
            # ESPECIE, asi que viajan aqui --989 filas-- y el cliente deriva de
            # ellos sus columnas de filtro. Mandarlos en el .bin serian ~9 MB.
            "grupo": k.get("grupo"),
            "habito": k.get("habito"),
            "arboreo": k.get("arboreo"),
            "origen": k.get("origen"),
            "monumento_natural": k.get("monumento_natural"),
            "decreto_mn": k.get("decreto_mn"),
            "invasora": k.get("invasora"),
            "conservacion": k.get("estado_conservacion_RCE"),
        }
    H.exigir("12_especie", esp_meta, "especie", clave="cod_origen")
    H.exigir("15_especie_clasificada", esp_meta, "clasificacion de especie",
             clave="especie_cod")

    # ---- metadatos territoriales (agregados chicos: se resuelven en SQL) -----
    regiones = {}
    # El bbox va en el manifest para que el visor pueda ENCUADRAR al elegir una
    # region sin recorrer 1,8 M de filas en el cliente. Se calcula sobre los
    # centroides, que es lo unico que hay: es el encuadre de los PUNTOS, no el
    # de la region administrativa, y para lo que sirve --llevar la vista alli--
    # es suficiente.
    for rc, rn, rr, og, per, nn, hh, x0, y0, x1, y1 in con.execute("""
        SELECT reg_cod, any_value(reg_nombre), any_value(reg_romana),
               any_value(orden_geo), string_agg(DISTINCT periodo, ' | '),
               count(*), sum(COALESCE(SUPERF_HA,0)),
               min(centroide_lon), min(centroide_lat),
               max(centroide_lon), max(centroide_lat)
        FROM cbn_nacional_atributos WHERE centroide_lon IS NOT NULL
        GROUP BY reg_cod
    """).fetchall():
        corto, oficial = REGION_NOMBRE.get(rc, (rn, rn))
        if rc not in REGION_NOMBRE:
            # Ruidoso: una region nueva o un codigo cambiado saldria en pantalla
            # con su nombre sin tildes, y nadie se enteraria.
            raise SystemExit(f"region sin nombre curado: {rc!r} ({rn!r})")
        regiones[rc] = {"cod": rc, "nombre": corto, "oficial": oficial,
                        "romana": rr, "orden": og,
                        "anio": per, "n": nn, "ha": round(float(hh), 2),
                        "bbox": [round(x0, 5), round(y0, 5), round(x1, 5), round(y1, 5)]}

    # COALESCE(CODCOM, Codcomun) Y NO SOLO CODCOM. La Region de Los Rios trae su
    # codigo de comuna en OTRA columna: `Codcomun` esta poblada en sus 79.727
    # filas y es NULL en las otras quince regiones -- es el complemento exacto de
    # `CODCOM`. Leyendo solo CODCOM, las doce comunas de Los Rios no existian
    # para el visor y la region entera se quedaba sin desglose territorial.
    # Medido: count(COALESCE(CODCOM, Codcomun)) = 1.827.929 de 1.827.933, y las
    # 4 que faltan son los poligonos de Magallanes sin ningun dato territorial.
    hom_com = H.mapa("09_comuna")
    hom_prov = H.mapa("10_provincia")
    crudos_com, crudos_prov = set(), set()
    com_meta = {}
    for cc, cn, pn, rc, x0, y0, x1, y1 in con.execute("""
        SELECT COALESCE(CODCOM, Codcomun) AS cod,
               any_value(NOM_COM), any_value(NOM_PROV), any_value(reg_cod),
               min(centroide_lon), min(centroide_lat),
               max(centroide_lon), max(centroide_lat)
        FROM cbn_nacional_atributos
        WHERE COALESCE(CODCOM, Codcomun) IS NOT NULL AND centroide_lon IS NOT NULL
        GROUP BY cod
    """).fetchall():
        crudos_com.add(cn)
        crudos_prov.add(pn)
        com_meta[cc] = {"nombre": hom_com.get(cn, cn),
                        "provincia": hom_prov.get(pn, pn), "region": rc,
                        "bbox": [round(x0, 5), round(y0, 5), round(x1, 5), round(y1, 5)]}
    # `revisar` NO se aplica: la tabla marca asi las grafias que difieren del
    # nombre oficial por algo mas que un acento --Calera/La Calera,
    # Coihaique/Coyhaique, Mariquina/San Jose de la Mariquina-- y dice
    # expresamente «confirmar antes de aplicar». Decidirlo aqui seria que el ETL
    # zanjara un asunto de nomenclatura oficial. Quedan abiertas en 14_REVISAR.
    H.exigir("09_comuna", crudos_com, "comuna")
    H.exigir("10_provincia", crudos_prov, "provincia")

    # SNASPE: la categoria se deriva de la UNIDAD, no al reves.
    # Cuatro unidades llegaban PARTIDAS EN DOS por la grafia: el Parque Nacional
    # Bernardo O'Higgins figuraba como «Ohiggins» (2.849.820,93 ha) y como
    # «OHiggins» (962.126,98 ha), y lo mismo la Reserva Nacional Ñuble, el Parque
    # Nacional Pan de Azucar y el Nahuelbuta. La tabla ademas antepone la
    # categoria a los 16 rotulos que no la traian, y eso NO es cosmetico: el
    # Parque Nacional Villarrica y la Reserva Nacional Villarrica son dos
    # unidades distintas que comparten toponimo, y la categoria es lo unico que
    # las distingue. Por eso no se pueden fundir por nombre pelado.
    hom_sna = H.mapa("08_snaspe")
    filas_sna = con.execute("""
        SELECT NOM_SNASPE, TIPO_SNASP, count(*) FROM cbn_nacional_atributos
        WHERE NOM_SNASPE IS NOT NULL AND centroide_lon IS NOT NULL GROUP BY 1,2
    """).fetchall()
    H.exigir("08_snaspe", (u for u, _, _ in filas_sna), "unidad del SNASPE")
    cat_por_unidad, crudas_sna, alias_sna = {}, {}, {}
    for u_crudo, cat, cuenta in filas_sna:
        u = hom_sna.get(u_crudo, u_crudo)
        cat_por_unidad.setdefault(u, {})[cat] = cat_por_unidad.get(u, {}).get(cat, 0) + cuenta
        crudas_sna.setdefault(u, set()).add(u_crudo)
        if u_crudo != u:
            alias_sna[u_crudo] = u

    # Las cuentas por categoria se REORDENAN antes de publicarse: se serializan
    # en el manifest, y su orden de insercion sale del GROUP BY, que DuckDB no
    # garantiza. Medido: tres corridas identicas dieron dos hashes distintos del
    # manifest -- el .bin si era estable, asi que --check no lo cazaba.
    cat_por_unidad = {u: dict(sorted(c.items(), key=lambda kv: (kv[0] is None, kv[0])))
                      for u, c in cat_por_unidad.items()}

    canon_cat, corregidas = {}, []
    for u, cuentas in sorted(cat_por_unidad.items()):
        validas = {k: v for k, v in cuentas.items() if k in CATEGORIAS_SNASPE}
        if validas:
            # Radal Siete Tazas trae las dos: fue Reserva Nacional y paso a
            # Parque Nacional. Gana la mayoritaria, que es la vigente.
            elegida = max(validas.items(), key=lambda x: x[1])[0]
            motivo = "la unidad figura con dos categorias; se usa la mayoritaria"
        else:
            # La correccion esta escrita contra el nombre CRUDO de la capa
            # --«Mon. Natural Islotes de Punihuil», «Monumentro Nacional Lahuen
            # Nadi»--, que es justo el que la homologacion acaba de sustituir.
            # Se busca por los crudos del grupo, no por el canonico.
            elegida = next((CORRECCION_SNASPE[c] for c in sorted(crudas_sna.get(u, ()))
                            if c in CORRECCION_SNASPE), None)
            if elegida is None:
                raise SystemExit(f"SNASPE sin categoria valida ni correccion: {u!r} {cuentas}")
            motivo = "la capa de origen trae una categoria que no existe en el SNASPE"
        canon_cat[u] = elegida
        if len(cuentas) > 1 or not validas:
            corregidas.append({"unidad": u, "en_la_capa": cuentas,
                               "grafias_de_origen": sorted(crudas_sna.get(u, ())),
                               "usada": elegida, "motivo": motivo})

    # La region se indexa en ORDEN GEOGRAFICO norte-sur, que es como se piensa
    # Chile y como el manifest ya publicaba `regiones`. Asi la lista del dominio
    # y la del manifest son LA MISMA, y no dos que puedan discrepar.
    ord_reg = [r["cod"] for r in sorted(regiones.values(), key=lambda r: r["orden"])]
    idx_reg = {v: i for i, v in enumerate(ord_reg)}

    idx_uso, ord_uso = {v: i for i, v in enumerate(USOS)}, USOS
    idx_sub, ord_sub = indexar(lbl_subuso)
    idx_est, ord_est = indexar(lbl_estruc)
    idx_tif, ord_tif = indexar(d_tifo)
    idx_com, ord_com = indexar(com_meta)
    # El indice va del nombre CRUDO al de su grupo: `codificar` traduce el
    # diccionario de Arrow, que trae los valores tal como estan en la capa.
    idx_sna_canon, ord_sna = indexar(cat_por_unidad)
    idx_sna = {u: idx_sna_canon[hom_sna.get(u, u)]
               for u, _, _ in filas_sna if hom_sna.get(u, u) in idx_sna_canon}
    idx_cob, ord_cob = indexar(lbl_cober)
    idx_alt, ord_alt = indexar(lbl_altura)
    idx_esp, ord_esp = indexar(esp_meta)
    # ord_stf/idx_stf ya estan armados arriba: van por texto, no por codigo.

    # ---- la pasada de datos --------------------------------------------------
    # Las claves compuestas se arman en SQL: concatenarlas en un bucle de Python
    # materializa 3,6 M de cadenas y revienta la memoria.
    t = con.execute("""
        SELECT centroide_lon AS lon,
               centroide_lat AS lat,
               COALESCE(SUPERF_HA, 0) AS ha,
               ID_USO AS c_uso,
               CASE WHEN ID_USO IS NOT NULL AND ID_SUBUSO IS NOT NULL
                    THEN ID_USO || ID_SUBUSO END AS c_sub,
               CASE WHEN ID_USO IS NOT NULL AND ID_SUBUSO IS NOT NULL
                         AND ID_ESTRUC IS NOT NULL
                    THEN ID_USO || ID_SUBUSO || ID_ESTRUC END AS c_est,
               ID_TIFO AS c_tif, COALESCE(CODCOM, Codcomun) AS c_com,
               NOM_SNASPE AS c_sna,
               ID_COBER AS c_cob, ID_ALTU AS c_alt, ID_ESP1 AS c_esp,
               SUBTIPOFOR AS c_stf, reg_cod AS c_reg
        FROM cbn_nacional_atributos
        WHERE centroide_lon IS NOT NULL AND centroide_lat IS NOT NULL
    """).to_arrow_table()
    n = t.num_rows

    lon = t.column("lon").to_numpy(zero_copy_only=False).astype(np.float32)
    lat = t.column("lat").to_numpy(zero_copy_only=False).astype(np.float32)
    ha32 = t.column("ha").to_numpy(zero_copy_only=False).astype(np.float32)
    # Las CIFRAS se acumulan en float64 SIEMPRE. A 75 millones el ULP de float32
    # son 8 ha: sumando en float32 el total quedaba cuantizado a saltos de 8 y
    # el manifest se contradecia consigo mismo por 3,12 ha.
    ha64 = t.column("ha").to_numpy(zero_copy_only=False).astype(np.float64)

    c_uso, _, _ = codificar(t, "c_uso", idx_uso, SIN_U8, "ID_USO")
    c_sub, sin_sub, dsc_sub = codificar(t, "c_sub", idx_sub, SIN_U8, "subuso", False)
    c_est, sin_est, dsc_est = codificar(t, "c_est", idx_est, SIN_U8, "estructura", False)
    c_tif, sin_tif, _ = codificar(t, "c_tif", idx_tif, SIN_U8, "ID_TIFO")
    c_com, sin_com, _ = codificar(t, "c_com", idx_com, SIN_U16, "CODCOM")
    c_sna, sin_sna, _ = codificar(t, "c_sna", idx_sna, SIN_U8, "NOM_SNASPE")
    # Las cuatro van en modo NO estricto, y por una razon distinta a la de
    # subuso/estructura: su vocabulario sale del propio dato, asi que un codigo
    # se queda fuera solo cuando NO TIENE NOMBRE en ninguna fila ni columna --
    # medido, ID_ESP1 'Y2' y 'S33', 2 filas cada uno. Reventar la construccion
    # por eso dejaria el visor sin datos por 4 filas de 1.827.933; se cuentan y
    # se publican, que es lo que ya se hace con los codigos de la guia.
    c_cob, sin_cob, dsc_cob = codificar(t, "c_cob", idx_cob, SIN_U8, "cobertura", False)
    c_alt, sin_alt, dsc_alt = codificar(t, "c_alt", idx_alt, SIN_U8, "altura", False)
    c_esp, sin_esp, dsc_esp = codificar(t, "c_esp", idx_esp, SIN_U16, "especie", False)
    c_stf, sin_stf, dsc_stf = codificar(t, "c_stf", idx_stf, SIN_U8, "subtipo forestal", False)
    # Estricto: una region nueva o un codigo cambiado tiene que reventar aqui, no
    # aparecer como centinela en el visor.
    c_reg, sin_reg, _ = codificar(t, "c_reg", idx_reg, SIN_U8, "reg_cod")
    if sin_reg:
        raise SystemExit(f"{sin_reg} filas sin region: reg_cod dejo de estar completo")

    # --- el radio de cada disco, recortado para que NINGUNO invada a su vecino
    #
    # r = min( radio del circulo de igual area , distancia al vecino / 2 )
    #
    # En castellano: cada punto ocupa la superficie que declara, salvo donde no
    # cabe; ahi se recorta hasta tocar a su vecino sin invadirlo.
    #
    # LO QUE ESTO CUESTA, y hay que decirlo porque cambia lo que el mapa
    # significa: para el 56 % de los puntos el disco deja de cubrir el area del
    # poligono y pasa a cubrir el sitio disponible. La mediana de los recortados
    # baja al 54 % de su radio, o sea al 29 % de su area. La superficie exacta
    # sigue en la ficha, en los modales y en las descargas.
    #
    # Y HAY UN LIMITE QUE NO SE PUEDE SALTAR: por debajo de z11 la separacion
    # mediana entre vecinos (185 m) cae por debajo de los 2,4 px que necesitan
    # dos discos en el suelo de radiusMinPixels. A escala de pais hay 1,8 M de
    # puntos sobre 733.000 pixeles: no es una decision de diseno, es una
    # division. La garantia es «sin solape a partir de z11», no una promesa
    # general, y asi esta escrita en la interfaz.
    #
    # Proyeccion local a metros y no geodesica: a la escala del vecino mas
    # cercano --mediana 185 m-- el error es de centimetros, y lo que se compara
    # son metros enteros.
    xm = lon.astype(np.float64) * np.cos(np.radians(lat.astype(np.float64))) * 111320.0
    ym = lat.astype(np.float64) * 110540.0
    dist, _ = cKDTree(np.column_stack([xm, ym])).query(
        np.column_stack([xm, ym]), k=2, workers=-1)
    r_area = np.sqrt(ha64 * 10000.0 / math.pi)
    # `floor` y no `round`: al redondear a metro entero hacia arriba, dos discos
    # que se tocaban exactamente pasarian a invadirse por medio metro y D26 se
    # pondria roja sobre datos correctos.
    radio = np.floor(np.minimum(r_area, dist[:, 1] / 2.0)).astype(np.uint16)
    n_recortados = int((r_area > dist[:, 1] / 2.0).sum())
    if radio.max() >= SIN_U16:
        raise SystemExit(f"radio de {radio.max()} m: no cabe en u16 sin chocar con el centinela")

    # --- «No aplica» deja de decirse de dos formas -------------------------
    #
    # En tipo forestal y subtipo forestal, la fuente escribe la MISMA cosa de
    # dos maneras: el codigo '00' / 'no aplica', o ninguna. Y no a partes
    # iguales -- medido sobre las 1.827.933 filas, contando el centinela y la
    # clase '00' por subclase:
    #
    #                   tifo centinela | tifo '00'      stifo cent | stifo '00'
    #   Bosque Nativo             0    |       0                 2 |    60.808
    #   Plantacion          262.602    |     787           262.603 |       786
    #   Bosque Mixto         30.624    |      46            30.624 |        46
    #
    # Ni un solo poligono al que el tipo forestal SI le aplique --el bosque
    # nativo-- esta en el centinela; y a plantacion y mixto, donde no aplica,
    # la fuente les pone el codigo '00' en el 0,3 % de los casos y nada en el
    # 99,7 %. O sea que ahi el centinela NO significa "no sabemos": significa
    # "no aplica", que es lo que ya decia el contrato de este mismo archivo
    # para tifo. Fundirlos no pierde ninguna distincion, y a cambio saca 1,1
    # millones de poligonos de una nota al pie que no se puede filtrar y los
    # pone en su clase, que si se puede.
    #
    # NO SE HACE CON COBERTURA NI CON ALTURA, y no es por prudencia:
    #
    #   - cobertura: su centinela son 11.261 filas, y 11.261 de ellas tienen
    #     TAMBIEN el centinela en estructura. Son las filas de triplete roto de
    #     DECISIONES.md seccion E: "no sabemos", que no es "no aplica".
    #   - altura: su centinela mezcla las dos cosas. 293.181 poligonos de
    #     Bosques no tienen altura de dosel, y un bosque SI tiene altura: eso
    #     es dato que falta. Separarlo del "no aplica" de los cuerpos de agua
    #     exigiria deducirlo del contexto, que es justo lo que este ETL no
    #     hace.
    # El indice destino se busca en el ORDEN del dominio, que es lo que acaba en
    # el manifest, y no en el diccionario de traduccion: el de subtipo va del
    # texto CRUDO al indice --hay varias grafias por clase-- asi que 'no aplica'
    # no es una de sus claves.
    fundidas = {}
    for nombre, col, orden, clave in (("tipo forestal", c_tif, ord_tif, "00"),
                                      ("subtipo forestal", c_stf, ord_stf, "no aplica")):
        if clave not in orden:
            raise SystemExit(f"{nombre}: no existe la clase «{clave}» para fundir el centinela")
        sin_valor = col == SIN_U8
        fundidas[nombre] = int(sin_valor.sum())
        col[sin_valor] = orden.index(clave)
    sin_tif = int((c_tif == SIN_U8).sum())
    sin_stf = int((c_stf == SIN_U8).sum())
    print(f"  «no aplica» unificado: {fundidas['tipo forestal']:,} filas de tipo forestal y "
          f"{fundidas['subtipo forestal']:,} de subtipo dejan el centinela por su clase")
    t = None   # se libera la tabla de Arrow antes de agregar

    # ---- escritura del .bin --------------------------------------------------
    os.makedirs(SALIDA, exist_ok=True)
    ruta_bin = os.path.join(SALIDA, "cbn_puntos.bin")
    with open(ruta_bin, "wb") as fh:
        # EL ORDEN DE ESTA TUPLA ES EL CONTRATO. Tiene que coincidir con los
        # offsets del manifest y con el docstring de arriba, y no hay forma de
        # que un error aqui de un fallo visible: un .bin con dos columnas de un
        # byte intercambiadas pesa exactamente lo mismo y se pinta sin error.
        for a in (lon, lat, ha32, c_com, c_esp, radio,
                  c_uso, c_sub, c_est, c_tif, c_sna, c_cob, c_alt, c_stf, c_reg):
            fh.write(a.tobytes())

    esperado = n * (4 * 3 + 2 * 3 + 1 * 9)
    real = os.path.getsize(ruta_bin)
    if real != esperado:
        raise SystemExit(f"tamano inesperado: {real} != {esperado}")

    # ---- dominios y cifras ---------------------------------------------------
    def dominio(codigos, orden, etiqueta, centinela=SIN_U8, extra=None):
        cuenta, suma = agregados(codigos, ha64, len(orden), centinela)
        filas = []
        for i, c in enumerate(orden):
            fila = {"cod": c, "etiqueta": etiqueta(c),
                    "n": int(cuenta[i]), "ha": round(float(suma[i]), 2)}
            if extra:
                fila.update(extra(c))
            filas.append(fila)
        return filas

    # El cruce SQL vs columna. Si difiere, algo se perdio entre la consulta de
    # metadatos y la pasada de datos, y mas vale enterarse aqui que en pantalla.
    regiones_dom = []
    for fila in dominio(c_reg, ord_reg, lambda c: regiones[c]["nombre"]):
        meta = regiones[fila["cod"]]
        if fila["n"] != meta["n"]:
            raise SystemExit(
                f"region {fila['cod']}: la columna cuenta {fila['n']} y el SQL {meta['n']}")
        regiones_dom.append({**meta, "n": fila["n"], "ha": fila["ha"]})

    # Las derivadas: se traduce el indice de especie al de su clase y se agrega
    # con la misma maquinaria que las demas. Las 284.279 filas sin especie
    # heredan el centinela, que es lo correcto: «no se sabe la especie» no es
    # «no es nativa».
    derivadas = {}
    for clave, campo in DERIVADAS_ESPECIE:
        valores = sorted({esp_meta[c][campo] for c in ord_esp if esp_meta[c][campo]})
        pos = {v: i for i, v in enumerate(valores)}
        trad = np.full(len(ord_esp) + 1, SIN_U8, dtype=np.uint8)
        for i, c in enumerate(ord_esp):
            v = esp_meta[c][campo]
            if v is not None:
                trad[i] = pos[v]
        idx_esp_o_cent = np.where(c_esp == SIN_U16, len(ord_esp), c_esp).astype(np.intp)
        derivadas[clave] = dominio(trad[idx_esp_o_cent], valores, lambda x: x)

    # --- las tres derivadas que no salen de la especie ------------------------
    #
    # DENTRO / FUERA DEL SNASPE. El centinela de la columna `snaspe` no significa
    # «no sabemos» sino «fuera del Sistema», y es el 78 % del pais: por eso
    # `SIN_DATO_POR_COL` lo excluye a proposito. Pero esa respuesta no se podia
    # FILTRAR --la dimension SNASPE lista las 90 unidades y nada mas--, asi que
    # «ensename lo que esta protegido» no tenia forma de pedirse.
    ord_pro = ["Dentro del SNASPE", "Fuera del SNASPE"]
    c_pro = np.where(c_sna == SIN_U8, 1, 0).astype(np.uint8)
    derivadas["protecciones"] = dominio(c_pro, ord_pro, lambda x: x,
                                        extra=lambda x: {"orden": ord_pro.index(x)})

    # TRAMO DE SUPERFICIE. Ninguna de las veintiuna dimensiones tocaba el tamano
    # del poligono, que es justo la variable que suman TODAS las cifras del
    # visor: no habia forma de preguntar «cuanto de esto son poligonos grandes».
    ord_tam = [e for _, _, e in TRAMOS_HA]
    # SE EMPIEZA CON UN VALOR IMPOSIBLE Y SE EXIGE QUE NO QUEDE NINGUNO. Empezaba
    # en ceros, y eso convertia cualquier hueco en los cortes en un fallo
    # perfectamente silencioso: una fila fuera de todo tramo se iba a la clase 0
    # --«menos de 1 ha»--, el reparto seguia sumando 1.827.933 y las cifras
    # seguian cuadrando entre si. Lo encontro una mutacion que acortaba el ultimo
    # tramo y pasaba en VERDE con los poligonos de mas de 10.000 ha metidos entre
    # los de menos de una hectarea.
    c_tam = np.full(n, SIN_U8, dtype=np.uint8)
    for i, (desde, hasta, _) in enumerate(TRAMOS_HA):
        c_tam[(ha64 >= desde) & (ha64 < hasta)] = i
    sin_tramo = int((c_tam == SIN_U8).sum())
    if sin_tramo:
        peor = float(ha64[c_tam == SIN_U8].max())
        raise SystemExit(f"{sin_tramo} filas fuera de todo tramo de superficie "
                         f"(la mayor, {peor:,.2f} ha): TRAMOS_HA no cubre el rango")
    derivadas["tamanos"] = dominio(
        c_tam, ord_tam, lambda x: x,
        extra=lambda x: {"orden": ord_tam.index(x),
                         "desde": TRAMOS_HA[ord_tam.index(x)][0],
                         "hasta": (None if TRAMOS_HA[ord_tam.index(x)][1] == float("inf")
                                   else TRAMOS_HA[ord_tam.index(x)][1])})

    # ANO DEL CATASTRO. El visor lleva meses advirtiendo que cada region se
    # levanto en un ano distinto --lo dice el panel, la metodologia y el reporte
    # impreso-- y no habia manera de USAR ese aviso: para ver lo catastrado desde
    # 2020 habia que ir region por region. Sale de la columna de region, asi que
    # no cuesta un byte.
    #
    # LOS TRAMOS NO SE COLAPSAN A UN ANO. Cinco regiones traen periodos --
    # «2017-2019», «2020-2022»-- y elegir uno de los extremos seria inventar una
    # fecha que el Catastro no da.
    anio_de_reg = {r["cod"]: r["anio"] for r in regiones.values()}
    ord_anio = sorted({a for a in anio_de_reg.values()},
                      key=lambda a: (int(str(a).split("-")[0]), str(a)))
    pos_anio = {a: i for i, a in enumerate(ord_anio)}
    trad_anio = np.array([pos_anio[anio_de_reg[c]] for c in ord_reg], dtype=np.uint8)
    c_anio = trad_anio[c_reg.astype(np.intp)]
    derivadas["anios"] = dominio(c_anio, ord_anio, lambda x: x,
                                 extra=lambda x: {"orden": ord_anio.index(x)})

    manifest = {
        # 5 y no 4: la columna `radio` vuelve a cambiar el largo de la fila, asi
        # que un visor viejo leeria offsets validos con datos corridos. binario.js
        # rechaza cualquier esquema que no sea el suyo.
        "esquema": 5,
        "fuente": "Catastro de Usos de la Tierra y Recursos Vegetacionales, CONAF",
        # Sin marca de tiempo: es lo que permite commitear datos y que un
        # `git status` limpio signifique "nada cambio".
        "capas": {
            "cbn_puntos": {
                "archivo": "cbn_puntos.bin",
                "filas": n,
                "bytes": real,
                "sha256": sha256(ruta_bin),
                "campos": {
                    "lon":     {"tipo": "f32", "offset": 0,      "centinela": None},
                    "lat":     {"tipo": "f32", "offset": 4 * n,  "centinela": None},
                    "ha":      {"tipo": "f32", "offset": 8 * n,  "centinela": None},
                    "comuna":  {"tipo": "u16", "offset": 12 * n, "centinela": SIN_U16},
                    "especie": {"tipo": "u16", "offset": 14 * n, "centinela": SIN_U16},
                    # Sin centinela: el radio 0 es un radio, no una ausencia. Son
                    # las 9.693 filas con superficie 0, que el suelo de pixeles
                    # del visor sigue dibujando.
                    "radio":   {"tipo": "u16", "offset": 16 * n, "centinela": None},
                    "uso":     {"tipo": "u8",  "offset": 18 * n, "centinela": None},
                    "subuso":  {"tipo": "u8",  "offset": 19 * n, "centinela": SIN_U8},
                    "estruc":  {"tipo": "u8",  "offset": 20 * n, "centinela": SIN_U8},
                    "tifo":    {"tipo": "u8",  "offset": 21 * n, "centinela": SIN_U8},
                    "snaspe":  {"tipo": "u8",  "offset": 22 * n, "centinela": SIN_U8},
                    "cober":   {"tipo": "u8",  "offset": 23 * n, "centinela": SIN_U8},
                    "altura":  {"tipo": "u8",  "offset": 24 * n, "centinela": SIN_U8},
                    "stifo":   {"tipo": "u8",  "offset": 25 * n, "centinela": SIN_U8},
                    "region":  {"tipo": "u8",  "offset": 26 * n, "centinela": SIN_U8},
                },
                "sin_dato": {"comuna": sin_com, "subuso": sin_sub, "estruc": sin_est,
                             "tifo": sin_tif, "snaspe": sin_sna, "cober": sin_cob,
                             "altura": sin_alt, "especie": sin_esp, "stifo": sin_stf,
                             "region": sin_reg},
                # APARTE DE `sin_dato`, y no dentro. Las seis derivadas SI tienen
                # filas sin dato --las mismas que especie, porque de ahi salen--,
                # pero `sin_dato` esta reservado a las columnas del .bin: D13
                # comprueba que sus claves sean exactamente las columnas con
                # centinela, y meter aqui algo que no es columna rompe esa
                # comprobacion. Se intento y D13 se puso roja, con razon.
                # El resumen del recorte, publicado para que la interfaz pueda
                # decir cuantos discos NO cubren el area de su poligono sin que
                # nadie escriba la cifra a mano, y para que se pueda contrastar
                # desde fuera. D26 NO se fia de esto: recalcula del .bin.
                "radio": {"mediana_m": int(np.percentile(radio, 50)),
                          "max_m": int(radio.max()),
                          "recortados": n_recortados},
                "sin_dato_derivado": {c: sin_esp for c in
                                      ("grupo", "habito", "arboreo", "origen",
                                       "invasora", "conservacion")},
                "bbox": [float(lon.min()), float(lat.min()),
                         float(lon.max()), float(lat.max())],
            }
        },
        "usos": dominio(c_uso, ord_uso, lambda c: nombres_uso.get(c, c),
                        extra=lambda c: {"ipcc": ipcc_uso.get(c)}),
        "subusos": dominio(c_sub, ord_sub, lambda c: lbl_subuso.get(c) or c,
                           extra=lambda c: {"uso": c[:2]}),
        "estructuras": dominio(c_est, ord_est, lambda c: lbl_estruc.get(c) or c,
                               extra=lambda c: {"uso": c[:2], "subuso": c[:4]}),
        "tipos_forestales": dominio(c_tif, ord_tif, lambda c: d_tifo.get(c, c),
                                    extra=lambda c: {"legal": ESTATUS_LEGAL.get(d_tifo.get(c))}),
        "snaspe": dominio(c_sna, ord_sna, lambda c: c,
                          extra=lambda c: {"categoria": canon_cat.get(c)}),
        # Densidad del dosel. `orden` es la posicion en la escala de la guia
        # (1 = Denso ... 5 = Escaso); 'No Aplica' va con null porque no es un
        # grado de densidad, es la ausencia de la pregunta.
        "coberturas": dominio(c_cob, ord_cob, lambda c: lbl_cober[c],
                              extra=lambda c: {
                                  "orden": escala_cober.index(c) + 1 if c in escala_cober else None}),
        # Altura del dosel. `escala` NO es decorativo: 'fina' y 'gruesa' miden lo
        # mismo con reglas distintas y sus tramos se solapan, asi que sumarlas o
        # ponerlas en un mismo eje contaria dos veces el mismo rango.
        "alturas": dominio(c_alt, ord_alt, lambda c: lbl_altura[c],
                           extra=lambda c: {
                               "escala": ESCALA_ALTURA[c][0],
                               "desde": ESCALA_ALTURA[c][1],
                               "hasta": ESCALA_ALTURA[c][2],
                               "orden": orden_altura(c)}),
        "subtipos_forestales": dominio(c_stf, ord_stf, lambda c: lbl_stifo[c],
                                       extra=lambda c: {"tipo_forestal": tifo_de_stifo.get(c)}),
        "especies": dominio(c_esp, ord_esp, lambda c: (esp_meta[c]["comun"]
                                                       or esp_meta[c]["cientifico"] or c),
                            SIN_U16,
                            extra=lambda c: {k: esp_meta[c][k] for k in (
                                "cientifico", "comun", "genero", "grupo", "habito",
                                "arboreo", "origen", "monumento_natural", "decreto_mn",
                                "invasora", "conservacion")}),
        # De donde sale el vocabulario de cada dimension. Va en el manifest para
        # que el visor pueda decirlo en pantalla: 'oficial' se cita, 'datos' no.
        "vocabulario": {
            "usos": "guia", "subusos": "guia", "estructuras": "guia",
            "tipos_forestales": "guia", "coberturas": "guia+datos",
            "alturas": "datos", "subtipos_forestales": "datos",
            "especies": "datos+homologacion", "snaspe": "datos+homologacion",
            "comunas": "datos+homologacion",
            # Las seis derivadas NO salen del dato: salen enteras de la tabla de
            # clasificacion de especies de la Unidad. Decir «deducido de los
            # propios datos» al pie de esos filtros seria atribuirle al Catastro
            # una clasificacion que no hace.
            **{c: "homologacion" for c in ("grupos", "habitos", "arboreas",
                                           "origenes", "invasoras", "conservaciones")},
        },
        # CODIGOS QUE DEJARON DE EXISTIR, y a que se traducen. Las dimensiones
        # cuyo vocabulario sale del texto usan el propio texto como codigo, asi
        # que homologar dos grafias en una borra un codigo que ya viaja en
        # enlaces compartidos. Sin esta tabla, esos enlaces filtrarian nada y
        # nadie lo notaria: el visor no distingue «filtro que no encuentra» de
        # «filtro vacio». `filtrosDesdeURL` la consulta antes de rendirse.
        "alias": {"snaspe": dict(sorted(alias_sna.items())),
                  "stifo": dict(sorted(alias_stf.items()))},
        # La lista literal de la guia, publicada para que el contraste de orden
        # se pueda repetir desde FUERA de este script. Comprobarlo solo aqui
        # dejaria la asercion encerrada en el proceso que produce el dato.
        "vocabulario_guia_cobertura": voc_guia_cober,
        **derivadas,
        "comunas": dominio(c_com, ord_com, lambda c: com_meta[c]["nombre"], SIN_U16,
                           extra=lambda c: {"provincia": com_meta[c]["provincia"],
                                            "region": com_meta[c]["region"],
                                            "bbox": com_meta[c]["bbox"]}),
        # LAS CIFRAS REGIONALES SALEN DE LA COLUMNA que el visor usa para
        # filtrar, no de un GROUP BY aparte. Antes salian de SQL sobre reg_cod
        # mientras el visor filtraba derivando la region de las comunas, y las
        # dos cuentas podian discrepar --y discrepaban: el manifest declaraba
        # 286.529 poligonos en Magallanes y el visor mostraba 286.525--. Ahora
        # coinciden por construccion. `regiones_dom` cruza el dominio con los
        # metadatos (nombre, romana, anio, bbox) que si vienen de SQL.
        "regiones": regiones_dom,
        "snaspe_categoria_corregida": corregidas,
        "codigos_desconocidos": {"subuso": dsc_sub, "estructura": dsc_est,
                                 "cobertura": dsc_cob, "altura": dsc_alt,
                                 "especie": dsc_esp, "subtipo_forestal": dsc_stf},
        "total": {"filas": n, "ha": round(float(ha64.sum()), 2)},
    }

    ruta_man = os.path.join(SALIDA, "manifest.json")
    with open(ruta_man, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    return manifest, ruta_bin


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="reconstruye y compara sha256 con el manifest ya escrito")
    args = ap.parse_args()

    previo = previo_crudo = None
    ruta_man = os.path.join(SALIDA, "manifest.json")
    if args.check and os.path.exists(ruta_man):
        previo_crudo = open(ruta_man, encoding="utf-8").read()
        previo = json.loads(previo_crudo)

    man, ruta_bin = construir()
    cap = man["capas"]["cbn_puntos"]
    print(f"escrito {ruta_bin}")
    ancho = cap["bytes"] // cap["filas"]
    print(f"  {cap['filas']:,} filas x {ancho} B = {cap['bytes']/1e6:.1f} MB   "
          f"sha256 {cap['sha256'][:16]}…")
    print(f"  total nacional {man['total']['ha']:,.2f} ha")
    print(f"  vocabularios: {len(man['usos'])} usos · {len(man['subusos'])} subusos · "
          f"{len(man['estructuras'])} estructuras · {len(man['tipos_forestales'])} tipos "
          f"forestales · {len(man['subtipos_forestales'])} subtipos · "
          f"{len(man['coberturas'])} coberturas · {len(man['alturas'])} alturas · "
          f"{len(man['especies'])} especies · {len(man['snaspe'])} unidades SNASPE · "
          f"{len(man['comunas'])} comunas · {len(man['regiones'])} regiones")
    print("  cobertura, en el orden de la guia: " +
          " · ".join(f"{c['etiqueta']} {c['ha']/1e6:.2f}M" for c in
                     sorted((x for x in man["coberturas"] if x["orden"]),
                            key=lambda x: x["orden"])))
    for esc in ("fina", "gruesa"):
        cls = sorted((a for a in man["alturas"] if a["escala"] == esc),
                     key=lambda a: a["orden"])
        print(f"  altura escala {esc}: " +
              " · ".join(f"{a['etiqueta']} {a['n']:,}" for a in cls))
    print("  especies mayores: " +
          " · ".join(f"{e['etiqueta']} {e['ha']/1e3:,.0f}k"
                     for e in sorted(man["especies"], key=lambda e: -e["ha"])[:6]))
    print(f"  filas sin dato: {cap['sin_dato']}")
    r = cap.get("radio", {})
    print(f"  radio de los discos: mediana {r.get('mediana_m')} m · max {r.get('max_m')} m · "
          f"recortados por el vecino {r.get('recortados', 0):,} de {cap['filas']:,} "
          f"({100 * r.get('recortados', 0) / cap['filas']:.0f} %)")
    for d in man["snaspe_categoria_corregida"]:
        print(f"  SNASPE {d['unidad']!r}: {d['en_la_capa']} -> {d['usada']!r}")
    for campo, vals in man["codigos_desconocidos"].items():
        if vals:
            print(f"  codigos de {campo} que la guia oficial no nombra: {vals}")

    if previo is not None:
        # Se comparan los DOS artefactos. Comprobar solo el .bin dejaba pasar una
        # no-determinacion real del manifest: el binario era estable y el JSON
        # no, porque el orden de un dict salia del GROUP BY. Tres corridas
        # identicas daban dos hashes distintos del manifest y --check decia
        # IDENTICO igual.
        antes_bin = previo["capas"]["cbn_puntos"].get("sha256")
        igual_bin = antes_bin == cap["sha256"]
        igual_man = previo_crudo == open(ruta_man, encoding="utf-8").read()
        print(f"\n--check  .bin: {'IDENTICO' if igual_bin else 'CAMBIO'}"
              f"   manifest.json: {'IDENTICO' if igual_man else 'CAMBIO'}")
        return 0 if (igual_bin and igual_man) else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
