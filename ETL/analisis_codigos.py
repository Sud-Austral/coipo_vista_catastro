"""Fase 1 - cruza el vocabulario OFICIAL contra el texto de las tablas.

Pregunta que responde: para cada campo tematico, ¿se puede derivar la etiqueta
canonica desde el codigo (limpio) en vez de reparar el texto (sucio)?

Fuente de verdad, dentro de la propia base:
  tab.xls_guia_codigos_v3_descriptores  (188)  tipo_id, campo_des, id, des
  tab.xls_guia_codigos_v3_usos_comb     (214)  cl_20 + los 5 id + est/t_f/s_tf/uso/des_uso

Compara CONJUNTOS y cuenta filas y hectareas, nunca porcentajes de coincidencia
a secas: un porcentaje mide la heuristica, no los datos.

Uso:  python ETL/analisis_codigos.py [--csv]
"""

import argparse
import os
import re
import sys
import unicodedata
from collections import defaultdict

import duckdb

sys.stdout.reconfigure(encoding="utf-8")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(RAIZ, "data", "catastro_gef_singeometria.duckdb")


def canon(s):
    """Forma canonica para COMPARAR. Nunca para mostrar ni para reproducir:
    colapsa espacios, y eso funde 'Lote B' con 'Lote  B'."""
    if s is None:
        return None
    s = s.replace("–", "-").replace("—", "-")     # guiones tipograficos
    s = s.replace(" ", " ")                            # espacio duro
    s = re.sub(r"[\s\t\n\r]+", " ", s).strip().lower()
    s = "".join(ch for ch in unicodedata.normalize("NFD", s)
                if unicodedata.category(ch) != "Mn")
    return s


def cargar_oficial(con):
    """Devuelve tres cosas: el crosswalk de 6 digitos (solo para el triplete
    USO/SUBUSO/ESTRUCTURA), los descriptores por campo suelto, y las colisiones.

    OJO: cl_20 tiene 10 digitos (uso+sub+est+tifo+stif). Los 6 primeros NO son
    clave unica: el mismo 040201 aparece con 13 tipos forestales distintos. Un
    dict sobre esa clave conserva la ultima aparicion y colapsa el resto EN
    SILENCIO -- ya produjo un diagnostico falso ("todo es siempreverde").
    Por eso TIPO_FORES y SUBTIPOFOR se derivan de ID_TIFO/ID_STIF via
    descriptores, nunca de la combinacion.
    """
    comb = {}
    colisiones = defaultdict(set)
    filas = con.execute("""
        SELECT cl_20, id_uso, id_sub, id_est, id_tifo, id_stif, est, t_f, s_tf, uso, des_uso
        FROM tab.xls_guia_codigos_v3_usos_comb
    """).fetchall()
    for cl, iu, isu, ie, itf, ist, est, tf, stf, uso6, des in filas:
        if not (iu and isu and ie):
            continue
        clave = f"{iu}{isu}{ie}"
        partes = [p.strip() for p in (des or "").split(",")]
        uso_lbl = partes[0] if partes else None
        sub_lbl = ", ".join(partes[1:-1]) if len(partes) >= 3 else None
        colisiones[clave].add((tf, stf))
        anterior = comb.get(clave)
        nuevo = {"USO": uso_lbl, "SUBUSO": sub_lbl, "ESTRUCTURA": est}
        if anterior and anterior != nuevo:
            colisiones[clave].add(("!TRIPLETE-DISTINTO!", str(nuevo)))
        comb[clave] = nuevo

    suelto = defaultdict(dict)
    for tipo, campo, i, des in con.execute("""
        SELECT tipo_id, campo_des, id, des FROM tab.xls_guia_codigos_v3_descriptores
    """).fetchall():
        suelto[(tipo, campo)][i] = des
    return comb, suelto, colisiones


def comparar(nombre, pares, ha_por_fila):
    """pares: lista de (texto, oficial, ha). Devuelve resumen y desacuerdos."""
    ok = 0
    des = defaultdict(lambda: [0, 0.0])
    for texto, oficial, ha in pares:
        if oficial is None:
            continue
        if canon(texto) == canon(oficial):
            ok += 1
        else:
            k = (canon(texto), canon(oficial))
            des[k][0] += 1
            des[k][1] += ha or 0.0
    tot = ok + sum(v[0] for v in des.values())
    return ok, tot, des


def bloque(titulo):
    print()
    print("=" * 78)
    print(f"  {titulo}")
    print("=" * 78)


def informe(nombre, ok, tot, des, tope=10):
    n_des = sum(v[0] for v in des.values())
    ha_des = sum(v[1] for v in des.values())
    estado = "IDENTICO" if n_des == 0 else f"{n_des:,} filas divergen"
    print(f"\n  ### {nombre}: {ok:,}/{tot:,} concuerdan  -> {estado}"
          + (f"  ({ha_des:,.0f} ha)" if n_des else ""))
    for (t_, o_), (n, ha) in sorted(des.items(), key=lambda x: -x[1][0])[:tope]:
        marca = "  <-- SEMANTICO" if _semantico(t_, o_) else ""
        print(f"      n={n:>7,}  {ha:>12,.0f} ha   texto={t_!r}")
        print(f"                                oficial={o_!r}{marca}")
    if len(des) > tope:
        print(f"      … +{len(des) - tope} formas mas")


def _semantico(t_, o_):
    """Heuristica MUY conservadora para separar 'otra grafia' de 'otra cosa'.
    Si ninguna palabra de 4+ letras es comun a ambos, es sospechoso de ser una
    discrepancia de fondo y no de ortografia. Marca para revisar A MANO, no
    decide nada."""
    if t_ is None or o_ is None:
        return True
    pt = {w for w in re.findall(r"\w{4,}", t_)}
    po = {w for w in re.findall(r"\w{4,}", o_)}
    return not (pt & po)


def analizar_cbn(con, comb, suelto):
    bloque("CBN - etiqueta derivada del codigo vs texto de la tabla")
    filas = con.execute("""
        SELECT ID_USO, ID_SUBUSO, ID_ESTRUC, ID_TIFO, ID_STIF,
               USO, SUBUSO, ESTRUCTURA, TIPO_FORES, SUBTIPOFOR,
               COALESCE(SUPERF_HA, 0)
        FROM cbn_nacional_atributos
    """).fetchall()
    print(f"  filas: {len(filas):,}")

    # Campos de un solo codigo: se derivan de su PROPIO id, no del triplete.
    d_tifo = suelto.get(("ID_TIFO_", "T_F_"), {})
    d_stif = suelto.get(("ID_STIF_", "S_TF_"), {})
    d_est  = suelto.get(("ID_EST_",  "EST_"), {})

    sin_codigo = 0
    fuera_guia = defaultdict(int)
    campos = ["USO", "SUBUSO", "ESTRUCTURA", "ESTRUCTURA(via ID_EST)",
              "TIPO_FORES", "SUBTIPOFOR"]
    pares = {c: [] for c in campos}

    for iu, isu, ie, itf, ist, uso, sub, est, tf, stf, ha in filas:
        if not (iu and isu and ie):
            sin_codigo += 1
            continue
        of = comb.get(f"{iu}{isu}{ie}")
        if of is None:
            fuera_guia[f"{iu}{isu}{ie}"] += 1
            continue
        pares["USO"].append((uso, of["USO"], ha))
        pares["SUBUSO"].append((sub, of["SUBUSO"], ha))
        pares["ESTRUCTURA"].append((est, of["ESTRUCTURA"], ha))
        if ie in d_est:
            pares["ESTRUCTURA(via ID_EST)"].append((est, d_est[ie], ha))
        if itf is not None and itf in d_tifo and tf is not None:
            pares["TIPO_FORES"].append((tf, d_tifo[itf], ha))
        if ist is not None and ist in d_stif and stf is not None:
            pares["SUBTIPOFOR"].append((stf, d_stif[ist], ha))

    print(f"  filas sin codigo completo : {sin_codigo:,}")
    print(f"  codigos fuera de la guia  : {sum(fuera_guia.values()):,} "
          f"en {len(fuera_guia)} clave(s) {dict(list(fuera_guia.items())[:5])}")
    for c in campos:
        if pares[c]:
            informe(c, *comparar(c, pares[c], None))
        else:
            print(f"\n  ### {c}: sin pares comparables")
    return sin_codigo, fuera_guia


def analizar_simef(con, suelto):
    bloque("SIMEF - descriptores oficiales vs texto (corte 2021)")
    # SIMEF nombra por anio. Se toma 2021, el corte presente en ~100% de filas.
    tabla = [
        ("USO_IPCC21", ("ID_USO_", "USO_IPCC_"), "ID_USO_21"),
        ("T_F_21",     ("ID_TIFO_", "T_F_"),     "ID_TIFO_21"),
        ("D_TC_19_21", ("TC_", "D_TC_"),         "TC_19_21"),
    ]
    for col_texto, clave_desc, col_cod in tabla:
        dic = suelto.get(clave_desc, {})
        if not dic:
            print(f"\n  ### {col_texto}: sin descriptores para {clave_desc}, se omite")
            continue
        try:
            filas = con.execute(f"""
                SELECT {col_cod}, {col_texto}, COALESCE(SUP_HA,0)
                FROM simef_nacional_atributos
                WHERE {col_cod} IS NOT NULL AND {col_texto} IS NOT NULL
            """).fetchall()
        except Exception as e:
            print(f"\n  ### {col_texto}: no consultable ({type(e).__name__}: {str(e)[:80]})")
            continue
        pares = [(txt, dic.get(cod), ha) for cod, txt, ha in filas]
        sin_desc = sum(1 for _, o, _ in pares if o is None)
        informe(f"{col_texto} (via {col_cod})", *comparar(col_texto, pares, None))
        if sin_desc:
            print(f"      + {sin_desc:,} filas cuyo codigo no esta en la guia")


def analizar_conjuntos(con, comb, suelto):
    """Comparar CONJUNTOS: que hay en los datos y no en la guia, y al reves."""
    bloque("CONJUNTOS - vocabulario observado vs oficial")
    obs_cbn = {canon(r[0]) for r in con.execute(
        "SELECT DISTINCT TIPO_FORES FROM cbn_nacional_atributos WHERE TIPO_FORES IS NOT NULL"
    ).fetchall()}
    obs_simef = {canon(r[0]) for r in con.execute(
        "SELECT DISTINCT T_F_21 FROM simef_nacional_atributos WHERE T_F_21 IS NOT NULL"
    ).fetchall()}
    ofi = {canon(v) for v in suelto.get(("ID_TIFO_", "T_F_"), {}).values()}
    ofi.add(canon("No Aplica"))
    for etiqueta, obs in (("CBN.TIPO_FORES", obs_cbn), ("SIMEF.T_F_21", obs_simef)):
        solo_obs = sorted(x for x in obs - ofi if x)
        solo_ofi = sorted(x for x in ofi - obs if x)
        print(f"\n  {etiqueta}: {len(obs)} formas observadas, {len(ofi)} oficiales")
        print(f"      solo en los datos ({len(solo_obs)}): {solo_obs}")
        print(f"      solo en la guia   ({len(solo_ofi)}): {solo_ofi}")


def main():
    ap = argparse.ArgumentParser()
    ap.parse_args()
    con = duckdb.connect(BASE, read_only=True)
    con.execute("SET preserve_insertion_order=true")
    comb, suelto, colisiones = cargar_oficial(con)
    choca = {k: v for k, v in colisiones.items() if len(v) > 1}
    print(f"crosswalk oficial: {len(comb)} combinaciones de 6 digitos, "
          f"{len(suelto)} familias de descriptores")
    print(f"  claves de 6 digitos con MAS de una fila en usos_comb: {len(choca)} "
          f"(por eso tifo/stif NO se derivan del triplete)")
    for k in sorted(choca)[:3]:
        print(f"    {k}: {len(choca[k])} variantes de (t_f, s_tf)")
    for k in sorted(suelto):
        print(f"   {k[0]!r:>12} -> {k[1]!r:<12} {len(suelto[k]):>4} codigos")
    analizar_cbn(con, comb, suelto)
    analizar_simef(con, suelto)
    analizar_conjuntos(con, comb, suelto)


if __name__ == "__main__":
    main()
