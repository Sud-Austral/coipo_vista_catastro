# -*- coding: utf-8 -*-
"""Datos FICTICIOS para las capturas de docs/Documentacion_Sistema2.

Escribe en <salida>/ un manifest.json y un cbn_puntos.bin del esquema 5 con N puntos
al azar. Toma del manifest real SOLO los vocabularios (clases, regiones, comunas,
especies) y recalcula todas las cifras (n, ha, totales, offsets, sha256) desde los
puntos inventados: el visor los abre como un Catastro, pero ninguna cifra es real.
La «fuente» del manifest lo dice, y la Metodología la imprime.

    python scripts/demo_datos.py <salida> [--n 40000]

No toca frontend/public/datos: sólo lee su manifest.
"""
import argparse
import hashlib
import json
import os
import sys

import numpy as np

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REAL = os.path.join(RAIZ, "frontend", "public", "datos", "manifest.json")
FUENTE = ("DATOS FICTICIOS DE DEMOSTRACIÓN, generados al azar para el manual "
          "(no son el Catastro de CONAF)")
ORDEN = [("lon", "f32"), ("lat", "f32"), ("ha", "f32"), ("comuna", "u16"), ("especie", "u16"),
         ("radio", "u16"), ("uso", "u8"), ("subuso", "u8"), ("estruc", "u8"), ("tifo", "u8"),
         ("snaspe", "u8"), ("cober", "u8"), ("altura", "u8"), ("stifo", "u8"), ("region", "u8")]
NP = {"f32": np.float32, "u16": np.uint16, "u8": np.uint8}
CENTINELA = {"comuna": 65535, "especie": 65535, "subuso": 255, "estruc": 255, "tifo": 255, "snaspe": 255,
             "cober": 255, "altura": 255, "stifo": 255, "region": 255}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("salida")
    ap.add_argument("--n", type=int, default=40000)
    a = ap.parse_args()
    m = json.load(open(REAL, encoding="utf-8"))
    rng = np.random.default_rng(20261113)
    n = a.n

    com = m["comunas"]
    ic = rng.integers(0, len(com), n)
    bb = np.array([c["bbox"] for c in com])
    lon = bb[ic, 0] + rng.random(n) * (bb[ic, 2] - bb[ic, 0])
    lat = bb[ic, 1] + rng.random(n) * (bb[ic, 3] - bb[ic, 1])
    reg_idx = {r["cod"]: i for i, r in enumerate(m["regiones"])}
    region = np.array([reg_idx[com[i]["region"]] for i in ic])
    ha = np.round(np.exp(rng.normal(1.5, 1.6, n)), 2).clip(0.05, 5000)
    radio = np.sqrt(ha * 10000 / np.pi).clip(1, 3000)

    usos, sub, est = m["usos"], m["subusos"], m["estructuras"]
    uso = rng.integers(0, len(usos), n)
    subs_de = {i: [j for j, s in enumerate(sub) if s["uso"] == u["cod"] and not s["cod"].endswith("99")]
               or [j for j, s in enumerate(sub) if s["uso"] == u["cod"]] for i, u in enumerate(usos)}
    subuso = np.array([rng.choice(subs_de[u]) for u in uso])
    est_de = {j: [k for k, e in enumerate(est) if e["subuso"] == s["cod"]] for j, s in enumerate(sub)}
    estruc = np.array([rng.choice(est_de[s]) if est_de[s] else 255 for s in subuso])
    es_bosque = np.array([usos[u]["etiqueta"].lower().startswith("bosque") for u in uso])
    tf = m["tipos_forestales"]
    na_tf = next(i for i, t in enumerate(tf) if t["cod"] == "00")
    tifo = np.where(es_bosque, rng.integers(1, len(tf), n), na_tf)
    st = m["subtipos_forestales"]
    st_de = {i: [k for k, s in enumerate(st) if s["tipo_forestal"] == t["cod"]] for i, t in enumerate(tf)}
    st_na = [k for k, s in enumerate(st) if s["cod"] == "no aplica"]
    stifo = np.array([rng.choice(st_de[t]) if (t != na_tf and st_de[t]) else st_na[0] for t in tifo])
    cober = np.where(es_bosque, rng.integers(1, len(m["coberturas"]), n), 0)
    altura = np.where(es_bosque, rng.integers(1, len(m["alturas"]), n), 255)
    especie = np.where(es_bosque | (rng.random(n) < 0.4), rng.integers(0, len(m["especies"]), n), 65535)
    snaspe = np.where(rng.random(n) < 0.15, rng.integers(0, len(m["snaspe"]), n), 255)

    cols = dict(lon=lon, lat=lat, ha=ha, comuna=ic, especie=especie, radio=radio, uso=uso, subuso=subuso,
                estruc=estruc, tifo=tifo, snaspe=snaspe, cober=cober, altura=altura, stifo=stifo, region=region)
    os.makedirs(a.salida, exist_ok=True)
    campos, partes, off = {}, [], 0
    for nombre, tipo in ORDEN:
        b = np.asarray(cols[nombre]).astype(NP[tipo]).tobytes()
        campos[nombre] = {"tipo": tipo, "offset": off, "centinela": CENTINELA.get(nombre)}
        partes.append(b)
        off += len(b)
    binario = b"".join(partes)
    with open(os.path.join(a.salida, "cbn_puntos.bin"), "wb") as f:
        f.write(binario)

    def recontar(lista, idx):
        for k, d in enumerate(lista):
            sel = idx == k
            d["n"] = int(sel.sum())
            d["ha"] = round(float(ha[sel].sum()), 2)

    for clave, col in (("usos", uso), ("subusos", subuso), ("estructuras", estruc), ("tipos_forestales", tifo),
                       ("snaspe", snaspe), ("coberturas", cober), ("alturas", altura),
                       ("subtipos_forestales", stifo), ("especies", especie), ("comunas", ic),
                       ("regiones", region)):
        recontar(m[clave], np.asarray(col))
    esp = m["especies"]
    for clave, attr in (("grupos", "grupo"), ("habitos", "habito"), ("arboreas", "arboreo"),
                        ("origenes", "origen"), ("invasoras", "invasora"), ("conservaciones", "conservacion")):
        cods = [d["cod"] for d in m[clave]]
        idx = np.array([cods.index(esp[e][attr]) if e != 65535 and esp[e][attr] in cods else -1 for e in especie])
        recontar(m[clave], idx)
    recontar(m["protecciones"], np.where(snaspe == 255, 1, 0))
    tam = np.array([next((k for k, t in enumerate(m["tamanos"])
                          if v >= t["desde"] and (t["hasta"] is None or v < t["hasta"])), len(m["tamanos"]) - 1)
                    for v in ha])
    recontar(m["tamanos"], tam)
    anio_de = [next(k for k, x in enumerate(m["anios"]) if x["cod"] == r["anio"]) for r in m["regiones"]]
    recontar(m["anios"], np.array([anio_de[r] for r in region]))

    capa = m["capas"]["cbn_puntos"]
    capa.update(filas=n, bytes=len(binario), sha256=hashlib.sha256(binario).hexdigest(), campos=campos)
    capa["sin_dato"] = {k: int((np.asarray(cols[k]) == CENTINELA[k]).sum()) for k in capa["sin_dato"]}
    capa["sin_dato_derivado"] = {k: int((especie == 65535).sum()) for k in capa["sin_dato_derivado"]}
    capa["radio"] = {"mediana_m": int(np.median(radio)), "max_m": int(radio.max()), "recortados": 0}
    capa["bbox"] = [float(lon.min()), float(lat.min()), float(lon.max()), float(lat.max())]
    m["total"] = {"filas": n, "ha": round(float(ha.sum()), 2)}
    m["fuente"] = FUENTE
    with open(os.path.join(a.salida, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False)
    print("ficticio: %d puntos, %d bytes, %.0f ha -> %s" % (n, len(binario), ha.sum(), a.salida))


if __name__ == "__main__":
    sys.exit(main())
