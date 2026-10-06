"""Análisis geográfico bajo demanda de un anuncio, con fuentes abiertas:

  - Nominatim (OSM): ubicación cuando el anuncio no trae coordenadas (centro del pueblo)
  - Overpass (OSM): servicios, vecinos, carreteras, bosque, agua, cultivos, líneas eléctricas
  - OSRM: tiempos en coche
  - Open-Meteo: elevación (DEM ~90 m) → pendiente y orientación
  - PVGIS (JRC, Comisión Europea): producción solar anual

Los resultados se guardan en data/geo_cache.json.
"""
import json
import math
import threading
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "data" / "geo_cache.json"
UA = "casas-rurales-personal/0.1 (uso personal)"
_lock = threading.Lock()
_last_nominatim = [0.0]

OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]

# clave, emoji, etiqueta, filtro Overpass, radio (m)
POI = [
    ("supermarket", "🛒", "Supermercado", 'nwr["shop"~"supermarket|convenience"]', 25000),
    ("hospital", "🏥", "Hospital", 'nwr["amenity"="hospital"]', 60000),
    ("doctor", "🩺", "Centro de salud / farmacia", 'nwr["amenity"~"clinic|doctors|pharmacy"]', 20000),
    ("school", "🏫", "Escuela", 'nwr["amenity"="school"]', 20000),
    ("station", "🚉", "Estación de tren", 'nwr["railway"="station"]["usage"!~"tourism"]', 50000),
    ("airport", "✈️", "Aeropuerto", 'nwr["aeroway"="aerodrome"]["iata"]', 200000),
    ("beach", "🏖️", "Playa", 'nwr["natural"="beach"]', 80000),
    ("village", "🏘️", "Pueblo / ciudad", 'node["place"~"village|town|city"]', 20000),
    ("town", "🏙️", "Ciudad (>10k hab.)", 'node["place"~"town|city"]', 60000),
    ("peak", "🏔️", "Montaña (cima)", 'node["natural"="peak"]', 25000),
    ("water", "🌊", "Río o lago", 'nwr["natural"="water"];way["waterway"~"river|stream"]', 5000),
    ("forest", "🌲", "Bosque", 'way["landuse"="forest"];way["natural"="wood"]', 3000),
]
DRIVE = ["supermarket", "doctor", "hospital", "school", "station", "airport", "beach", "town"]


def _get(url, data=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.URLError as e:
        if "SSL" not in str(e.reason):
            raise
    # El Python de macOS (LibreSSL) no negocia TLS con algunos servidores: usa curl
    cmd = ["curl", "-sS", "--fail", "-m", str(timeout), "-A", UA, url]
    if data is not None:
        cmd[1:1] = ["--data-binary", "@-"]
    r = subprocess.run(cmd, input=data, capture_output=True, check=True)
    return json.loads(r.stdout.decode("utf-8"))


def km(a, b, c, d):
    p = math.pi / 180
    h = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def _center(el):
    if "lat" in el:
        return el["lat"], el["lon"]
    c = el.get("center")
    return (c["lat"], c["lon"]) if c else (None, None)


def geocode(x):
    if x.get("lat"):
        return x["lat"], x["lon"], False
    q = ", ".join(filter(None, [x.get("town"), x.get("province"), "España" if x["country"] == "ES" else "Italia"]))
    wait = 1.1 - (time.time() - _last_nominatim[0])
    if wait > 0:
        time.sleep(wait)
    _last_nominatim[0] = time.time()
    r = _get("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "json", "limit": 1, "countrycodes": x["country"].lower()}))
    if not r:
        return None, None, True
    return float(r[0]["lat"]), float(r[0]["lon"]), True


def overpass(lat, lon):
    parts = []
    for key, _, _, flt, rad in POI:
        for f in flt.split(";"):
            parts.append(f'{f}(around:{rad},{lat},{lon});')
    q = f"""[out:json][timeout:60];
(
{''.join(parts)}
);
out center tags qt 3000;
(way["building"](around:400,{lat},{lon}););out center tags qt 400;
(way["highway"~"^(primary|secondary|tertiary|unclassified|residential|track|service)$"](around:1500,{lat},{lon}););out center tags qt 300;
(way["power"="line"](around:2000,{lat},{lon});node["power"~"pole|tower"](around:1000,{lat},{lon}););out center tags qt 50;
(way["landuse"~"vineyard|orchard|farmland|meadow|olive"](around:600,{lat},{lon}););out center tags qt 100;
(node["man_made"~"water_well|water_tower"](around:3000,{lat},{lon});node["natural"="spring"](around:3000,{lat},{lon}););out tags qt 20;
(node["communication:mobile_phone"](around:15000,{lat},{lon});nwr["tower:type"="communication"](around:15000,{lat},{lon}););out center tags qt 30;"""
    last = None
    for url in OVERPASS:
        try:
            return _get(url, data=urllib.parse.urlencode({"data": q}).encode(), timeout=90)["elements"]
        except Exception as e:  # noqa: BLE001
            last = e
    raise last


def classify(elements, lat, lon):
    found = {k: [] for k, *_ in POI}
    buildings, roads, power, crops, wells, antennas = [], [], [], [], [], []
    for el in elements:
        t = el.get("tags", {})
        a, b = _center(el)
        if a is None:
            continue
        d = km(lat, lon, a, b)
        name = t.get("name") or ""
        if "building" in t:
            buildings.append(d)
            continue
        if "highway" in t:
            roads.append((d, t["highway"], t.get("surface", "")))
            continue
        if t.get("power") in ("line", "pole", "tower"):
            power.append(d)
            continue
        if t.get("landuse") in ("vineyard", "orchard", "farmland", "meadow", "olive") and "natural" not in t:
            crops.append((d, t.get("landuse"), t.get("trees") or t.get("crop") or ""))
            continue
        if t.get("man_made") in ("water_well", "water_tower") or t.get("natural") == "spring":
            wells.append((d, "fuente" if t.get("natural") == "spring" else "pozo/depósito"))
            continue
        if "communication:mobile_phone" in t or t.get("tower:type") == "communication":
            antennas.append(d)
            continue
        sh, am, pl = t.get("shop"), t.get("amenity"), t.get("place")
        if sh in ("supermarket", "convenience"):
            found["supermarket"].append((d, name or "Supermercado", a, b))
        if am == "hospital":
            found["hospital"].append((d, name or "Hospital", a, b))
        if am in ("clinic", "doctors", "pharmacy"):
            found["doctor"].append((d, name or am, a, b))
        if am == "school":
            found["school"].append((d, name or "Escuela", a, b))
        if t.get("railway") == "station":
            found["station"].append((d, name or "Estación", a, b))
        if t.get("aeroway") == "aerodrome":
            found["airport"].append((d, f"{name} ({t.get('iata')})", a, b))
        if t.get("natural") == "beach":
            found["beach"].append((d, name or "Playa", a, b))
        if pl in ("village", "town", "city") and d > 0.3:
            found["village"].append((d, name, a, b))
        if pl in ("town", "city"):
            found["town"].append((d, name, a, b))
        if t.get("natural") == "peak":
            found["peak"].append((d, f"{name} {t.get('ele', '')} m".strip(), a, b))
        if t.get("natural") == "water" or t.get("waterway") in ("river", "stream"):
            found["water"].append((d, name or ("Río/arroyo" if "waterway" in t else "Lago/embalse"), a, b))
        if t.get("landuse") == "forest" or t.get("natural") == "wood":
            found["forest"].append((d, name or "Bosque", a, b))
    nearest = {k: min(v) for k, v in found.items() if v}
    return nearest, sorted(buildings), sorted(roads), sorted(power), crops, sorted(wells), sorted(antennas)


def drive_times(lat, lon, nearest):
    keys = [k for k in DRIVE if k in nearest]
    if not keys:
        return {}
    coords = ";".join([f"{lon},{lat}"] + [f"{nearest[k][3]},{nearest[k][2]}" for k in keys])
    try:
        r = _get(f"https://router.project-osrm.org/table/v1/driving/{coords}?sources=0&annotations=duration,distance", timeout=30)
        return {k: {"min": round(r["durations"][0][i + 1] / 60), "km": round(r["distances"][0][i + 1] / 1000, 1)}
                for i, k in enumerate(keys) if r["durations"][0][i + 1] is not None}
    except Exception:  # noqa: BLE001 - estimación por distancia si OSRM no responde
        # ~1,3 km de carretera por km en línea recta, a 60 km/h
        return {k: {"min": round(nearest[k][0] * 1.3), "km": round(nearest[k][0] * 1.3, 1), "approx": True}
                for k in keys}


def terrain(lat, lon):
    dd = 60 / 111320  # 60 m
    dl = dd / math.cos(lat * math.pi / 180)
    pts = [(lat, lon), (lat + dd, lon), (lat - dd, lon), (lat, lon + dl), (lat, lon - dl)]
    r = _get("https://api.open-meteo.com/v1/elevation?" + urllib.parse.urlencode({
        "latitude": ",".join(f"{p[0]:.6f}" for p in pts), "longitude": ",".join(f"{p[1]:.6f}" for p in pts)}))
    e = r["elevation"]
    dzdx = (e[3] - e[4]) / 120  # este - oeste
    dzdy = (e[1] - e[2]) / 120  # norte - sur
    slope = math.hypot(dzdx, dzdy) * 100
    # orientación = hacia dónde cae la ladera
    aspect = (math.degrees(math.atan2(-dzdx, -dzdy)) + 360) % 360
    names = ["Norte", "Noreste", "Este", "Sureste", "Sur", "Suroeste", "Oeste", "Noroeste"]
    return {"elevation": round(e[0]), "slope": round(slope, 1),
            "aspect": names[round(aspect / 45) % 8] if slope >= 3 else "Llano"}


def solar(lat, lon, slope_aspect=None):
    r = _get("https://re.jrc.ec.europa.eu/api/v5_3/PVcalc?" + urllib.parse.urlencode({
        "lat": lat, "lon": lon, "peakpower": 1, "loss": 14, "optimalangles": 1, "outputformat": "json"}), timeout=40)
    t = r["outputs"]["totals"]["fixed"]
    return {"kwhPerKwp": round(t["E_y"]), "irradiation": round(t["H(i)_y"])}


def isolation(buildings, nearest, roads, approx):
    """0 = en el pueblo, 100 = totalmente aislada. Cada factor se explica."""
    near_b = [d for d in buildings if d > 0.025]  # quita la propia casa
    n200 = sum(1 for d in near_b if d <= 0.2)
    first = near_b[0] * 1000 if near_b else 400
    vill = nearest.get("village", (8,))[0]
    sup = nearest.get("supermarket", (25,))[0]
    paved = [r for r in roads if r[1] not in ("track",) and r[2] not in ("unpaved", "gravel", "dirt", "ground")]
    road = paved[0][0] * 1000 if paved else 1500
    s = (25 * (1 - min(1, n200 / 12)) + 20 * min(1, first / 300) + 25 * min(1, vill / 8)
         + 15 * min(1, sup / 20) + 15 * min(1, road / 1000))
    facts = [
        f"{n200} edificios a menos de 200 m" + (f" (el más cercano a {first:.0f} m)" if near_b else ""),
        f"Carretera asfaltada a {road:.0f} m" if paved else "Sin carretera asfaltada a menos de 1,5 km",
        f"Pueblo más cercano a {vill:.1f} km" if "village" in nearest else "Ningún pueblo a menos de 20 km",
        f"Supermercado a {sup:.1f} km en línea recta" if "supermarket" in nearest else "Sin supermercado a menos de 25 km",
    ]
    return round(s), facts, approx


def analyze(x):
    with _lock:
        cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    if x["id"] in cache:
        return cache[x["id"]]
    lat, lon, approx = geocode(x)
    if lat is None:
        return {"error": "No se ha podido ubicar el pueblo"}
    out = {"lat": lat, "lon": lon, "approx": approx, "errors": []}
    try:
        nearest, buildings, roads, power, crops, wells, antennas = classify(overpass(lat, lon), lat, lon)
        out["poi"] = {k: {"emoji": e, "label": lbl, "km": round(nearest[k][0], 1), "name": nearest[k][1],
                          "lat": nearest[k][2], "lon": nearest[k][3]} for k, e, lbl, *_ in POI if k in nearest}
        out["missing"] = [lbl for k, e, lbl, *_ in POI if k not in nearest]
        out["drive"] = drive_times(lat, lon, nearest)
        out["isolation"], out["isolationFacts"], _ = isolation(buildings, nearest, roads, approx)
        out["power"] = round(power[0] * 1000) if power else None
        out["antenna"] = round(antennas[0], 1) if antennas else None
        out["wells"] = [{"m": round(d * 1000), "kind": k} for d, k in wells[:3]]
        uses = {}
        for d, use, extra in crops:
            label = {"vineyard": "viñedo", "orchard": "frutales", "olive": "olivar", "farmland": "cultivo", "meadow": "prado"}[use]
            if "olive" in extra:
                label = "olivar"
            uses[label] = min(uses.get(label, 9), d)
        out["landUse"] = [{"kind": k, "m": round(v * 1000)} for k, v in sorted(uses.items(), key=lambda i: i[1])]
    except Exception as e:  # noqa: BLE001
        out["errors"].append(f"OpenStreetMap: {e}")
    try:
        out["terrain"] = terrain(lat, lon)
    except Exception as e:  # noqa: BLE001
        out["errors"].append(f"Elevación: {e}")
    try:
        out["solar"] = solar(lat, lon)
    except Exception as e:  # noqa: BLE001
        out["errors"].append(f"PVGIS: {e}")
    if not out["errors"]:
        with _lock:
            cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
            cache[x["id"]] = out
            CACHE.write_text(json.dumps(cache, ensure_ascii=False))
    return out
