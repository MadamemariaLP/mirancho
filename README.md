# MiRancho

App personal (PWA) para encontrar casas rurales o de pueblo baratas en las subastas oficiales de España e Italia, con riesgos, reforma y entorno analizados.

- **App:** https://madamemarialp.github.io/mirancho/
- **Enlace para invitar:** https://madamemarialp.github.io/mirancho/#bienvenida
- **Repositorio:** https://github.com/MadamemariaLP/mirancho
- **Carpeta en el Mac:** `~/mirancho`

## Invitar a alguien

Botón **👥** de la app, o copia este mensaje:

```
🏡 ¡Encontremos nuestro rancho!

Te invito a MiRancho, la app donde buscamos juntos casas rurales y de pueblo baratas en España e Italia (subastas oficiales, con riesgos, reforma y entorno analizados).

👉 Ábrela aquí: https://madamemarialp.github.io/mirancho/#bienvenida

📲 Para tenerla como una app:
• iPhone/iPad: ábrela en Safari → botón Compartir (cuadrado con flecha ⬆︎) → «Añadir a pantalla de inicio» → Añadir.
• Android: ábrela en Chrome → menú ⋮ → «Instalar app» o «Añadir a pantalla de inicio».

⭐ Guarda las que te gusten con la estrella y compártemelas desde «Guardadas».
```

El canal de alertas al móvil es privado: está en `PRIVADO.md`, que solo existe en el Mac y no se sube.

## Instalar

- **iPhone/iPad:** Safari → Compartir ⬆︎ → «Añadir a pantalla de inicio».
- **Android:** Chrome → ⋮ → «Instalar app».
- **Mac:** `~/mirancho/start.sh` y abre http://localhost:8787. La versión del Mac además puede buscar en el momento, usar la IA con clave y guardar las zonas para todos.

## Cómo se usa

| Pestaña / sección | Para qué |
|---|---|
| 🏡 Casas | Lista con filtros: precio, habitantes, aislamiento, tipo, riesgo y «⭐ Mis zonas» |
| 🔔 Alertas | Casas nuevas en las zonas favoritas (Puglia, Calabria, Lazio) |
| 🗺️ Mapa | Todas las casas con coordenadas, coloreadas por riesgo |
| ★ Guardadas | Tus casas, «⏰ Próximas fechas», filtro por estado y «📤 Compartir» |
| 🔗 Más portales | Búsquedas filtradas en Idealista, Fotocasa, Immobiliare, Idealista.it y Casa.it |

Al tocar una casa se abre su ficha:

- **⭐ Resumen:** semáforo de riesgo legal con la frase del anuncio, puntuación 0–100 y el «¿por qué?».
- **📝 Notas y fecha:** estado (💚 Me interesa · 👀 Visitada · 💶 Pujar hasta X € · ❌ Descartada), notas libres y botón para añadir la subasta al calendario con avisos.
- **📍 Ubicación:** mapa, tiempos en coche, nivel de aislamiento, suministros y visores oficiales.
- **🌳 Terreno:** altitud, pendiente, orientación, sol, cultivos y agua.
- **🔨 Reforma:** estimación rápida y análisis con IA. Gratis: «Copiar instrucciones» → claude.ai → pegar la respuesta.
- **📈 ¿Está barata?:** precio + reforma + impuestos frente al valor con el €/m² de la zona.
- **📞 Contactar:** contacto de quien lleva la subasta (BOE) o «Prenota visita» (Italia), con el mensaje en ES/IT/FR/EN, «Abrir en el correo» o Gmail.

**Qué se comparte y qué no:** las casas, las alertas y las zonas son iguales para todos. Las guardadas, notas, análisis, cálculos y tu nombre y teléfono se guardan en cada móvil, y se pasan con «📤 Compartir». Quien recibe el enlace elige qué añadir.

## Automático

- Cada día a las **9:00 y 21:00**, el Mac busca casas (`collector.py`), publica la web (`publish.sh`) y avisa de las casas nuevas en tus zonas. El aviso llega al Mac y al móvil con ntfy.
- Tarea de macOS: `~/Library/LaunchAgents/com.mirancho.publish.plist`. Registro: `data/auto.log`.
- Lanzarla a mano: `launchctl kickstart gui/$(id -u)/com.mirancho.publish`
- Quitarla: `launchctl bootout gui/$(id -u)/com.mirancho.publish && rm ~/Library/LaunchAgents/com.mirancho.publish.plist`

## De dónde salen las casas

| Fuente | Qué trae |
|---|---|
| Subastas BOE (subastas.boe.es) | Viviendas y fincas rústicas con casa: subastas judiciales, notariales, de Hacienda o de la Seguridad Social |
| Portale Vendite Pubbliche (pvp.giustizia.it) | Aste giudiziarie de inmuebles residenciales |

Solo se guardan **viviendas**: `analysis.is_home()` descarta garajes, plazas de parking, trasteros, almacenes, locales, oficinas, naves y terrenos sin casa, y también las ruinas y las edificaciones agrícolas.

Idealista, Fotocasa, Immobiliare y Casa.it bloquean la lectura automática, por eso solo aparecen como enlaces.

## Privacidad

- Antes de publicar, `collector.py` tapa los nombres de particulares de los anuncios («[nombre omitido]»).
- Nunca se suben `.env`, `PRIVADO.md`, el canal de ntfy (`data/ntfy.json`) ni las cachés.
- Los commits usan el correo anónimo de GitHub.

## IA con clave (opcional, de pago)

Copia `.env.example` a `.env` y pega tu clave de https://console.anthropic.com. Solo se usa en el Mac; sin clave sigue funcionando el modo manual gratis.

## Archivos

| Archivo | Qué hace |
|---|---|
| `collector.py` | Descarga, analiza, tapa nombres, exporta y avisa |
| `analysis.py` | Trampas legales, tipo A–F, puntuación |
| `geo.py` / `web/geo.js` | Ubicación y entorno (Mac / navegador) |
| `ai.py` | Análisis con Claude e instrucciones del modo manual |
| `regions.py` | Provincia → región |
| `serve.py`, `start.sh` | Servidor local del Mac |
| `publish.sh` | Busca y publica en GitHub Pages |
| `web/` | La app (lo único que se publica como web) |
