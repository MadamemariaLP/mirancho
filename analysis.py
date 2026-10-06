"""Análisis por texto de cada anuncio: trampas legales, tipo de edificación y puntuación.

Todo es por reglas sobre la descripción oficial (ES/IT); la IA (ai.py) y los datos geográficos
(geo.py) lo completan en la ficha de detalle. Cada conclusión lleva su motivo.
"""
import re

# (código, nivel, expresiones, mensaje). Nivel: stop = NO COMPRAR TODAVÍA, high = ALTO RIESGO, check = revisar
LEGAL_RULES = [
    ("cuota", "stop", r"pro ?indiviso|parte indivisa|^\W*quote? (di|del|della|indivis)|\bquote (di|indivise) (fabbricat|immobil|terren|abitaz|appartam)|(cuota|quota|participaci[oó]n) indivisa|aprovechamiento por turnos|multipropiedad",
     "Parece una cuota parcial de la propiedad, no la casa entera."),
    ("usufructo", "stop", r"usufruct|usufrutt", "Se vende o existe un usufructo: no podrías usar la casa libremente."),
    ("nuda", "stop", r"nuda propi", "Es nuda propiedad: otra persona conserva el uso."),
    ("ocupada", "high", r"\bocupad|okupa|occupat[oa] (dal|da|con)|occupato|ocupantes|arrendad|locat[oa]\b|contratto di locazione",
     "Consta como ocupada o arrendada: el desalojo puede tardar meses o años."),
    ("abuso", "high", r"abus[oi] edilizi|abusiv|sin licencia|ilegal|fuera de ordenaci|non sanabil|condono|sanatoria",
     "Hay obras sin licencia, abuso edilizio o algo fuera de ordenación."),
    ("difformita", "high", r"difformit|discrepan|no coincide|non conform|non corrispond",
     "Discrepancia entre el estado real y el catastro/registro o el planeamiento."),
    ("intercluso", "high", r"interclus|sin acceso|senza accesso|privo di accesso|accesso .{0,20}(non|terzi)",
     "Puede no tener acceso legal propio (finca enclavada o fondo intercluso)."),
    ("inedificable", "high", r"no urbanizable|inedificab|non edificab|no edificable|suelo r[uú]stico protegido|vincolo (idrogeologico|paesaggistico)",
     "Suelo no edificable o con limitaciones ambientales/paisajísticas."),
    ("cargas", "check", r"hipoteca|ipoteca|embargo|pignoramento|cargas|gravam|trascrizion|anotaci[oó]n preventiva",
     "Menciona cargas, hipotecas o embargos: comprueba si se cancelan con la subasta."),
    ("servidumbre", "check", r"servidumbr|servit[uù]", "Tiene servidumbres (paso, aguas, etc.)."),
    ("herencia", "check", r"herencia|herederos|ereditari|eredi\b|successione", "Herencia de por medio: puede haber más titulares."),
    ("habitual", "check", r"vivienda habitual: s[ií]", "Es la vivienda habitual del deudor."),
]

KIND_RULES = [  # orden = prioridad
    ("F", r"posto auto|garage|autorimessa|trastero|cochera|plaza de garaje|solo terreno|terreno agricolo|lastrico|cantina\b",
     "Probablemente no sirve como vivienda"),
    ("D", r"crollat|derrumb|sin cubierta|senza (tetto|copertura)|tetto crollato|ruina total|rudere .{0,30}(crollo|privo)",
     "Ruina complicada"),
    ("C", r"rudere|dirut|ruina|ruinos|collabent|f/2|categoria f2|diroccat|en estado de abandono|inagibil|inhabitable",
     "Ruina recuperable"),
    ("E", r"stalla|fienile|pajar|cuadra|granero|nave agr[ií]cola|almac[eé]n agr[ií]cola|magazzino agricolo|corral|caseta de aperos|deposito attrezzi|tettoia",
     "Edificación agrícola"),
    ("B", r"da ristruttur|ristrutturazione|a reformar|para reformar|necesita reforma|mal estado|scadent|pessim|mediocr|degrad|da sistemare|precari",
     "Casa para reformar"),
    ("A", r"abitabil|buono stato|buone condizioni|discreto stato|discrete condizioni|ottime condizioni|ristrutturat|arredat|"
     r"reformad|buen estado|perfecto estado|para entrar a vivir|amueblad|habitable|ottimo stato|recentemente",
     "Habitable"),
]
KIND_LABEL = {
    "A": "🏡 Habitable", "B": "🏚️ Para reformar", "C": "🧱 Ruina recuperable", "D": "🏚️ Ruina complicada",
    "E": "🌾 Edificación agrícola", "F": "❌ Probablemente no es vivienda", "?": "❔ Estado sin datos",
}
IT_CATS_F = {"POSTO_AUTO", "GARAGE_AUTORIMESSA", "DEPOSITO", "MAGAZZINI_E_DEPOSITO", "TERRENO"}

# €/m² orientativos de reforma por tipo (rango bajo-alto) — se sustituyen por la IA si hay fotos
REFORM_EUR_M2 = {"A": (50, 200), "B": (400, 900), "C": (900, 1500), "D": (1300, 2000), "E": (1000, 1700), "F": (0, 0), "?": (400, 1200)}


def surface_m2(text):
    vals = []
    for m in re.finditer(r"(\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d+)?)\s*(m2|m²|mq|metros cuadrados|metri quadri|mt\.?q)", text or "", re.I):
        raw = m.group(1).replace(" ", "")
        raw = raw.replace(".", "").replace(",", ".") if re.search(r",\d{1,2}$", raw) or re.search(r"\.\d{3}", raw) else raw.replace(",", ".")
        try:
            v = float(raw)
        except ValueError:
            continue
        if 15 <= v <= 100000:
            vals.append(v)
    house = [v for v in vals if v <= 600]
    land = [v for v in vals if v > 600]
    return (max(house) if house else None), (max(land) if land else None)


HOUSE_RX = r"appartament|abitazion|\bcasa\b|vivienda|villa|alloggio|fabbricat|edificio|\bpiso\b|casale|cascina|casolare|chalet|unifamiliar|adosad"


# --- ¿Es una vivienda? Se descartan garajes, plazas, trasteros, locales, terrenos... ---
DWELL_RX = re.compile(r"abitaz|abitativ|appartam|appart\.|alloggi|villett|villin|\bvill[ae]\b|\bcas[ae]\b|residenzial|casale|"
                      r"casolare|masseri|trull|dammus|baita|cascina|mansard|attico|monolocal|bilocal|trilocal|quadrilocal|"
                      r"\bcucina|soggiorno|camer[ae] da letto|terratetto|corte colonica|vivienda|\bpiso\b|chalet|unifamiliar|"
                      r"adosad|cortijo|mas[ií]a|caser[ií]o|\bduplex", re.I)
BUILD_RX = re.compile(r"fabbricat|immobil|unit[aà]|edifici|rustico|palazzin|porzion|compendio|\bvan[oi]\b|stabile", re.I)
NOUSE_RX = re.compile(r"\bbox\b|garage|autorimess|posto auto|posti auto|cantin[ae]\b|magazzin|deposit[oi]\b|negozi|bottega|"
                      r"\blocal[ei]\b|uffic[iy]|laborator|capannon|opificio|terren[oi]|appezzament|lastrico|tettoi|stall[ae]\b|"
                      r"rimess[ae]|soffitt|sottotetto|area urbana|area edificabile|fondaco|ripostigl|posto barca|zootecn|"
                      r"garaje|trastero|aparcamiento|\bnave\b|local comercial|\bsolar\b|oficina", re.I)
CATASTO_RX = re.compile(r"\bcat(?:egoria|\.)?\s*([A-F])\s*/?\s*\d", re.I)


NOT_WANTED = set("CDEF")  # ruinas, edificaciones agrícolas y lo que no es vivienda
RISKY = {"stop", "high"}  # cuotas, usufructos, ocupadas, obras ilegales... no se publican


def is_home(x):
    """False si el anuncio es claramente otra cosa (garaje, trastero, local, terreno...)."""
    title = x.get("title") or ""
    full = f"{title} {x.get('description') or ''}"
    if DWELL_RX.search(full[:600]):
        return True
    cats = {c.upper() for c in CATASTO_RX.findall(full)}
    if "A" in cats:  # categoría catastral de vivienda
        return True
    m = NOUSE_RX.search(title)
    if m:
        b = BUILD_RX.search(title)
        if not b or m.start() < b.start():
            return False
    return not (cats and not cats & {"F"})  # solo C/D/E: garajes, almacenes, naves


def partial_share(t):
    """Busca fracciones de propiedad menores que el total: 1/2, 50/100, 33%..."""
    for m in re.finditer(r"(\d{1,3})\s*/\s*(\d{1,4})", t):
        a, b = int(m.group(1)), int(m.group(2))
        ctx = t[max(0, m.start() - 30):m.end() + 30]
        after = t[m.end():m.end() + 35]
        if 0 < a < b and b <= 1000 and re.search(r"propi|propr|quota|cuota|dominio|indivis|spettante|titolarit", ctx) \
                and not re.search(r"cort|parti comun|aree? comun|cortil|elementos comunes|beni comuni|zonas comunes", after) \
                and not re.search(r"(via|n\.|nº|civico|calle|c/|proc\.?|r\.?g\.?(e\.?)?|rge|n°)\s*\S*$", t[max(0, m.start() - 12):m.start()]) \
                and not re.search(r"\d\s*/\s*\d{2,4}\s*/\s*\d", t[m.start():m.end() + 6]):  # fechas
            return ctx
    m = re.search(r"(\d{1,2}(?:[.,]\d+)?)\s*%\s*(del |de la |di |della )?(pleno dominio|propiedad|proprietà|piena propriet)", t)
    return t[max(0, m.start() - 40):m.end() + 40] if m else None


def legal(text, occupancy=""):
    t = (text or "").lower()
    flags = []
    q = partial_share(t)
    if q:
        flags.append({"code": "cuota", "level": "stop", "msg": "Se vende solo una parte (cuota) de la propiedad, no la casa entera.", "quote": q.strip()})
    for code, level, rx, msg in LEGAL_RULES:
        m = re.search(rx, t, re.I)
        if m and not (code == "cuota" and q):
            s = max(0, m.start() - 50)
            flags.append({"code": code, "level": level, "msg": msg, "quote": t[s:m.end() + 50].strip()})
    if "OCCUP" in (occupancy or "").upper() and not any(f["code"] == "ocupada" for f in flags):
        flags.append({"code": "ocupada", "level": "check", "quote": occupancy,
                      "msg": "El tribunal la marca como ocupada. En Italia el custodio suele liberarla antes de entregarla; confirma plazos."})
    if any(f["level"] == "stop" for f in flags):
        verdict = "stop"
    elif any(f["level"] == "high" for f in flags):
        verdict = "high"
    elif flags:
        verdict = "check"
    else:
        verdict = "ok"
    return verdict, flags


def kind(text, cats=()):
    t = (text or "").lower()
    cats = set(cats or [])
    if cats and cats <= IT_CATS_F:
        return "F", "Categoría catastral sin vivienda"
    has_house = re.search(HOUSE_RX, t) or cats & {"ABITAZIONE_TIPO_ECO", "ABITAZIONE_TIPO_CIV", "ABITAZIONE_TIPO_POP",
                                                    "ABITAZIONE_TIPO_UPOP", "ABITAZIONE_IN_VILLINI", "APPARTAMENTO", "VILLA",
                                                    "ABITAZIONE_TIPO_RUR"}
    for k, rx, why in KIND_RULES:
        if k in "FE" and has_house:
            continue  # una casa con trastero, cantina o establo sigue siendo una casa
        if re.search(rx, t, re.I):
            return k, why
    if "STALLE_SCUDERIE_RIMESSE" in cats and not has_house:
        return "E", "Categoría rural/agrícola"
    if "ABITAZIONE_TIPO_RUR" in cats:
        return "?", "Casa rural; la descripción no dice en qué estado está"
    return "?", "La descripción no dice en qué estado está"


def score(x):
    """Puntuación 0-100 con los datos disponibles; geo.py la recalcula con ubicación real."""
    parts, why = {}, []
    p = x.get("price") or 0
    parts["Precio"] = max(0, min(100, round(100 - p / 600)))  # 0 € → 100, 60k → 0
    if p <= 15000:
        why.append(f"+ Precio muy bajo ({p:,.0f} €)".replace(",", "."))
    if x.get("discount"):
        parts["Precio"] = min(100, parts["Precio"] + round(x["discount"] / 3))
        why.append(f"+ {x['discount']:.0f}% por debajo de la tasación oficial")

    parts["Legal"] = {"ok": 95, "check": 70, "high": 30, "stop": 5}[x["verdict"]]
    for f in x["flags"]:
        why.append(("− " if f["level"] != "check" else "· ") + f["msg"])

    parts["Reforma"] = {"A": 90, "B": 65, "C": 40, "D": 15, "E": 35, "F": 5, "?": 55}[x["kindCode"]]
    pop = x.get("population")
    parts["Pueblo"] = 60 if pop is None else (95 if pop < 2000 else 85 if pop < 5000 else 65 if pop < 20000 else 30)
    if pop and pop < 2000:
        why.append(f"+ Pueblo pequeño ({pop:,} hab.)".replace(",", "."))
    if x.get("land"):
        parts["Terreno"] = min(100, 50 + round(x["land"] / 200))
        why.append(f"+ Terreno de ~{x['land']:,.0f} m²".replace(",", "."))

    w = {"Precio": 3, "Legal": 3, "Reforma": 2, "Pueblo": 1, "Terreno": 1}
    total = sum(parts[k] * w[k] for k in parts) / sum(w[k] for k in parts)
    if x["verdict"] == "stop":
        total = min(total, 25)
    if x["kindCode"] == "F":
        total = min(total, 20)
    return round(total), parts, why


def enrich(x):
    text = " ".join(filter(None, [x.get("title"), x.get("description"), x.get("habitual")]))
    x["verdict"], x["flags"] = legal(text, x.get("occupancy"))
    x["kindCode"], x["kindWhy"] = kind(text, x.get("categories"))
    x["kindLabel"] = KIND_LABEL[x["kindCode"]]
    x["m2"], x["land"] = surface_m2(x.get("description"))
    if x.get("appraisal") and x.get("price") and x["appraisal"] > x["price"]:
        x["discount"] = round(100 * (1 - x["price"] / x["appraisal"]), 1)
    lo, hi = REFORM_EUR_M2[x["kindCode"]]
    if x.get("m2") and hi:
        x["reformRough"] = [round(lo * x["m2"], -3), round(hi * x["m2"], -3)]
    x["score"], x["scoreParts"], x["scoreWhy"] = score(x)
    return x
