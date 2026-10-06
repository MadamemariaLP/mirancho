#!/usr/bin/env python3
"""Recolector de casas baratas en portales públicos de España e Italia.

Fuentes:
  - ES: Portal de Subastas del BOE (judiciales, notariales, AEAT, Seg. Social...)
  - IT: Portale delle Vendite Pubbliche (Ministero della Giustizia)

Escribe web/data/listings.json, que lee la PWA. Solo usa la librería estándar.
Uso:  python3 collector.py [--max-price 60000] [--only es|it]
"""
import argparse
import csv
import html
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from analysis import enrich
from regions import region

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "web" / "data" / "listings.json"
ALERTS = ROOT / "web" / "data" / "alerts.json"
PREFS = ROOT / "web" / "data" / "prefs.json"  # se publica: Mac e iPhone comparten zonas
CONTACTS = ROOT / "data" / "contacts.json"
CACHE = ROOT / "data" / "boe_cache.json"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36"

RURAL_WORDS = [
    "rustic", "rústic", "cortijo", "masia", "masía", "borda", "pajar", "casa de pueblo",
    "casa de labor", "finca", "aldea", "caserio", "caserío", "pazo", "palloza", "cabaña",
    "casale", "cascina", "casolare", "colonica", "masseria", "rurale", "baita", "trullo",
    "fienile", "podere", "frazione", "borgo", "agricol",
]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def http(url, data=None, headers=None, retries=3):
    h = {"User-Agent": UA, **(headers or {})}
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=h)
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8", errors="ignore")
        except Exception as e:  # noqa: BLE001
            if i == retries - 1:
                raise
            log(f"  reintento {url[:80]}: {e}")
            time.sleep(2 * (i + 1))


def norm(s):
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().upper()
    s = re.sub(r"\s+", " ", s).strip()
    # "EJIDO(EL)" / "EJIDO (EL)" -> "EL EJIDO"
    m = re.match(r"^(.*?)\s*\((EL|LA|LOS|LAS|L'|O|A|OS|AS|ELS|LES|IL|LO|GLI|I|LE)\)$", s)
    if m:
        s = f"{m.group(2)} {m.group(1)}".replace("' ", "'")
    return s


def load_pop(path):
    pop = {}
    if path.exists():
        with open(path, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                try:
                    pop[norm(row["name"])] = int(float(row["p"]))
                except (ValueError, KeyError):
                    pass
    return pop


def is_rural(text):
    t = (text or "").lower()
    return any(w in t for w in RURAL_WORDS)


def money(s):
    """'198.860,00 €' -> 198860.0"""
    m = re.search(r"[\d.]+,\d{2}", s or "")
    return float(m.group(0).replace(".", "").replace(",", ".")) if m else None


# ---------------------------------------------------------------- Italia (PVP)
PVP_API = "https://pvp.giustizia.it/ric-496b258c-986a1b71/ric-ms/ricerca/vendite"
PVP_DETAIL = "https://pvp.giustizia.it/pvp/it/detail_annuncio.page?idAnnuncio={}"
SKIP_IT = {"POSTO_AUTO", "GARAGE_AUTORIMESSA", "MAGAZZINI_E_DEPOSITO", "DEPOSITO", "UFFICI_E_STUDI"}


def collect_it(max_price, pop):
    out, page = [], 0
    body = json.dumps({
        "tipoLotto": "IMMOBILI", "filtroAnnunci": 1,  # 1 = vendite future
        "categoriaLotto": "IMMOBILE_RESIDENZIALE", "prezzoBaseAstaMax": max_price,
    }).encode()
    while True:
        q = urllib.parse.urlencode({"language": "it", "page": page, "size": 200, "sort": "prezzoBaseAsta,asc"})
        d = json.loads(http(f"{PVP_API}?{q}", data=body, headers={"Content-Type": "application/json"}))["body"]
        for x in d["content"]:
            cats = set(x.get("categoriaBene") or [])
            if cats and cats <= SKIP_IT:
                continue  # solo garaje / trastero
            ind = x.get("indirizzo") or {}
            coord = ind.get("coordinate") or {}
            town = (ind.get("citta") or "").strip()
            desc = (x.get("descLotto") or "").strip()
            out.append({
                "id": f"it-{x['id']}",
                "country": "IT",
                "source": "Portale Vendite Pubbliche",
                "kind": "Subasta judicial",
                "title": desc[:140] or "Immobile residenziale",
                "description": desc,
                "town": town.title(),
                "province": ind.get("provincia") or "",
                "address": ind.get("via") or "",
                "lat": coord.get("latitudine"),
                "lon": coord.get("longitudine"),
                "price": x.get("prezzoBaseAsta"),
                "minOffer": x.get("offertaMinima"),
                "date": x.get("dataVendita"),
                "time": x.get("orarioVendita"),
                "categories": sorted(cats),
                "occupancy": ", ".join(sorted(set(x.get("disponibilita") or []))),
                "authority": x.get("tribunale") or "",
                "image": x.get("immagineCover") or x.get("immagine"),
                "url": PVP_DETAIL.format(x["id"]),
                "population": pop.get(norm(town)),
                "rural": is_rural(desc) or bool(cats & {"ABITAZIONE_TIPO_RUR", "FABBRICATO", "STALLE_SCUDERIE_RIMESSE"}),
            })
        log(f"  IT página {page + 1}/{d['totalPages']} ({len(out)} lotes)")
        page += 1
        if page >= d["totalPages"]:
            return enrich_it(out)
        time.sleep(0.5)


PVP_DETAIL_API = "https://pvp.giustizia.it/ve-3f723b85-986a1b71/ve-ms/vendite/{}/restricted"
PVP_FILES = "https://resource-pvp.giustizia.it"
PVP_CACHE = ROOT / "data" / "pvp_cache.json"
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp")


def pvp_detail(vid):
    b = json.loads(http(PVP_DETAIL_API.format(vid)))["body"]
    allegati = list(b.get("allegati") or [])
    surface = floor = rooms = None
    for be in b.get("beni") or []:
        allegati += be.get("allegati") or []
        surface = surface or be.get("superficie")
        floor = floor or be.get("piano")
        rooms = rooms or be.get("numeroVani")
    photos, docs, seen = [], [], set()
    for a in allegati:
        link, name = a.get("linkAllegato"), a.get("nomeFile") or "Documento"
        if not link or link in seen:
            continue
        seen.add(link)
        url = PVP_FILES + urllib.parse.quote(link, safe="/?=&")
        if name.lower().endswith(IMG_EXT) or (a.get("descrizione") or "").upper() == "IMMAGINE BENE":
            photos.append(url)
        else:
            docs.append({"name": name, "url": url})
    # custodio: solo teléfono y correo profesionales (sin nombres ni códigos fiscales)
    custode = next(({"phone": s.get("telefono"), "email": s.get("email")} for s in b.get("soggetti") or []
                    if s.get("ruolo") == "CUSTODE" and (s.get("telefono") or s.get("email"))), None)
    return {"photos": photos[:12], "docs": docs[:12], "surface": surface, "floor": floor, "rooms": rooms,
            "offerDeadline": f"{b.get('dataTermPresOff') or ''} {b.get('oraTermPresOff') or ''}".strip() or None,
            "saleMode": b.get("descModVendita"), "custode": custode}


def enrich_it(listings):
    cache = json.loads(PVP_CACHE.read_text()) if PVP_CACHE.exists() else {}
    todo = [x["id"][3:] for x in listings if x["id"][3:] not in cache]
    log(f"  IT fichas nuevas a descargar: {len(todo)} (en caché: {len(listings) - len(todo)})")

    def fetch(vid):
        try:
            return vid, pvp_detail(vid)
        except Exception as e:  # noqa: BLE001
            log(f"  error ficha {vid}: {e}")
            return vid, None

    with ThreadPoolExecutor(max_workers=4) as ex:
        for n, (vid, det) in enumerate(ex.map(fetch, todo), 1):
            if det:
                cache[vid] = det
            if n % 200 == 0:
                log(f"  IT {n}/{len(todo)} fichas")
                PVP_CACHE.write_text(json.dumps(cache, ensure_ascii=False))
    ids = {x["id"][3:] for x in listings}
    cache = {k: v for k, v in cache.items() if k in ids}
    PVP_CACHE.write_text(json.dumps(cache, ensure_ascii=False))
    for x in listings:
        d = cache.get(x["id"][3:])
        if not d:
            continue
        x.update({k: d[k] for k in ("photos", "docs", "floor", "rooms", "offerDeadline", "saleMode", "custode")})
        x["photoSource"] = "Tribunal" if d["photos"] else None
        if d.get("surface") and not x.get("m2"):
            m = re.search(r"[\d.,]+", d["surface"])
            if m:
                try:
                    v = float(m.group(0).replace(".", "").replace(",", "."))
                    x["surfaceOfficial"] = v
                except ValueError:
                    pass
    return listings


# ------------------------------------------------------------ España (BOE)
BOE = "https://subastas.boe.es/"
SUBTYPES = {"501": "Vivienda", "507": "Finca rústica"}
CATASTRO_FOTO = "https://ovc.catastro.meh.es/OVCServWeb/OVCWcfLibres/OVCFotoFachada.svc/RecuperarFotoFachadaGet?ReferenciaCatastral={}"
HOUSE_WORDS = r"casa|vivienda|edificaci|construcci|cortijo|mas[ií]a|caser[ií]o|borda|pajar|corral|almac[eé]n|nave|caseta|planta baja"
STATES = {"EJ": "Celebrándose", "PU": "Próxima apertura"}


def boe_search(state, subtype):
    params = {
        "campo[2]": "SUBASTA.ESTADO.CODIGO", "dato[2]": state,
        "campo[3]": "BIEN.TIPO", "dato[3]": "I",
        "campo[4]": "BIEN.SUBTIPO", "dato[4]": subtype,
        "page_hits": "500", "accion": "Buscar",
    }
    s = http(BOE + "subastas_ava.php?" + urllib.parse.urlencode(params))
    ids = re.findall(r"detalleSubasta\.php\?idSub=([A-Z0-9-]+)", s)
    m = re.search(r"Resultados \d+ a \d+ de (\d+)", s)
    total = int(m.group(1)) if m else 0
    bus = re.search(r"id_busqueda=([^\"&]+?),", s)
    off = 500
    while bus and off < total:
        time.sleep(0.5)
        s = http(f"{BOE}subastas_ava.php?accion=Mas&id_busqueda={bus.group(1)},-{off}-500")
        ids += re.findall(r"detalleSubasta\.php\?idSub=([A-Z0-9-]+)", s)
        off += 500
    return list(dict.fromkeys(ids))


def boe_fields(page):
    rows = re.findall(r"<th[^>]*>(.*?)</th>\s*<td[^>]*>(.*?)</td>", page, re.S)
    clean = lambda v: html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", v))).strip()
    return [(clean(k), clean(v)) for k, v in rows]


def boe_detail(sid):
    general = boe_fields(http(f"{BOE}detalleSubasta.php?idSub={sid}&ver=1"))
    time.sleep(0.3)
    bienes = boe_fields(http(f"{BOE}detalleSubasta.php?idSub={sid}&ver=3"))
    g = dict(general)
    first = {}
    for k, v in bienes:
        first.setdefault(k, v)
    values = [money(v) for k, v in general + bienes if k.lower() == "valor subasta"]
    values = [v for v in values if v]
    tasacion = [money(v) for k, v in general + bienes if k.lower() == "tasación"]
    tasacion = [v for v in tasacion if v]
    return {
        "type": g.get("Tipo de subasta", ""),
        "end": (re.search(r"ISO: ([\d\-T:+]+)", g.get("Fecha de conclusión", "")) or [None, None])[1],
        "lots": g.get("Lotes", ""),
        "value": min(values) if values else None,
        "appraisal": min(tasacion) if tasacion else None,
        "deposit": money(g.get("Importe del depósito", "")),
        "minBid": g.get("Puja mínima", ""),
        "description": first.get("Descripción", ""),
        "address": first.get("Dirección", ""),
        "town": first.get("Localidad", ""),
        "province": first.get("Provincia", ""),
        "habitual": first.get("Vivienda habitual", ""),
        "possession": first.get("Situación posesoria", ""),
        "visitable": first.get("Visitable", ""),
        "refcat": next((v for k, v in bienes if "catastral" in k.lower() and len(v) >= 14), None),
        "authority": g.get("Autoridad gestora", "") or g.get("Descripción", ""),
    }


def collect_es(max_price, pop):
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    found = {}
    for st, st_name in STATES.items():
        for sub, sub_name in SUBTYPES.items():
            ids = boe_search(st, sub)
            log(f"  ES {st_name} / {sub_name}: {len(ids)} subastas")
            for i in ids:
                found.setdefault(i, (st_name, sub_name))
            time.sleep(0.5)

    # fichas antiguas sin referencia catastral: se vuelven a leer una vez
    todo = [i for i in found if i not in cache or "refcat" not in cache[i]]
    log(f"  ES fichas nuevas a descargar: {len(todo)} (en caché: {len(found) - len(todo)})")

    def fetch(sid):
        try:
            return sid, boe_detail(sid)
        except Exception as e:  # noqa: BLE001
            log(f"  error {sid}: {e}")
            return sid, None

    with ThreadPoolExecutor(max_workers=4) as ex:
        for n, (sid, det) in enumerate(ex.map(fetch, todo), 1):
            if det:
                cache[sid] = det
            if n % 50 == 0:
                log(f"  ES {n}/{len(todo)} fichas")
                CACHE.write_text(json.dumps(cache, ensure_ascii=False))
    # La caché solo guarda subastas que siguen activas
    cache = {k: v for k, v in cache.items() if k in found}
    CACHE.write_text(json.dumps(cache, ensure_ascii=False))

    out = []
    for sid, (st_name, sub_name) in found.items():
        d = cache.get(sid)
        if not d or d["value"] is None or d["value"] > max_price:
            continue
        # Las fincas rústicas solo interesan si hay una casa o edificación dentro
        if sub_name == "Finca rústica" and not re.search(HOUSE_WORDS, d["description"], re.I):
            continue
        town = d["town"]
        out.append({
            "id": f"es-{sid}",
            "country": "ES",
            "source": "Subastas BOE",
            "kind": d["type"].capitalize() or "Subasta",
            "title": f"{sub_name} en {town.title()}" if town else sub_name,
            "description": d["description"],
            "town": town.title(),
            "province": d["province"],
            "address": d["address"],
            "lat": None, "lon": None,
            "price": d["value"],
            "minOffer": None,
            "appraisal": d["appraisal"],
            "deposit": d["deposit"],
            "date": (d["end"] or "")[:10],
            "endISO": d["end"],
            "status": st_name,
            "categories": [sub_name],
            "occupancy": d["possession"],
            "habitual": f"Vivienda habitual: {d['habitual']}" if d["habitual"] else "",
            "authority": d["authority"],
            "image": None,
            "refcat": d.get("refcat"),
            "photos": [CATASTRO_FOTO.format(d["refcat"][:14])] if d.get("refcat") else [],
            "photoSource": "Catastro (fachada)" if d.get("refcat") else None,
            "url": f"{BOE}detalleSubasta.php?idSub={sid}",
            "population": pop.get(norm(town)),
            "rural": sub_name == "Finca rústica" or is_rural(d["description"]),
        })
    return out


def boe_contact(sid):
    """Pestaña «Autoridad gestora» de una subasta del BOE, con caché."""
    cache = json.loads(CONTACTS.read_text()) if CONTACTS.exists() else {}
    if sid in cache:
        return cache[sid]
    f = dict(boe_fields(http(f"{BOE}detalleSubasta.php?idSub={urllib.parse.quote(sid)}&ver=2")))
    c = {"name": f.get("Descripción", ""), "address": f.get("Dirección", "").replace(" ; ", ", "),
         "phone": f.get("Teléfono", ""), "email": f.get("Correo electrónico", ""),
         "url": f"{BOE}detalleSubasta.php?idSub={sid}&ver=2"}
    if c["name"] or c["email"]:
        cache = json.loads(CONTACTS.read_text()) if CONTACTS.exists() else {}
        cache[sid] = c
        CONTACTS.write_text(json.dumps(cache, ensure_ascii=False))
    return c


NAME = r"[A-ZÁÉÍÓÚÑÀÈÌÒÙ][A-Za-zÁÉÍÓÚÑÀÈÌÒÙáéíóúñàèìòùü'’-]+"
PERSON_RX = re.compile(
    r"(?<!CALLE )(?<!Calle )(?<!C/ )(?<!AVDA\. )(?<!PLAZA )(?<!Plaza )(?<!VIA )(?<!Via )(?<!via )"
    r"\b(Don|Doña|DON|DOÑA|D\.|Dña\.|Dª|Sr\.|Sra\.|sig\.(?:ra)?|Sig\.(?:ra)?|signor[ae]?)\s+"
    rf"{NAME}(?:\s+(?:de\s+|del\s+|de\s+la\s+|y\s+|di\s+|De\s+)?{NAME}){{0,4}}")


HEIRS_RX = re.compile(
    r"(?i:(herederos de|eredi di|titular(?:es)?:?|propietari[oa]s?:?|intestat[oa] a|a nome d[ei]|esposos|cónyuges|coniugi))\s+"
    rf"(?!no\b|catastral\b|registral\b){NAME}(?:\s+(?:de\s+|del\s+|y\s+|e\s+)?{NAME}){{1,4}}")


def redact(text):
    """Quita nombres de particulares (linderos, titulares, herederos) antes de publicar."""
    if not text:
        return text
    text = PERSON_RX.sub(lambda m: m.group(1) + " [nombre omitido]", text)
    return HEIRS_RX.sub(lambda m: m.group(1) + " [nombre omitido]", text)


def export_static(listings):
    """Archivos que necesita la app publicada (iPhone), que no tiene servidor."""
    import ai
    import geo
    from regions import all_regions
    data = ROOT / "web" / "data"
    contacts = {}
    for x in listings:
        if x["country"] == "ES":
            try:
                contacts[x["id"]] = boe_contact(x["id"][3:])
            except Exception as e:  # noqa: BLE001
                log(f"  contacto {x['id']}: {e}")
    (data / "contacts.json").write_text(json.dumps(contacts, ensure_ascii=False))
    (data / "ai.json").write_text(json.dumps({"system": ai.SYSTEM, "schema": ai.SCHEMA}, ensure_ascii=False))
    (data / "regions.json").write_text(json.dumps(all_regions(), ensure_ascii=False))
    ids = {x["id"] for x in listings}
    g = json.loads(geo.CACHE.read_text()) if geo.CACHE.exists() else {}
    (data / "geo.json").write_text(json.dumps({k: v for k, v in g.items() if k in ids}, ensure_ascii=False))
    log(f"  exportado: {len(contacts)} contactos, {sum(1 for k in g if k in ids)} ubicaciones")


def add_region(x):
    r = region(x["country"], x.get("province"))
    if not r:  # la PVP a veces no trae provincia: usa la ciudad del tribunal
        m = re.search(r"Tribunale di ([A-Za-zÀ-ÿ' ]+?)(?: ex |$)", x.get("authority") or "")
        r = region(x["country"], m.group(1)) if m else None
    x["region"] = r
    return x


def prefs():
    return json.loads(PREFS.read_text()) if PREFS.exists() else {"favRegions": [], "alertMaxPrice": 30000}


PUBLIC_URL = "https://madamemarialp.github.io/mirancho/"
NTFY = ROOT / "data" / "ntfy.json"  # canal privado: no se publica


def ntfy(title, message, click=None, priority="high", tags="house"):
    """Notificación al móvil con la app ntfy (tú y quien se suscriba al canal)."""
    if not NTFY.exists():
        return
    cfg = json.loads(NTFY.read_text())
    import subprocess
    cmd = ["curl", "-sS", "-m", "20", "-H", f"Title: {title}", "-H", f"Priority: {priority}", "-H", f"Tags: {tags}",
           "-d", message, f"{cfg['server']}/{cfg['topic']}"]
    if click:
        cmd[1:1] = ["-H", f"Click: {click}"]
    subprocess.run(cmd, capture_output=True, timeout=30, check=False)


def alerts(listings, new_ids):
    """Casas nuevas en las zonas favoritas → historial + notificación del Mac."""
    p = prefs()
    fav = set(p.get("favRegions", []))
    hits = [x for x in listings if x["id"] in new_ids and x.get("region") in fav
            and (x.get("price") or 0) <= p.get("alertMaxPrice", 30000)
            and not (p.get("alertSkipStop", True) and x["verdict"] == "stop")]
    hist = json.loads(ALERTS.read_text()) if ALERTS.exists() else []
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    hist = [{"id": x["id"], "at": now} for x in hits] + hist
    ALERTS.write_text(json.dumps(hist[:500], ensure_ascii=False))
    if hits and p.get("notify", True):
        by = {}
        for x in hits:
            by[x["region"]] = by.get(x["region"], 0) + 1
        body = ", ".join(f"{n} en {r}" for r, n in by.items())
        cheapest = min(hits, key=lambda x: x["price"])
        sub = f"Desde {cheapest['price']:,.0f} € en {cheapest['town']}".replace(",", ".")
        title = f"🏡 {len(hits)} casa{'s' if len(hits) > 1 else ''} nueva{'s' if len(hits) > 1 else ''} en tus zonas"
        script = f'display notification "{sub}" with title "{title}" subtitle "{body}" sound name "Glass"'
        try:
            import subprocess
            subprocess.run(["osascript", "-e", script], timeout=10, check=False)
        except Exception:  # noqa: BLE001
            pass
    if hits and p.get("notify", True):
        try:
            for x in sorted(hits, key=lambda x: x["price"])[:5]:
                ntfy(f"🏡 {x['town']} ({x['region']}) · {x['price']:,.0f} €".replace(",", "."),
                     f"{x['kindLabel']} · {x['title'][:120]}",
                     click=f"{PUBLIC_URL}#casa={urllib.parse.quote(x['id'])}")
            if len(hits) > 5:
                ntfy(f"🔔 +{len(hits) - 5} casas nuevas más en tus zonas", "Ábrelas en la pestaña Alertas de MiRancho.",
                     click=PUBLIC_URL, priority="default")
        except Exception as e:  # noqa: BLE001
            log(f"  ntfy: {e}")
    log(f"Alertas: {len(hits)} casas nuevas en {', '.join(sorted(fav)) or 'ninguna zona'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-price", type=int, default=60000,
                    help="tope al recolectar; la app filtra después (por defecto 30.000)")
    ap.add_argument("--only", choices=["es", "it"])
    ap.add_argument("--reanalyze", action="store_true", help="solo recalcula el análisis sin descargar")
    a = ap.parse_args()
    if a.reanalyze:
        d = json.loads(OUT.read_text())
        pops = {c: load_pop(ROOT / "data" / f"pop_{c.lower()}.csv") for c in ("ES", "IT")}
        for x in d["listings"]:
            x["population"] = pops[x["country"]].get(norm(x["town"]))
        d["listings"] = [add_region(enrich(x)) for x in d["listings"] if (x.get("price") or 0) >= 500]
        for x in d["listings"]:
            for k in ("title", "description", "address"):
                x[k] = redact(x.get(k))
        OUT.write_text(json.dumps(d, ensure_ascii=False))
        export_static(d["listings"])
        return log(f"OK: reanalizados {len(d['listings'])}")

    prev = json.loads(OUT.read_text()) if OUT.exists() else {"listings": []}
    listings = [x for x in prev.get("listings", []) if a.only and x["country"] != a.only.upper()]
    errors = []
    for code, fn, popfile in (("es", collect_es, "pop_es.csv"), ("it", collect_it, "pop_it.csv")):
        if a.only and a.only != code:
            continue
        log(f"== {code.upper()} ==")
        try:
            listings += fn(a.max_price, load_pop(ROOT / "data" / popfile))
        except Exception as e:  # noqa: BLE001
            log(f"  FALLO {code}: {e}")
            errors.append(f"{code}: {e}")
            listings += [x for x in prev.get("listings", []) if x["country"] == code.upper()]

    seen_before = {x["id"]: x.get("firstSeen") for x in prev.get("listings", [])}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for x in listings:
        x["firstSeen"] = seen_before.get(x["id"]) or now
    listings = [add_region(enrich(x)) for x in listings if (x.get("price") or 0) >= 500]
    listings.sort(key=lambda x: x["price"] or 0)
    for x in listings:
        for k in ("title", "description", "address"):
            x[k] = redact(x.get(k))
    OUT.write_text(json.dumps({"updated": now, "errors": errors, "listings": listings}, ensure_ascii=False))
    export_static(listings)
    if seen_before:  # en la primera ejecución todo es «nuevo»: no avisa
        alerts(listings, {x["id"] for x in listings if x["id"] not in seen_before})
    log(f"OK: {len(listings)} anuncios -> {OUT}")


if __name__ == "__main__":
    main()
