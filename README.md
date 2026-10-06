# MiRancho

App personal (PWA) para encontrar casas rurales o de pueblo baratas en España e Italia.

## Arrancar

```bash
~/casas-rurales/start.sh
```

Abre http://localhost:8787. En Chrome o Safari puedes instalarla como app con «Instalar» o «Añadir al Dock».

## De dónde salen las casas

| Fuente | Qué trae |
|---|---|
| Subastas BOE (subastas.boe.es) | Viviendas y fincas rústicas con casa en subasta judicial, notarial o de Hacienda |
| Portale Vendite Pubbliche (pvp.giustizia.it) | Aste giudiziarie de inmuebles residenciales |
| Pestaña «Más portales» | Búsquedas ya filtradas en Idealista, Fotocasa e Immobiliare (bloquean la lectura automática) |

El botón «↻ Actualizar» vuelve a buscar en las fuentes (unos minutos). Desde la terminal: `python3 collector.py`.

## Qué analiza

- **Trampas legales** (`analysis.py`): cuotas parciales, usufructo, nuda propiedad, ocupantes, abusos, discrepancias, acceso, cargas… cita la frase del anuncio.
- **Tipo de edificación** A–F y **puntuación de oportunidad** con el «¿por qué?».
- **Ubicación** (`geo.py`, al abrir la ficha): tiempos en coche, aislamiento 0–100, suministros mapeados, altitud, pendiente, orientación y potencial solar (PVGIS).
- **Reforma con IA** (`ai.py`): sube fotos, plano o PDF y obtienes el estado, las partidas, el total y las incertidumbres.
- **¿Está barata?**: precio + reforma + impuestos frente al valor estimado con el €/m² de la zona.
- **Contactar**: mensaje para pedir visita en español, italiano, francés o inglés (no se envía nada solo).

## Zonas favoritas y alertas

- Zonas favoritas: Puglia, Calabria y Lazio. Se cambian en Casas → ⚙︎ Filtros → «Mis zonas favoritas».
- Las casas de esas zonas salen primero, con borde dorado. El botón «⭐ Mis zonas» muestra solo esas.
- La pestaña 🔔 Alertas reúne las casas nuevas de tus zonas (hasta 30.000 €, sin las 🔴).
- El Mac busca solo a las 9:00 y a las 21:00, aunque la app esté cerrada, y manda una notificación si hay casas nuevas. Registro: `data/auto.log`.
- Para quitar la búsqueda automática:
  `launchctl bootout gui/$(id -u)/com.casasrurales.collector && rm ~/Library/LaunchAgents/com.casasrurales.collector.plist`

## IA

Copia `.env.example` a `.env` y pega tu clave personal de https://console.anthropic.com. Usa Claude Opus 5.5 y cada análisis cuesta unos céntimos.

## Archivos

- `collector.py`: descarga y analiza → `web/data/listings.json`
- `data/`: población por municipio (Wikidata/Wikipedia) y cachés del BOE y de ubicación
- `web/`: la PWA
