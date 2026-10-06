// Ficha de detalle: resumen explicado, ubicación, terreno, reforma (IA), valor y contacto.

const OFFICIAL = {
  ES: [
    ["🌊 Riesgo de inundación (SNCZI, Ministerio)", "https://sig.mapama.gob.es/snczi/"],
    ["🗂️ Catastro: parcela, superficie y uso", "https://www1.sedecatastro.gob.es/"],
    ["📶 Cobertura de banda ancha (Ministerio)", "https://avancedigital.mineco.gob.es/banda-ancha/cobertura/"],
  ],
  IT: [
    ["🌊 Frane e alluvioni (IdroGEO, ISPRA)", "https://idrogeo.isprambiente.it/app/"],
    ["🗂️ Geoportale catastale (Agenzia Entrate)", "https://geoportale.cartografia.agenziaentrate.gov.it/"],
    ["📶 Copertura internet e mobile (AGCOM)", "https://maps.agcom.it/"],
  ],
};

// Resumen compacto de ubicación (mismo formato que /api/geo-index)
function compactGeo(g) {
  if (!g || g.error) return null;
  return {
    lat: g.lat, lon: g.lon, approx: g.approx, isolation: g.isolation,
    supermarket: g.drive?.supermarket?.min, hospital: g.drive?.hospital?.min,
    solar: g.solar?.kwhPerKwp, slope: g.terrain?.slope,
  };
}

function fullScore(x, g) {
  const parts = { ...x.scoreParts };
  const why = [...x.scoreWhy];
  const w = { Precio: 3, Legal: 3, Reforma: 2, Pueblo: 1, Terreno: 1, Servicios: 1.5, Potencial: 1 };
  const ai = aiResult(x.id);
  if (ai && !ai.error) {
    parts.Reforma = { A: 90, B: 65, C: 40, D: 15, E: 35, F: 5 }[ai.kind];
    why.push(`· IA: ${KINDS[ai.kind]} — reforma ${eur(ai.totalLow)}–${eur(ai.totalHigh)}`);
  }
  if (g) {
    if (g.supermarket != null) {
      const s = g.supermarket, h = g.hospital ?? 60;
      parts.Servicios = Math.round(Math.max(10, 100 - s * 2.5 - Math.max(0, h - 20)));
      why.push(s <= 12 ? `+ Supermercado a ${s} min` : `− Supermercado a ${s} min`);
      if (h > 40) why.push(`− Hospital a ${h} min`);
    }
    if (g.solar) {
      parts.Potencial = Math.round(Math.min(100, Math.max(20, (g.solar - 1000) / 7 + 20)) + (x.land ? 5 : 0));
      if (g.solar >= 1450) why.push(`+ Mucho sol (${g.solar} kWh por kWp al año)`);
    }
    if (g.slope != null && g.slope > 25) why.push(`− Terreno con mucha pendiente (${g.slope}%)`);
  }
  let total = Object.entries(parts).reduce((s, [k, v]) => s + v * (w[k] || 1), 0) /
    Object.keys(parts).reduce((s, k) => s + (w[k] || 1), 0);
  const verdict = ai && !ai.error ? ai.verdict : x.verdict;
  if (verdict === "stop") total = Math.min(total, 25);
  if (x.kindCode === "F" || ai?.kind === "F") total = Math.min(total, 20);
  // primero lo positivo, luego lo negativo
  why.sort((a, b) => "+−·".indexOf(a[0]) - "+−·".indexOf(b[0]));
  return { total: Math.round(total), parts, why };
}

const aiResult = (id) => store.get("ai:" + id, null);

const SECTIONS = [
  ["resumen", "⭐ Resumen"], ["notas", "📝 Notas y fecha"], ["ubicacion", "📍 Ubicación"], ["terreno", "🌳 Terreno"],
  ["reforma", "🔨 Reforma"], ["valor", "📈 ¿Está barata?"], ["contacto", "📞 Contactar"],
];

let detailMap, currentX, currentGeo;

function openDetail(x) {
  currentX = x; currentGeo = null;
  if (!alertSeen.has(x.id) && alertIds().has(x.id)) {
    alertSeen.add(x.id); store.set("alertSeen", [...alertSeen]); renderAlertCount();
  }
  const dlg = $("#detail");
  dlg.dataset.orig = "";
  $(".sheet-title", dlg).innerHTML = `<b>${isFavZone(x) ? "⭐ " : ""}${esc(x.town || tr(x, "title"))}</b><span>${eur(x.price)} · ${x.country === "ES" ? "🇪🇸" : "🇮🇹"} ${esc(x.province)}</span>`;
  $("#detailFav").textContent = favs.has(x.id) ? "★" : "☆";
  $("#detailFav").onclick = () => { toggleFav(x.id); $("#detailFav").textContent = favs.has(x.id) ? "★" : "☆"; };
  $("#sheetNav").innerHTML = SECTIONS.map(([k, v]) => `<a href="#s-${k}" data-k="${k}">${v}</a>`).join("");
  $("#sheetNav").onclick = (e) => {
    const a = e.target.closest("a"); if (!a) return;
    e.preventDefault(); $("#s-" + a.dataset.k).scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };
  $("#sheetBody").innerHTML = SECTIONS.map(([k, v]) => `<section id="s-${k}" class="sec"><h2>${v}</h2><div class="sec-body"></div></section>`).join("");
  renderResumen(); renderNotas(); renderUbicacion(); renderTerreno(); renderReforma(); renderValor(); renderContacto();
  if (!dlg.open) dlg.showModal();
  $("#sheetBody").scrollTop = 0;
  history.replaceState(null, "", "#casa=" + encodeURIComponent(x.id));
  loadGeo(x);
}

$("#closeDetail").onclick = () => $("#detail").close();
$("#detail").addEventListener("close", () => {
  history.replaceState(null, "", location.pathname);
  if (detailMap) { detailMap.remove(); detailMap = null; }
  renderList();
  if (current === "alerts") renderAlerts();
  if (current === "favs") renderFavs();
});

const body = (k) => $(`#s-${k} .sec-body`);

function bindDescToggle(x) {
  const b = $("#descToggle");
  if (!b) return;
  let showEs = f.translate !== false;
  b.onclick = () => {
    showEs = !showEs;
    $("#descText").textContent = showEs ? x.description_es : x.description;
    b.textContent = showEs ? "🇮🇹 Ver el original en italiano" : "🇪🇸 Ver traducción al español";
  };
}

function renderResumen() {
  const x = currentX;
  const ai = aiResult(x.id);
  const verdict = ai && !ai.error ? ai.verdict : x.verdict;
  const v = VERDICT[verdict];
  const sc = fullScore(x, compactGeo(currentGeo) || geoIndex[x.id]);
  const flags = ai && !ai.error ? ai.legal.map((l) => ({ level: l.level, msg: l.issue, quote: l.evidence })) : x.flags;
  const bars = Object.entries(sc.parts).map(([k, n]) =>
    `<div class="bar"><span>${k}</span><div><i style="width:${n}%;background:${n >= 70 ? "var(--good)" : n >= 45 ? "var(--warn)" : "var(--bad)"}"></i></div><b>${n}</b></div>`).join("");
  const gallery = x.photos?.length ? `
    <div class="gallery">${x.photos.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Foto ${i + 1}" loading="${i ? "lazy" : "eager"}" decoding="async" referrerpolicy="no-referrer" onerror="this.parentElement.remove()"></a>`).join("")}</div>
    <p class="muted small">${x.photoSource === "Catastro (fachada)" ? "📷 Foto de fachada del Catastro (puede ser antigua o de la calle)." : `📷 ${x.photos.length} foto(s) del tribunal · toca para verlas en grande.`}</p>` : "";
  const docs = x.docs?.length ? `
    <h3>📄 Documentos oficiales</h3>
    <ul class="docs">${x.docs.map((d) => `<li><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.name)}</a></li>`).join("")}</ul>
    <p class="muted small">La <b>perizia</b> es el informe del perito: estado, superficie, cargas, ocupación y fotos. Descárgala y súbela en «🔨 Reforma» para que la IA la analice.</p>` : "";
  body("resumen").innerHTML = `${gallery}
    <div class="verdict-box ${v.cls}">
      <div class="vb-head">${v.icon} <b>${verdict === "stop" ? "NO COMPRAR TODAVÍA" : verdict === "high" ? "ALTO RIESGO" : v.label.toUpperCase()}</b></div>
      ${flags.length ? `<ul>${flags.map((fl) => `<li><b>${esc(fl.msg)}</b>${fl.quote ? `<q>${esc(fl.quote)}</q>` : ""}</li>`).join("")}</ul>`
        : "<p>No hemos visto cuotas, usufructos, ocupantes ni problemas urbanísticos en el texto oficial. Aun así, lee el edicto y la nota simple / perizia antes de pujar.</p>"}
      <p class="muted small">${ai && !ai.error ? "Revisado por la IA." : "Detección automática sobre el texto oficial. Para un análisis más fino usa la IA en «Reforma»."}</p>
    </div>
    <div class="score-box">
      ${scoreRing(sc.total, 84)}
      <div class="score-text"><b>Puntuación de oportunidad</b><p class="muted small">Combina precio, riesgo legal, estado, pueblo, servicios y potencial. Cada barra se explica abajo.</p></div>
    </div>
    <div class="bars">${bars}</div>
    <h3>¿Por qué?</h3>
    <ul class="why big">${sc.why.map((r) => `<li class="${r.startsWith("+") ? "pro" : r.startsWith("−") ? "con" : ""}">${esc(r.replace(/^[+−·] /, ""))}</li>`).join("")}</ul>
    <h3>Datos oficiales</h3>
    <dl class="facts">
      <dt>Tipo</dt><dd>${KINDS[x.kindCode]} <span class="muted">(${esc(x.kindWhy)})</span></dd>
      <dt>${x.country === "ES" ? "Valor de subasta" : "Precio base"}</dt><dd>${eur(x.price)}</dd>
      ${x.minOffer ? `<dt>Oferta mínima</dt><dd>${eur(x.minOffer)} <span class="muted">(se puede ofrecer hasta un 25% menos)</span></dd>` : ""}
      ${x.appraisal ? `<dt>Tasación</dt><dd>${eur(x.appraisal)}</dd>` : ""}
      ${x.deposit ? `<dt>Depósito para pujar</dt><dd>${eur(x.deposit)}</dd>` : ""}
      <dt>${x.country === "ES" ? "Fin de la subasta" : "Fecha de venta"}</dt><dd>${x.date ? new Date(x.date).toLocaleDateString("es-ES", { dateStyle: "long" }) : "—"} ${x.status ? `· ${esc(x.status)}` : ""}</dd>
      ${x.offerDeadline ? `<dt>Plazo de ofertas</dt><dd><b>${esc(x.offerDeadline)}</b></dd>` : ""}
      ${x.saleMode ? `<dt>Modalidad</dt><dd>${esc(x.saleMode)}</dd>` : ""}
      ${x.surfaceOfficial ? `<dt>Superficie</dt><dd>${x.surfaceOfficial} m²${x.floor ? ` · planta ${esc(x.floor)}` : ""}${x.rooms ? ` · ${x.rooms} estancias` : ""}</dd>` : ""}
      ${x.refcat ? `<dt>Ref. catastral</dt><dd><a href="https://www1.sedecatastro.gob.es/CYCBienInmueble/OVCListaBienes.aspx?rc1=${esc(x.refcat.slice(0, 7))}&rc2=${esc(x.refcat.slice(7, 14))}" target="_blank" rel="noopener">${esc(x.refcat)} ↗</a></dd>` : ""}
      ${x.address ? `<dt>Dirección</dt><dd>${esc(x.address)}</dd>` : ""}
      ${x.occupancy ? `<dt>Ocupación</dt><dd>${esc(x.occupancy.replaceAll("_", " ").toLowerCase())}</dd>` : ""}
      <dt>Gestiona</dt><dd>${esc(x.authority || x.source)}</dd>
    </dl>
    ${docs}
    <details ${x.description_es ? "open" : ""}><summary>Descripción oficial completa${x.description_es && f.translate !== false ? " (traducida)" : ""}</summary>
      <p class="desc" id="descText">${esc(tr(x, "description") || "Sin descripción")}</p>
      ${x.description_es ? `<button class="link" id="descToggle">${f.translate !== false ? "🇮🇹 Ver el original en italiano" : "🇪🇸 Ver traducción al español"}</button>
      <p class="muted small">Traducción automática hecha en tu Mac; ante la duda, manda el original.</p>` : ""}
    </details>
    <a class="btn primary wide" href="${esc(x.url)}" target="_blank" rel="noopener">Ver el anuncio en ${esc(x.source)} ↗</a>`;
  bindDescToggle(x);
}

async function loadGeo(x) {
  try {
    const g = await getGeo(x);
    if (currentX !== x) return;
    currentGeo = g;
    if (!g.error) geoIndex[x.id] = compactGeo(g);
  } catch {
    currentGeo = { error: "No se pudo analizar la ubicación ahora mismo (¿sin conexión?). Prueba en un rato." };
  }
  renderUbicacion(); renderTerreno(); renderResumen();
}

const loading = (msg) => `<p class="loading"><span class="spin"></span>${msg}</p>`;

function renderUbicacion() {
  const x = currentX, g = currentGeo, el = body("ubicacion");
  if (!g) { el.innerHTML = loading("Buscando servicios cercanos en OpenStreetMap y calculando tiempos en coche… (≈30 s la primera vez; luego queda guardado)"); return; }
  if (g.error) { el.innerHTML = `<p class="warn">⚠ ${esc(g.error)}</p>`; return; }
  const order = ["supermarket", "doctor", "hospital", "school", "station", "airport", "town", "beach", "village", "peak", "forest", "water"];
  const rows = order.filter((k) => g.poi?.[k]).map((k) => {
    const p = g.poi[k], d = g.drive?.[k];
    return `<li><span class="em">${p.emoji}</span><span class="lbl">${esc(p.label)}<small>${esc(p.name)}</small></span>
      <b>${d ? `${d.approx ? "≈" : ""}${fmtMin(d.min)}` : `${p.km} km`}</b><small class="muted">${d ? `${d.km} km` : "línea recta"}</small></li>`;
  }).join("");
  const iso = g.isolation;
  el.innerHTML = `
    ${g.approx ? `<p class="warn">📍 Ubicación aproximada: el anuncio no trae coordenadas, así que usamos el centro de ${esc(x.town)}. Tiempos y servicios son orientativos; el aislamiento no es fiable.</p>` : ""}
    <div id="dmap" class="dmap"></div>
    <h3>Tiempos en coche</h3>
    <ul class="poi">${rows || "<li>No hay datos de servicios cerca.</li>"}</ul>
    ${g.missing?.length ? `<p class="muted small">No encontrado en el radio de búsqueda: ${esc(g.missing.join(", "))}.</p>` : ""}
    <h3>🌄 Nivel de aislamiento</h3>
    <div class="iso"><div class="iso-track"><i style="left:${iso}%"></i></div>
      <div class="iso-labels"><span>Pueblo</span><span>Campo</span><span>Aislada</span></div></div>
    <p class="iso-num"><b>${g.approx ? "≈" : ""}${iso}/100</b></p>
    <ul class="facts-list">${(g.isolationFacts || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    <h3>Suministros y conexión</h3>
    <ul class="facts-list">
      <li>⚡ ${g.power != null ? `Línea o poste eléctrico a ~${g.power} m (OpenStreetMap)` : "Sin líneas eléctricas mapeadas cerca: pregunta por el suministro"}</li>
      <li>📶 ${g.antenna != null ? `Antena de telefonía mapeada a ${g.antenna} km` : "Sin antenas mapeadas cerca"} · la cobertura real se comprueba en el visor oficial</li>
      <li>💧 ${g.wells?.length ? g.wells.map((w) => `${w.kind} a ${w.m} m`).join(", ") : "Sin pozos ni fuentes mapeados"} · el agua municipal se confirma con el ayuntamiento</li>
      <li>🌐 Fibra: consulta el visor oficial de cobertura (abajo)</li>
    </ul>
    <h3>Visores oficiales</h3>
    <ul class="links">${OFFICIAL[x.country].map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${t} ↗</a></li>`).join("")}</ul>
    <p class="muted small">Datos: © OpenStreetMap, OSRM. Lo que no está mapeado en OSM puede existir igualmente.</p>`;
  drawDetailMap(g);
}

const fmtMin = (m) => m < 1 ? "<1 min" : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;

function drawDetailMap(g) {
  if (!window.L) return;
  if (detailMap) { detailMap.remove(); detailMap = null; }
  detailMap = L.map("dmap", { scrollWheelZoom: false, preferCanvas: true, zoomAnimation: !matchMedia("(prefers-reduced-motion: reduce)").matches }).setView([g.lat, g.lon], 12);
  L.tileLayer(tileUrl(), { maxZoom: 18, attribution: tileAttr }).addTo(detailMap);
  const icon = (e, cls = "") => L.divIcon({ className: "emoji-pin " + cls, html: e, iconSize: [30, 30], iconAnchor: [15, 15] });
  L.marker([g.lat, g.lon], { icon: icon("🏡", "home") }).addTo(detailMap).bindPopup(g.approx ? "Centro del pueblo (aprox.)" : "La casa");
  const pts = [[g.lat, g.lon]];
  for (const p of Object.values(g.poi || {})) {
    if (p.km > 60) continue;
    L.marker([p.lat, p.lon], { icon: icon(p.emoji) }).addTo(detailMap).bindPopup(`${p.label}: ${esc(p.name)} (${p.km} km)`);
    pts.push([p.lat, p.lon]);
  }
  setTimeout(() => { detailMap.invalidateSize(); detailMap.fitBounds(pts, { padding: [24, 24], maxZoom: 13 }); }, 80);
}

function renderTerreno() {
  const x = currentX, g = currentGeo, el = body("terreno");
  const land = x.land ? `<p>Superficie de terreno según el anuncio: <b>${Math.round(x.land).toLocaleString("es-ES")} m²</b>${x.m2 ? ` · vivienda ${x.m2} m²` : ""}.</p>` :
    `<p class="muted">El anuncio no indica la superficie del terreno${x.m2 ? ` (vivienda: ${x.m2} m²)` : ""}. Consúltala en el Catastro.</p>`;
  if (!g) { el.innerHTML = land + loading("Calculando altitud, pendiente y sol…"); return; }
  if (g.error) { el.innerHTML = land; return; }
  const t = g.terrain, s = g.solar;
  const kwp = 3;
  el.innerHTML = `${land}
    <div class="tiles">
      ${t ? `<div class="tile"><span>⛰️ Altitud</span><b>${t.elevation} m</b></div>
             <div class="tile"><span>📐 Pendiente</span><b>${t.slope}%</b><small>${t.slope < 5 ? "llano, cómodo para huerto" : t.slope < 15 ? "suave" : t.slope < 30 ? "pronunciada: bancales" : "muy fuerte"}</small></div>
             <div class="tile"><span>🧭 Orientación</span><b>${t.aspect}</b><small>${/Sur/.test(t.aspect) ? "buena exposición solar" : t.aspect === "Llano" ? "sin pendiente dominante" : /Norte/.test(t.aspect) ? "umbría: más fría y húmeda" : "sol de media jornada"}</small></div>` : ""}
      ${s ? `<div class="tile"><span>☀️ Potencial solar</span><b>${s.kwhPerKwp} kWh/kWp</b><small>${s.approx ? "estimado · " : ""}~${(s.kwhPerKwp * kwp).toLocaleString("es-ES")} kWh/año con ${kwp} kWp (consumo típico de una casa: 3.000–4.000)</small></div>` : ""}
    </div>
    <h3>Usos del suelo alrededor</h3>
    <ul class="facts-list">
      ${(g.landUse || []).map((u) => `<li>🌾 ${esc(u.kind)} a ${u.m} m</li>`).join("") || "<li>Sin cultivos mapeados a menos de 600 m</li>"}
      ${g.poi?.forest ? `<li>🌲 Bosque a ${g.poi.forest.km} km</li>` : ""}
      ${g.poi?.water ? `<li>🌊 ${esc(g.poi.water.name)} a ${g.poi.water.km} km${g.poi.water.km < 0.3 ? " — revisa el riesgo de inundación" : ""}</li>` : ""}
    </ul>
    <h3>💧 Potencial hídrico</h3>
    <ul class="facts-list">
      <li>${g.wells?.length ? `Pozos/fuentes mapeados: ${g.wells.map((w) => `${w.kind} a ${w.m} m`).join(", ")}` : "No hay pozos ni fuentes mapeados cerca"}</li>
      <li>Pregunta al ayuntamiento si hay red municipal y a qué distancia está la acometida.</li>
    </ul>
    <h3>Riesgos (inundación, deslizamientos, incendios)</h3>
    <p class="muted small">Estos datos solo se pueden consultar con fiabilidad en los visores oficiales:</p>
    <ul class="links">${OFFICIAL[x.country].slice(0, 2).map(([tt, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${tt} ↗</a></li>`).join("")}</ul>
    <p class="muted small">Altitud y pendiente: Open-Meteo (modelo de 90 m, orientativo). Sol: ${s?.approx ? "estimado con radiación de Open-Meteo" : "PVGIS, Comisión Europea"}.</p>`;
}

// ---------- Reforma
function renderReforma() {
  const x = currentX, el = body("reforma");
  const ai = aiResult(x.id);
  const rough = x.reformRough ? `<p>Estimación rápida por superficie y tipo (${KINDS[x.kindCode]}, ${x.m2} m²): <b>${eur(x.reformRough[0])} – ${eur(x.reformRough[1])}</b>.</p>` :
    `<p class="muted">Sin superficie en el anuncio no podemos hacer una estimación rápida.</p>`;
  el.innerHTML = `
    ${rough}
    <div class="ai-box" ${serverMode ? "" : "hidden"}>
      <h3>🤖 Estimación con IA</h3>
      <p class="small">Sube <b>fotos, vídeo (capturas), plano, el PDF del anuncio o la perizia</b>. La IA revisa tejado, humedad, grietas, ventanas, fachada, estructura, instalaciones, cocina, baños, aislamiento y calefacción, estima la reforma por partidas y busca trampas legales.</p>
      ${x.docs?.length ? `<p class="small">📄 Este anuncio tiene documentos oficiales: ${x.docs.slice(0, 4).map((d) => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.name)}</a>`).join(" · ")}. Descárgalos y súbelos aquí.</p>` : ""}
      <label class="drop" id="drop">
        <input type="file" id="aiFiles" accept="image/*,application/pdf" multiple hidden>
        <span>📷 Toca para elegir archivos o arrástralos aquí</span>
        <small id="aiPicked" class="muted">También funciona solo con el texto del anuncio</small>
      </label>
      <button id="aiGo" class="btn primary wide">Analizar con IA</button>
      <p id="aiNote" class="muted small"></p>
    </div>
    <div class="ai-box">
      <h3>🆓 Modo manual (gratis con claude.ai)</h3>
      <ol class="steps small">
        <li><button id="copyPrompt" class="btn ghost">📋 Copiar instrucciones</button></li>
        <li>Abre <a href="https://claude.ai/new" target="_blank" rel="noopener">claude.ai ↗</a>, pega las instrucciones y <b>adjunta las fotos, plano o PDF</b> de la casa.</li>
        <li>Cuando responda, copia toda su respuesta y pégala aquí:</li>
      </ol>
      <textarea id="manualIn" rows="5" placeholder="Pega aquí la respuesta de Claude…"></textarea>
      <button id="manualGo" class="btn primary wide">Ver el análisis</button>
      <p id="manualNote" class="muted small"></p>
    </div>
    <div id="aiOut">${ai ? aiHtml(ai) : ""}</div>`;
  const input = $("#aiFiles"), drop = $("#drop");
  let picked = [];
  const setPicked = (files) => { picked = [...files].slice(0, 12); $("#aiPicked").textContent = picked.length ? `${picked.length} archivo(s): ${picked.map((p) => p.name).join(", ")}` : "También funciona solo con el texto del anuncio"; };
  input.onchange = () => setPicked(input.files);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); setPicked(e.dataTransfer.files); };
  if (serverMode) fetch("/api/status").then((r) => r.json()).then((s) => { if (!s.ai) $("#aiNote").textContent = "⚠ " + s.aiWhy + " — o usa el modo manual gratis de abajo."; }).catch(() => {});
  $("#copyPrompt").onclick = async () => {
    try {
      await navigator.clipboard.writeText(await manualPrompt(x));
      toast("Instrucciones copiadas: pégalas en claude.ai");
    } catch { toast("No se pudieron copiar las instrucciones"); }
  };
  $("#manualGo").onclick = () => {
    const raw = $("#manualIn").value;
    try {
      const a = parseManual(raw);
      store.set("ai:" + x.id, a);
      $("#aiOut").innerHTML = aiHtml(a);
      $("#manualNote").textContent = "";
      renderResumen(); renderValor();
      toast("Análisis guardado");
      $("#aiOut").scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      $("#manualNote").textContent = "⚠ " + e.message;
    }
  };
  $("#aiGo").onclick = async () => {
    const btn = $("#aiGo");
    btn.disabled = true; btn.textContent = "Preparando archivos…";
    try {
      const files = await Promise.all(picked.map(fileToPayload));
      btn.textContent = "La IA está analizando (≈1 min)…";
      const r = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: x.id, files }) }).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      store.set("ai:" + x.id, r);
      $("#aiOut").innerHTML = aiHtml(r);
      renderResumen(); renderValor();
      toast("Análisis listo");
    } catch (e) {
      $("#aiNote").textContent = "⚠ " + e.message;
    } finally {
      btn.disabled = false; btn.textContent = "Analizar con IA";
    }
  };
}

// Mismo texto que ai.manual_prompt (Python), generado en el navegador
async function manualPrompt(x) {
  const cfg = await fetch("data/ai.json").then((r) => r.json());
  const keys = ["country", "source", "kind", "title", "description", "town", "province", "address", "price", "minOffer",
    "appraisal", "occupancy", "habitual", "categories", "m2", "land", "status"];
  const facts = Object.fromEntries(keys.map((k) => [k, x[k] ?? null]));
  if (currentGeo && !currentGeo.error) facts.entorno = { terrain: currentGeo.terrain, isolationFacts: currentGeo.isolationFacts, drive: currentGeo.drive };
  return `${cfg.system}\n\nAnuncio oficial (JSON):\n${JSON.stringify(facts)}\n\n` +
    "Te adjunto fotos, plano o documentos de la casa (si no hay, analiza solo el anuncio).\n\n" +
    `Responde ÚNICAMENTE con un bloque JSON válido que cumpla este esquema, sin texto antes ni después:\n${JSON.stringify(cfg.schema)}`;
}

function parseManual(raw) {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  let txt = (m ? m[1] : raw).trim();
  const a0 = txt.indexOf("{"), a1 = txt.lastIndexOf("}");
  if (a0 < 0 || a1 < 0) throw new Error("No encuentro el JSON en la respuesta. Copia la respuesta completa de Claude.");
  let a;
  try { a = JSON.parse(txt.slice(a0, a1 + 1)); } catch { throw new Error("La respuesta está incompleta o mal copiada. Pide a Claude «repite solo el JSON» y vuelve a pegarlo."); }
  const need = ["kind", "elements", "reform", "totalLow", "totalHigh", "legal", "verdict"];
  const miss = need.filter((k) => !(k in a));
  if (miss.length) throw new Error("Faltan apartados (" + miss.join(", ") + "). Pide a Claude que responda con el esquema completo.");
  a.kindReason ??= ""; a.uncertainty ??= []; a.summary ??= ""; a.verdictReason ??= "";
  if (!KINDS[a.kind]) a.kind = "B";
  if (!VERDICT[a.verdict]) a.verdict = "check";
  return a;
}

function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("No se pudo leer " + file.name));
    if (file.type === "application/pdf") {
      fr.onload = () => resolve({ type: "application/pdf", data: fr.result.split(",")[1] });
      fr.readAsDataURL(file);
      return;
    }
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1400 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve({ type: "image/jpeg", data: c.toDataURL("image/jpeg", 0.82).split(",")[1] });
      };
      img.onerror = () => reject(new Error("Formato de imagen no compatible: " + file.name));
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

function aiHtml(a) {
  if (a.error) return `<p class="warn">⚠ ${esc(a.error)}</p>`;
  const st = { bueno: "🟢", regular: "🟡", malo: "🔴", "no visible": "⚪" };
  return `
    <p class="ai-summary">${esc(a.summary)}</p>
    <p><b>${KINDS[a.kind]}</b> — ${esc(a.kindReason)}</p>
    <h3>Estado detectado</h3>
    <ul class="elements">${a.elements.map((e) => `<li>${st[e.status]} <b>${esc(e.element)}</b>: ${esc(e.status)}<small>${esc(e.evidence)}</small></li>`).join("")}</ul>
    <h3>Reforma estimada</h3>
    <table class="reform"><thead><tr><th>Partida</th><th>Estimación</th></tr></thead><tbody>
      ${a.reform.map((r) => `<tr><td>${esc(r.item)}<small>${esc(r.note)}</small></td><td>${eur(r.low)} – ${eur(r.high)}</td></tr>`).join("")}
    </tbody><tfoot><tr><td>Total</td><td>${eur(a.totalLow)} – ${eur(a.totalHigh)}</td></tr></tfoot></table>
    ${a.uncertainty.length ? `<div class="uncert">${a.uncertainty.map((u) => `<p>⚠️ ${esc(u)}</p>`).join("")}</div>` : ""}`;
}

// ---------- ¿Está barata?
function renderValor() {
  const x = currentX, el = body("valor");
  const ai = aiResult(x.id);
  const reformDefault = ai && !ai.error ? Math.round((ai.totalLow + ai.totalHigh) / 2) : x.reformRough ? Math.round((x.reformRough[0] + x.reformRough[1]) / 2) : "";
  const zoneKey = "eurm2:" + x.country + ":" + (x.province || "");
  const saved = store.get("valor:" + x.id, {});
  el.innerHTML = `
    ${x.discount ? `<p class="good">🟢 El valor de subasta está un <b>${x.discount}%</b> por debajo de la tasación oficial (${eur(x.appraisal)}).</p>` : ""}
    ${x.minOffer ? `<p>En Italia se puede ofrecer hasta la oferta mínima: <b>${eur(x.minOffer)}</b> (−25%).</p>` : ""}
    ${x.country === "ES" ? `<p class="muted small">En las subastas judiciales españolas muchas viviendas se adjudican entre el 50% y el 70% del valor de subasta si no hay más pujas, pero puede subir. Calcula con tu puja máxima.</p>` : ""}
    <p class="small">Necesitamos el precio por m² de casas reformadas en la zona. Míralo aquí:
      <a href="${x.country === "ES" ? "https://www.idealista.com/sala-de-prensa/informes-precio-vivienda/venta/" : "https://www.immobiliare.it/mercato-immobiliare/"}" target="_blank" rel="noopener">${x.country === "ES" ? "informe de precios de Idealista" : "prezzi di Immobiliare.it"} ↗</a></p>
    <div class="calc">
      <label>Lo que pagas (puja/precio)<input id="cPrice" type="number" inputmode="numeric" value="${saved.price ?? (x.minOffer || x.price)}"></label>
      <label>Reforma estimada<input id="cReform" type="number" inputmode="numeric" value="${saved.reform ?? reformDefault}" placeholder="€"></label>
      <label>Superficie vivienda (m²)<input id="cM2" type="number" inputmode="numeric" value="${saved.m2 ?? (x.m2 || x.surfaceOfficial || "")}" placeholder="m²"></label>
      <label>€/m² reformada en la zona<input id="cEurM2" type="number" inputmode="numeric" value="${saved.eurm2 ?? store.get(zoneKey, "")}" placeholder="p. ej. 900"></label>
    </div>
    <div id="cOut"></div>`;
  const calc = () => {
    const v = (id) => +$("#" + id).value || 0;
    const p = v("cPrice"), r = v("cReform"), m2 = v("cM2"), e = v("cEurM2");
    store.set("valor:" + x.id, { price: p, reform: r, m2, eurm2: e });
    if (e) store.set(zoneKey, e);
    const taxes = Math.round(p * (x.country === "ES" ? 0.1 : 0.09) + 1500);
    const cost = p + r + taxes;
    if (!m2 || !e) { $("#cOut").innerHTML = `<p class="muted">Rellena superficie y €/m² para calcular el margen. Coste total estimado: <b>${eur(cost)}</b> (incluye ~${eur(taxes)} de impuestos y notaría).</p>`; return; }
    const value = m2 * e, margin = value - cost, pct = Math.round((1 - cost / value) * 100);
    $("#cOut").innerHTML = `
      <table class="reform"><tbody>
        <tr><td>Precio</td><td>${eur(p)}</td></tr>
        <tr><td>Reforma</td><td>${eur(r)}</td></tr>
        <tr><td>Impuestos y notaría (aprox.)</td><td>${eur(taxes)}</td></tr>
        <tr><td><b>Coste total</b></td><td><b>${eur(cost)}</b></td></tr>
        <tr><td>Valor estimado después de reformar</td><td>${eur(value)}</td></tr>
      </tbody></table>
      <p class="${margin >= 0 ? "good" : "warn"}">${margin >= 0 ? "🟢" : "🔴"} Margen potencial: <b>${eur(margin)}</b> — ${margin >= 0 ? `estarías comprando un <b>${pct}%</b> por debajo del valor estimado.` : "costaría más de lo que valdría."}</p>
      <p class="muted small">El valor depende del €/m² que introduces; no es una tasación.</p>`;
  };
  el.querySelectorAll("input").forEach((i) => i.addEventListener("input", calc));
  calc();
}

// ---------- Contactar
const MSG = {
  es: { subj: "Solicitud de visita", body: (d) => `Buenos días:

Me pongo en contacto con ustedes por el inmueble ${d.ref} situado en ${d.town} (${d.province}), publicado en ${d.source} por ${d.price}.

Me gustaría concertar una visita y, si es posible, recibir la documentación disponible (informe de tasación o pericial, nota simple, cargas y situación posesoria).

¿Qué días y horarios serían posibles?

Muchas gracias.
Un saludo,
${d.name}${d.phone ? "\n" + d.phone : ""}` },
  it: { subj: "Richiesta di visita", body: (d) => `Buongiorno,

vi scrivo in merito all'immobile ${d.ref} sito a ${d.town} (${d.province}), pubblicato su ${d.source} con prezzo base ${d.price}.

Vorrei prenotare una visita e, se possibile, ricevere la perizia di stima e le informazioni sullo stato di occupazione e su eventuali vincoli o difformità.

Quali giorni e orari sarebbero disponibili?

Grazie mille.
Cordiali saluti,
${d.name}${d.phone ? "\n" + d.phone : ""}` },
  fr: { subj: "Demande de visite", body: (d) => `Bonjour,

Je vous contacte au sujet du bien ${d.ref} situé à ${d.town} (${d.province}), publié sur ${d.source} au prix de ${d.price}.

Je souhaiterais organiser une visite et, si possible, recevoir les documents disponibles (expertise, situation d'occupation, charges éventuelles).

Quels jours et horaires seraient possibles ?

Merci beaucoup.
Cordialement,
${d.name}${d.phone ? "\n" + d.phone : ""}` },
  en: { subj: "Viewing request", body: (d) => `Hello,

I am writing about property ${d.ref} in ${d.town} (${d.province}), listed on ${d.source} at ${d.price}.

I would like to arrange a viewing and, if possible, receive the available documents (valuation report, occupancy status and any charges or encumbrances).

Which days and times would be possible?

Many thanks.
Kind regards,
${d.name}${d.phone ? "\n" + d.phone : ""}` },
};

function renderContacto() {
  const x = currentX, el = body("contacto");
  const me = store.get("me", { name: "", phone: "" });
  const lang = store.get("lang:" + x.id, x.country === "IT" ? "it" : "es");
  el.innerHTML = `
    <div id="contactCard" class="contact-card">${x.country === "IT" ? `
      <b>🇮🇹 Cómo pedir la visita</b>
      <ol class="steps small">
        <li>Abre la ficha en el Portale Vendite Pubbliche.</li>
        <li>Pulsa <b>«Prenota visita»</b> (vía oficial, gratuita y obligatoria) y pega el mensaje.</li>
        <li>Si quieres, escribe también al <b>custode</b> que figura en el aviso de venta.</li>
      </ol>
      <a class="btn primary" href="${esc(x.url)}" target="_blank" rel="noopener">Abrir la ficha para «Prenota visita» ↗</a>
      ${x.custode ? `<b>📮 Custodio (organiza las visitas)</b>
      <div class="actions">
        ${x.custode.phone ? `<a class="btn ghost" href="tel:${esc(String(x.custode.phone).replace(/\s/g, ""))}">📞 ${esc(x.custode.phone)}</a>` : ""}
        ${x.custode.email ? `<button class="btn ghost" id="copyEmail">📋 ${esc(x.custode.email)}</button>` : ""}
      </div>
      <p class="muted small">«Abrir en el correo» y «Gmail» ya lo ponen como destinatario.</p>` : ""}`
      : loading("Buscando el contacto de la autoridad gestora en el BOE…")}</div>
    <div class="seg langs">${[["es", "🇪🇸 Español"], ["it", "🇮🇹 Italiano"], ["fr", "🇫🇷 Français"], ["en", "🇬🇧 English"]]
      .map(([k, v]) => `<button data-l="${k}" class="${k === lang ? "on" : ""}">${v}</button>`).join("")}</div>
    <div class="calc two">
      <label>Tu nombre<input id="meName" value="${esc(me.name)}" autocomplete="name"></label>
      <label>Teléfono (opcional)<input id="mePhone" value="${esc(me.phone)}" autocomplete="tel"></label>
    </div>
    <textarea id="msg" rows="14"></textarea>
    <div class="actions">
      <button id="copyMsg" class="btn primary">📋 Copiar mensaje</button>
      <a id="mailMsg" class="btn ghost">✉️ Abrir en el correo</a>
      <a id="gmailMsg" class="btn ghost" target="_blank" rel="noopener">Gmail</a>
      <a class="btn ghost" href="${esc(x.url)}" target="_blank" rel="noopener">Ir al anuncio ↗</a>
    </div>
    <p class="muted small">«Abrir en el correo» usa la app de correo predeterminada del dispositivo; «Gmail» abre Gmail con la cuenta que tengas iniciada. Comprueba el remitente antes de enviar. La app no envía nada por su cuenta.</p>`;
  let cur = lang;
  let to = x.country === "IT" ? (x.custode?.email || "") : "";
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const gmailHref = () => {
    const subj = MSG[cur].subj + " – " + x.id.replace(/^(es|it)-/, ""), body = $("#msg").value;
    return isIOS ? `googlegmail:///co?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`
      : `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
  };
  const mailHref = () => `mailto:${encodeURIComponent(to).replace("%40", "@")}?subject=${encodeURIComponent(MSG[cur].subj + " – " + x.id.replace(/^(es|it)-/, ""))}&body=${encodeURIComponent($("#msg").value)}`;
  if (x.country === "ES") {
    (serverMode ? fetch("/api/contact?id=" + encodeURIComponent(x.id)).then((r) => r.json())
      : fetch("data/contacts.json").then((r) => r.json()).then((all) => all[x.id] || { error: "sin datos" })).then((c) => {
      if (currentX !== x) return;
      const card = $("#contactCard");
      if (c.error || !(c.email || c.phone)) {
        card.innerHTML = `<p class="small">No hemos podido leer el contacto. Míralo en la pestaña <a href="${esc(x.url)}&ver=2" target="_blank" rel="noopener">«Autoridad gestora» del BOE ↗</a>.</p>`;
        return;
      }
      to = c.email || "";
      card.innerHTML = `
        <b>📮 Quién lleva la subasta</b>
        <p class="ctc-name">${esc(c.name)}</p>
        ${c.address ? `<p class="muted small">📍 ${esc(c.address)}</p>` : ""}
        <div class="actions">
          ${c.phone ? `<a class="btn ghost" href="tel:${esc(c.phone.replace(/\s/g, ""))}">📞 ${esc(c.phone)}</a>` : ""}
          ${c.email ? `<button class="btn ghost" id="copyEmail">📋 ${esc(c.email)}</button>` : ""}
        </div>
        <p class="muted small">Datos de la pestaña <a href="${esc(c.url)}" target="_blank" rel="noopener">«Autoridad gestora» del BOE ↗</a>. «Abrir en el correo» ya los pone como destinatario.</p>`;
      if (c.email) $("#copyEmail").onclick = async () => {
        try { await navigator.clipboard.writeText(c.email); toast("Correo copiado"); } catch { toast(c.email); }
      };
      $("#mailMsg").href = mailHref(); $("#gmailMsg").href = gmailHref();
    }).catch(() => {
      $("#contactCard").innerHTML = `<p class="small">No se pudo cargar el contacto. Míralo en la pestaña <a href="${esc(x.url)}&ver=2" target="_blank" rel="noopener">«Autoridad gestora» del BOE ↗</a>.</p>`;
    });
  }
  if (x.country === "IT" && x.custode?.email) setTimeout(() => {
    const b = $("#copyEmail");
    if (b) b.onclick = async () => { try { await navigator.clipboard.writeText(x.custode.email); toast("Correo copiado"); } catch { toast(x.custode.email); } };
  });
  const build = () => {
    const d = {
      ref: x.id.replace(/^(es|it)-/, x.country === "IT" ? "n. " : ""), town: x.town, province: x.province,
      source: x.source, price: eur(x.price), name: $("#meName").value || "…", phone: $("#mePhone").value,
    };
    $("#msg").value = MSG[cur].body(d);
    $("#mailMsg").href = mailHref(); $("#gmailMsg").href = gmailHref();
  };
  el.querySelectorAll(".langs button").forEach((b) => (b.onclick = () => {
    cur = b.dataset.l; store.set("lang:" + x.id, cur);
    el.querySelectorAll(".langs button").forEach((o) => o.classList.toggle("on", o === b)); build();
  }));
  for (const id of ["meName", "mePhone"]) $("#" + id).addEventListener("input", () => { store.set("me", { name: $("#meName").value, phone: $("#mePhone").value }); build(); });
  $("#msg").addEventListener("input", () => { $("#mailMsg").href = mailHref(); $("#gmailMsg").href = gmailHref(); });
  $("#copyMsg").onclick = async () => {
    try { await navigator.clipboard.writeText($("#msg").value); toast("Mensaje copiado"); }
    catch { $("#msg").select(); toast("Selecciona y copia el texto"); }
  };
  build();
}
