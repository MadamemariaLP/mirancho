#!/usr/bin/env python3
"""Traduce al español los anuncios italianos, sin conexión (Argos Translate, italiano → inglés → español).

Se ejecuta con el Python del entorno virtual después de collector.py (lo hace publish.sh).
Cada texto se traduce una sola vez: las traducciones se guardan en data/translations.json.
Uso:  .venv/bin/python translate.py [--limit N]
"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LISTINGS = ROOT / "web" / "data" / "listings.json"
CACHE = ROOT / "data" / "translations.json"
PREFS = ROOT / "web" / "data" / "prefs.json"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def key(text):
    return hashlib.sha1((text or "").encode("utf-8")).hexdigest()[:16]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="máximo de anuncios nuevos a traducir en esta pasada")
    a = ap.parse_args()

    data = json.loads(LISTINGS.read_text())
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    fav = set((json.loads(PREFS.read_text()) if PREFS.exists() else {}).get("favRegions", []))
    it = [x for x in data["listings"] if x["country"] == "IT"]

    def missing(x):
        return any(t and key(t) not in cache for t in (x.get("title"), x.get("description")))

    # primero tus zonas y lo más barato
    todo = sorted((x for x in it if missing(x)), key=lambda x: (x.get("region") not in fav, x.get("price") or 0))
    if a.limit:
        todo = todo[:a.limit]
    if todo:
        import argostranslate.translate as T  # solo en .venv
        log(f"Traduciendo {len(todo)} anuncios italianos…")
        t0 = time.time()
        for n, x in enumerate(todo, 1):
            for t in (x.get("title"), x.get("description")):
                if t and key(t) not in cache:
                    try:
                        cache[key(t)] = T.translate(t, "it", "es")
                    except Exception as e:  # noqa: BLE001
                        log(f"  error {x['id']}: {e}")
            if n % 50 == 0:
                CACHE.write_text(json.dumps(cache, ensure_ascii=False))
                log(f"  {n}/{len(todo)} ({(time.time() - t0) / n:.1f} s/anuncio)")
        CACHE.write_text(json.dumps(cache, ensure_ascii=False))

    # vuelve a leer por si collector.py lo ha cambiado mientras se traducía
    data = json.loads(LISTINGS.read_text())
    it = [x for x in data["listings"] if x["country"] == "IT"]
    done = 0
    for x in it:
        x["title_es"] = cache.get(key(x.get("title")))
        x["description_es"] = cache.get(key(x.get("description")))
        done += bool(x["description_es"] or x["title_es"])
    LISTINGS.write_text(json.dumps(data, ensure_ascii=False))
    log(f"OK: {done}/{len(it)} anuncios italianos en español")


if __name__ == "__main__":
    main()
