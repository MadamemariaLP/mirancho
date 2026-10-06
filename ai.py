"""Análisis con Claude: estado de la casa, reforma por partidas y trampas legales.

Necesita una clave en ~/mirancho/.env (ANTHROPIC_API_KEY=...) o credenciales del SDK.
Se ejecuta con el Python del entorno virtual (.venv), donde está instalado `anthropic`.
"""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODEL = "claude-opus-5-5"

ELEMENTS = ["tejado", "humedad", "grietas", "ventanas", "fachada", "estructura", "instalaciones",
            "cocina", "baños", "aislamiento", "calefacción", "estado general"]

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["kind", "kindReason", "elements", "reform", "totalLow", "totalHigh", "uncertainty",
                 "legal", "verdict", "verdictReason", "summary"],
    "properties": {
        "kind": {"type": "string", "enum": ["A", "B", "C", "D", "E", "F"]},
        "kindReason": {"type": "string"},
        "elements": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["element", "status", "evidence"],
            "properties": {
                "element": {"type": "string", "enum": ELEMENTS},
                "status": {"type": "string", "enum": ["bueno", "regular", "malo", "no visible"]},
                "evidence": {"type": "string"},
            }}},
        "reform": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["item", "low", "high", "note"],
            "properties": {"item": {"type": "string"}, "low": {"type": "integer"},
                           "high": {"type": "integer"}, "note": {"type": "string"}}}},
        "totalLow": {"type": "integer"},
        "totalHigh": {"type": "integer"},
        "uncertainty": {"type": "array", "items": {"type": "string"}},
        "legal": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["level", "issue", "evidence"],
            "properties": {"level": {"type": "string", "enum": ["stop", "high", "check"]},
                           "issue": {"type": "string"}, "evidence": {"type": "string"}}}},
        "verdict": {"type": "string", "enum": ["stop", "high", "check", "ok"]},
        "verdictReason": {"type": "string"},
        "summary": {"type": "string"},
    },
}

SYSTEM = """Eres un aparejador y abogado inmobiliario con experiencia en casas rurales y subastas \
judiciales de España e Italia. Ayudas a una persona particular a decidir si una casa barata merece la pena.

Clasifica la edificación:
A = casa rural habitable, B = casa para reformar, C = ruina recuperable, D = ruina complicada,
E = edificación agrícola (establo, pajar, almacén), F = probablemente no sirve como vivienda.

Evalúa cada elemento solo con lo que veas o leas; si no hay evidencia, usa "no visible".
Estima la reforma por partidas en euros con precios de 2026 de la zona rural del anuncio (rango bajo-alto),
incluyendo solo partidas justificadas por el estado; el total es la suma de las partidas.
En "uncertainty" explica en frases cortas qué falta para afinar (p. ej. "No hay fotos del tejado").

Busca trampas, sobre todo en subastas: cuota parcial, usufructo, nuda propiedad, copropiedad, ocupantes,
cargas que no se cancelan, hipotecas, embargos, servidumbres, herencias, discrepancias catastrales o
urbanísticas, falta de licencia o abuso edilizio, falta de acceso legal, suelo no edificable.
Cita la frase exacta del documento como evidencia. Veredicto: stop = no comprar todavía, high = alto riesgo,
check = revisar antes de pujar, ok = sin señales. Escribe en español, claro y sin tecnicismos innecesarios."""


def _client():
    import anthropic  # solo disponible en .venv

    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            k, _, v = line.partition("=")
            if k.strip() and v.strip() and not os.environ.get(k.strip()):
                os.environ[k.strip()] = v.strip().strip('"')
    return anthropic, anthropic.Anthropic()


def available():
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False, "Falta el SDK: arranca la app con ./start.sh"
    if os.environ.get("ANTHROPIC_API_KEY") or "ANTHROPIC_API_KEY=" in ((ROOT / ".env").read_text() if (ROOT / ".env").exists() else ""):
        return True, ""
    return False, "Añade tu clave en ~/mirancho/.env (ANTHROPIC_API_KEY=...)"


def facts_json(listing, geo=None):
    facts = {k: listing.get(k) for k in ("country", "source", "kind", "title", "description", "town", "province",
                                         "address", "price", "minOffer", "appraisal", "occupancy", "habitual",
                                         "categories", "m2", "land", "status")}
    if geo:
        facts["entorno"] = {k: geo.get(k) for k in ("terrain", "isolationFacts", "drive")}
    return json.dumps(facts, ensure_ascii=False)


def manual_prompt(listing, geo=None):
    """Instrucciones para pegar en claude.ai (gratis) y traer la respuesta a la app."""
    return (f"{SYSTEM}\n\nAnuncio oficial (JSON):\n{facts_json(listing, geo)}\n\n"
            "Te adjunto fotos, plano o documentos de la casa (si no hay, analiza solo el anuncio).\n\n"
            "Responde ÚNICAMENTE con un bloque JSON válido que cumpla este esquema, sin texto antes ni después:\n"
            f"{json.dumps(SCHEMA, ensure_ascii=False)}")


def analyze(listing, files, geo=None):
    """files: [{"type": "image/jpeg"|"application/pdf", "data": base64}]"""
    anthropic, client = _client()
    content = []
    for f in files[:12]:
        if f["type"] == "application/pdf":
            content.append({"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": f["data"]}})
        else:
            content.append({"type": "image", "source": {"type": "base64", "media_type": f["type"], "data": f["data"]}})
    content.append({"type": "text", "text":
                    f"Anuncio oficial (JSON):\n{facts_json(listing, geo)}\n\n"
                    f"Se adjuntan {len(files)} archivos (fotos, plano o documentos) aportados por la usuaria. "
                    "Analiza la casa y responde con el esquema."})
    try:
        resp = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=SYSTEM,
            output_config={"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": content}],
        )
    except anthropic.AuthenticationError:
        return {"error": "La clave de la API no es válida (revisa .env)."}
    except anthropic.RateLimitError:
        return {"error": "Demasiadas peticiones a la IA; prueba en un minuto."}
    except anthropic.APIStatusError as e:
        return {"error": f"Error de la IA ({e.status_code}): {e.message}"}
    except anthropic.APIConnectionError:
        return {"error": "Sin conexión con la IA."}
    if resp.stop_reason == "refusal":
        return {"error": "La IA no ha podido analizar este anuncio."}
    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"error": "Respuesta incompleta de la IA; vuelve a intentarlo."}
