const POP_STEPS = [1000, 2000, 5000, 10000, 20000, 50000, 100000, Infinity];
const ISO_STEPS = [[0, 100, "cualquiera"], [0, 30, "en el pueblo (0–30)"], [30, 60, "campo cerca del pueblo (30–60)"],
  [60, 100, "aislada (60–100)"], [80, 100, "totalmente aislada (80–100)"]];
const KINDS = { A: "🏡 Habitable", B: "🏚️ Para reformar", C: "🧱 Ruina recuperable", D: "🏚️ Ruina complicada",
  E: "🌾 Agrícola", F: "❌ No vivienda", "?": "❔ Sin datos" };
const VERDICT = {
  stop: { icon: "🔴", label: "No comprar todavía", cls: "v-stop" },
  high: { icon: "🟠", label: "Alto riesgo", cls: "v-high" },
  check: { icon: "🟡", label: "Revisar antes", cls: "v-check" },
  ok: { icon: "🟢", label: "Sin señales de riesgo", cls: "v-ok" },
};
const PAGE = 40;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n) => n == null ? "—" : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €";
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
// Texto del anuncio en el idioma elegido (traducción automática de los italianos)
const tr = (x, k) => (f.translate !== false && x[k + "_es"]) || x[k];
const fold = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600);
}

let all = [];
let byId = {};
let geoIndex = {}; // id -> resumen de ubicación ya analizada
let favs = new Set(store.get("favs", []));
const lastVisit = store.get("lastVisit", null);
let shown = PAGE;
let map, markers, current = "list";
let prefs = { favRegions: ["Puglia", "Calabria", "Lazio"], alertMaxPrice: 30000, allRegions: { IT: [], ES: [] } };
let alertHist = [];
let serverMode = false; // true en el Mac (start.sh); false en la versión publicada (iPhone)
let geoFull = {};       // análisis de ubicación ya hechos (publicados o guardados en este dispositivo)
let alertSeen = new Set(store.get("alertSeen", []));
let zoneShown = PAGE;
const isFavZone = (x) => prefs.favRegions.includes(x.region);
// En modo oscuro el mapa se oscurece con CSS (.leaflet-tile-pane)
const tileUrl = () => "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const tileAttr = "© OpenStreetMap";

const DEFAULTS = { country: "ALL", sort: "ready", price: 30000, pop: 4, iso: 0, kinds: ["A", "B", "?"],
  rural: false, unknownPop: true, onlyNew: false, favFirst: true, favOnly: false, hideNo: true, onlyPhotos: false, translate: true, q: "" };
const f = Object.assign({}, DEFAULTS, store.get("filters", {}));
// v2: el orden por defecto pasa a ser «listas para entrar y más recientes»
if (store.get("filtersV", 1) < 2) f.sort = DEFAULTS.sort;
// v3: ya no hay ruinas ni edificaciones agrícolas
if (store.get("filtersV", 1) < 3) { f.kinds = f.kinds.filter((k) => DEFAULTS.kinds.includes(k)); if (!f.kinds.length) f.kinds = [...DEFAULTS.kinds]; store.set("filtersV", 3); }
// primero las que no necesitan reforma; luego estado sin datos, reforma, ruinas...
const READY_RANK = { A: 0, "?": 1, B: 2, C: 3, E: 4, D: 5, F: 6 };
const ago = (d) => {
  const n = Math.round((Date.now() - new Date(d + "T12:00:00")) / 864e5);
  return n <= 0 ? "publicada hoy" : n === 1 ? "publicada ayer" : n < 60 ? `hace ${n} días` : `hace ${Math.round(n / 30)} meses`;
};
const published = (x) => x.published || (x.firstSeen || "").slice(0, 10);

const isNew = (x) => lastVisit && x.firstSeen > lastVisit;
const scoreOf = (x) => fullScore(x, geoIndex[x.id]).total;

function syncControls() {
  $("#q").value = f.q;
  $("#sort").value = f.sort;
  $("#price").value = f.price;
  $("#pop").value = f.pop;
  $("#iso").value = f.iso;
  for (const id of ["rural", "unknownPop", "onlyNew", "favFirst", "hideNo", "onlyPhotos", "translate"]) $("#" + id).checked = f[id];
  $("#favOnly").setAttribute("aria-pressed", String(f.favOnly));
  $("#favOnly").classList.toggle("on", f.favOnly);
  document.querySelectorAll("#country button").forEach((b) => b.classList.toggle("on", b.dataset.c === f.country));
  document.querySelectorAll("#kinds button").forEach((b) => b.classList.toggle("on", f.kinds.includes(b.dataset.k)));
  $("#priceVal").textContent = eur(+f.price);
  const p = POP_STEPS[f.pop];
  $("#popVal").textContent = p === Infinity ? "sin límite" : p.toLocaleString("es-ES");
  $("#isoVal").textContent = ISO_STEPS[f.iso][2];
  const active = ["price", "pop", "iso", "rural", "unknownPop", "onlyNew", "favFirst", "hideNo", "onlyPhotos"]
    .filter((k) => f[k] !== DEFAULTS[k]).length + (f.kinds.length !== DEFAULTS.kinds.length ? 1 : 0);
  $("#activeFilters").textContent = active || "";
}

function filtered() {
  const maxPop = POP_STEPS[f.pop];
  const [isoMin, isoMax] = ISO_STEPS[f.iso];
  const q = fold(f.q.trim());
  const res = all.filter((x) => {
    if (f.country !== "ALL" && x.country !== f.country) return false;
    if (f.favOnly && !isFavZone(x)) return false;
    if (f.hideNo && noteOf(x.id)?.status === "no") return false;
    if (x.price > f.price) return false;
    if (x.population == null ? !f.unknownPop : x.population > maxPop) return false;
    if (!f.kinds.includes(x.kindCode)) return false;
    if (f.rural && !x.rural) return false;
    if (f.onlyPhotos && !x.photos?.length) return false;
    if (f.onlyNew && !isNew(x)) return false;
    if (q && !x._text.includes(q)) return false;
    if (f.iso) {
      const g = geoIndex[x.id];
      if (!g || g.approx || g.isolation < isoMin || g.isolation > isoMax) return false;
    }
    return true;
  });
  const by = {
    score: (a, b) => scoreOf(b) - scoreOf(a),
    price: (a, b) => a.price - b.price,
    date: (a, b) => (a.date || "9").localeCompare(b.date || "9"),
    ready: (a, b) => (READY_RANK[a.kindCode] ?? 1) - (READY_RANK[b.kindCode] ?? 1) || published(b).localeCompare(published(a)),
    new: (a, b) => published(b).localeCompare(published(a)) || (b.firstSeen || "").localeCompare(a.firstSeen || ""),
    pop: (a, b) => (a.population ?? 1e9) - (b.population ?? 1e9),
    iso: (a, b) => (geoIndex[b.id]?.isolation ?? -1) - (geoIndex[a.id]?.isolation ?? -1),
  }[f.sort];
  return res.sort(f.favFirst ? (a, b) => (isFavZone(b) - isFavZone(a)) || by(a, b) : by);
}

function scoreRing(n, size = 46) {
  const hue = n >= 70 ? "var(--good)" : n >= 45 ? "var(--warn)" : "var(--bad)";
  return `<div class="ring" style="--p:${n};--c:${hue};width:${size}px;height:${size}px" title="Puntuación de oportunidad ${n}/100"><span>${n}</span></div>`;
}

function card(x) {
  const li = document.createElement("li");
  li.className = "card" + (isFavZone(x) ? " fav-zone" : "");
  li.tabIndex = 0;
  const v = VERDICT[x.verdict];
  const g = geoIndex[x.id];
  const sc = fullScore(x, g);
  const pop = x.population ? `${x.population.toLocaleString("es-ES")} hab.` : "";
  const reasons = sc.why.slice(0, 3).map((r) => `<li class="${r.startsWith("+") ? "pro" : r.startsWith("−") ? "con" : ""}">${esc(r.replace(/^[+−·] /, ""))}</li>`).join("");
  const cover = x.photos?.[0];
  li.innerHTML = `
    ${cover ? `<div class="cover"><img src="${esc(cover)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('.cover').remove()">
      ${x.photos.length > 1 ? `<span class="cover-n">📷 ${x.photos.length}</span>` : ""}
      ${x.photoSource === "Catastro (fachada)" ? `<span class="cover-src">Catastro</span>` : ""}</div>` : ""}
    <div class="card-top">
      <span class="verdict ${v.cls}">${v.icon} ${v.label}</span>
      ${isFavZone(x) ? `<span class="tag zone">⭐ ${esc(x.region)}</span>` : ""}
      ${isNew(x) || (alertIds().has(x.id) && !alertSeen.has(x.id)) ? '<span class="tag new">Nueva</span>' : ""}
      <button class="fav" aria-label="Guardar">${favs.has(x.id) ? "★" : "☆"}</button>
    </div>
    <div class="card-main">
      <div>
        <p class="place">${x.country === "ES" ? "🇪🇸" : "🇮🇹"} <b>${esc(x.town || "—")}</b> · ${esc(x.province)} ${pop ? `· ${pop}` : ""}</p>
        <h3>${esc(tr(x, "title"))}</h3>
        <p class="kind">${KINDS[x.kindCode]}${x.m2 ? ` · ${x.m2} m²` : ""}${x.land ? ` · terreno ${Math.round(x.land).toLocaleString("es-ES")} m²` : ""}${x.published ? ` · 📅 ${ago(x.published)}` : ""}</p>
      </div>
      ${scoreRing(sc.total)}
    </div>
    <div class="money"><span class="price">${eur(x.price)}</span>
      <span class="sub">${x.country === "ES" ? "valor de subasta" : "precio base"}${x.minOffer ? ` · desde ${eur(x.minOffer)}` : ""}${x.discount ? ` · ${x.discount}% bajo tasación` : ""}</span></div>
    ${g && !g.error ? `<p class="geo-mini">🛒 ${g.supermarket ?? "?"} min · 🏥 ${g.hospital ?? "?"} min · 🌄 aislamiento ${g.approx ? "≈" : ""}${g.isolation}</p>` : ""}
    ${noteChip(x)}
    <ul class="why">${reasons}</ul>
    <p class="date">${x.date ? `${x.country === "ES" ? "Fin de subasta" : "Fecha de venta"}: ${new Date(x.date).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}` : ""}</p>`;
  $(".fav", li).onclick = (e) => { e.stopPropagation(); toggleFav(x.id); $(".fav", li).textContent = favs.has(x.id) ? "★" : "☆"; };
  li.onclick = () => openDetail(x);
  li.onkeydown = (e) => { if (e.key === "Enter") openDetail(x); };
  return li;
}

function toggleFav(id) {
  favs.has(id) ? favs.delete(id) : favs.add(id);
  store.set("favs", [...favs]);
  renderFavCount();
  toast(favs.has(id) ? "★ Guardada" : "Quitada de guardadas");
  if (current === "favs") renderFavs();
}

function renderList() {
  const res = filtered();
  $("#count").textContent = `${res.length.toLocaleString("es-ES")} casas`;
  const ul = $("#list");
  ul.replaceChildren(...res.slice(0, shown).map(card));
  if (!res.length) ul.innerHTML = `<li class="empty">No hay casas con estos filtros.<br>Prueba a subir el precio o el número de habitantes.</li>`;
  $("#more").hidden = res.length <= shown;
  if (current === "map") renderMap(res);
}

let favStatus = "all";
function renderFavs() {
  renderUpcoming();
  const opts = [["all", "Todas"], ...Object.entries(STATUS).map(([k, v]) => [k, `${v.icon} ${v.label}`]), ["none", "Sin estado"]];
  $("#favStatus").innerHTML = opts.map(([k, v]) => `<button data-k="${k}" class="${favStatus === k ? "on" : ""}">${v}</button>`).join("");
  $("#favStatus").querySelectorAll("button").forEach((b) => (b.onclick = () => { favStatus = b.dataset.k; renderFavs(); }));
  const res = all.filter((x) => favs.has(x.id)).filter((x) => {
    const st = noteOf(x.id)?.status || "none";
    return favStatus === "all" ? true : st === favStatus;
  }).sort((a, b) => (daysLeft(a) ?? 1e4) - (daysLeft(b) ?? 1e4));
  $("#favs").replaceChildren(...res.map(card));
  if (!res.length) $("#favs").innerHTML = `<li class="empty">Aún no has guardado ninguna.<br>Pulsa ☆ en una casa para tenerla aquí.</li>`;
}
const renderFavCount = () => { $("#favCount").textContent = favs.size || ""; };

function renderMap(res = filtered()) {
  if (!window.L) { $("#map").textContent = "El mapa necesita conexión."; return; }
  if (!map) {
    map = L.map("map", { preferCanvas: true }).setView([42, 9], 5); // canvas: miles de puntos sin trabar el iPhone
    map._tiles = L.tileLayer(tileUrl(), { maxZoom: 18, attribution: tileAttr }).addTo(map);
    markers = L.layerGroup().addTo(map);
  }
  markers.clearLayers();
  for (const x of res) {
    const g = geoIndex[x.id];
    const lat = x.lat || g?.lat, lon = x.lon || g?.lon;
    if (!lat) continue;
    const color = { stop: "#ef4444", high: "#f97316", check: "#eab308", ok: "#10b981" }[x.verdict];
    const div = document.createElement("div");
    div.innerHTML = `<b>${eur(x.price)}</b><br>${esc(x.town)} (${esc(x.province)})<br>${KINDS[x.kindCode]}<br>`;
    const a = document.createElement("a"); a.href = "#"; a.textContent = "Abrir ficha →";
    a.onclick = (e) => { e.preventDefault(); openDetail(x); };
    div.append(a);
    L.circleMarker([lat, lon], { radius: 7, color, weight: 2, fillOpacity: .7 }).bindPopup(div).addTo(markers);
  }
  setTimeout(() => map.invalidateSize(), 50);
}

function show(view) {
  current = view;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.view === view));
  for (const v of ["list", "alerts", "map", "favs", "portals"]) $("#view-" + v).hidden = v !== view;
  $("#filters").hidden = view === "favs" || view === "portals" || view === "alerts";
  if (view === "alerts") renderAlerts();
  if (view === "map") renderMap();
  if (view === "favs") renderFavs();
  if (view === "portals") renderPortals($("#view-portals"), +f.price);
}

function onFilter() {
  f.q = $("#q").value; f.sort = $("#sort").value; f.price = +$("#price").value; f.pop = +$("#pop").value; f.iso = +$("#iso").value;
  for (const id of ["rural", "unknownPop", "onlyNew", "favFirst", "hideNo", "onlyPhotos", "translate"]) f[id] = $("#" + id).checked;
  store.set("filters", f);
  shown = PAGE;
  syncControls();
  renderList();
}

const alertIds = () => new Set(alertHist.map((a) => a.id));

function unseenAlerts() {
  const seen = new Set();
  return alertHist.filter((a) => byId[a.id] && !alertSeen.has(a.id) && !seen.has(a.id) && seen.add(a.id) && isFavZone(byId[a.id]));
}

function renderAlertCount() {
  $("#alertCount").textContent = unseenAlerts().length || "";
}

function renderAlerts() {
  const zones = prefs.favRegions;
  $("#alertZones").textContent = zones.length ? "Zonas: " + zones.join(" · ") : "Aún no has elegido zonas: hazlo en Casas → ⚙︎ Filtros.";
  $("#alertMax").textContent = eur(prefs.alertMaxPrice);
  const fresh = unseenAlerts().map((a) => byId[a.id]);
  $("#alertsNew").replaceChildren(...fresh.map(card));
  if (!fresh.length) $("#alertsNew").innerHTML = `<li class="empty small">No hay casas nuevas sin ver. Te avisaremos en cuanto aparezca alguna.</li>`;
  const inZone = all.filter((x) => isFavZone(x) && x.price <= prefs.alertMaxPrice && x.verdict !== "stop")
    .sort((a, b) => scoreOf(b) - scoreOf(a));
  $("#zoneCount").textContent = `(${inZone.length})`;
  $("#alertsZone").replaceChildren(...inZone.slice(0, zoneShown).map(card));
  $("#moreZone").hidden = inZone.length <= zoneShown;
  if (serverMode) renderNtfyCard();
  const perm = "Notification" in window ? Notification.permission : "denied";
  $("#notifyBtn").hidden = perm === "granted" || perm === "denied";
}

// Solo en el Mac: el canal de ntfy es privado y no se publica
async function renderNtfyCard() {
  const card = $("#ntfyCard");
  if (card.dataset.done) return;
  const c = await fetch("/api/ntfy").then((r) => r.json()).catch(() => ({}));
  if (!c.topic) return;
  card.dataset.done = "1"; card.hidden = false;
  card.innerHTML = `
    <b>📱 Alertas en el iPhone (tú y tu marido)</b>
    <ol class="steps small">
      <li>Instala la app gratuita <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">ntfy ↗</a>.</li>
      <li>Pulsa <b>+</b>, escribe este canal y suscríbete (deja el servidor por defecto, ntfy.sh):</li>
    </ol>
    <div class="topic-row"><code id="topic">${esc(c.topic)}</code><button id="copyTopic" class="btn ghost">📋 Copiar</button></div>
    <div class="qr-row"><div id="qr"></div><p class="muted small">O escanea este código con la cámara del iPhone para pasarte el canal.<br>Es privado: no lo compartas con nadie más.</p></div>
    <button id="testNtfy" class="btn ghost">Enviar una alerta de prueba</button>`;
  $("#copyTopic").onclick = async () => { try { await navigator.clipboard.writeText(c.topic); toast("Canal copiado"); } catch { toast(c.topic); } };
  $("#testNtfy").onclick = async () => { await fetch("/api/ntfy-test", { method: "POST" }); toast("Alerta de prueba enviada"); };
  if (window.QRCode) new QRCode($("#qr"), { text: `${c.server}/${c.topic}`, width: 120, height: 120, colorDark: "#0b0f14", colorLight: "#ffffff" });
}

async function loadPrefs() {
  try {
    if (serverMode) prefs = { ...prefs, ...(await fetch("/api/prefs").then((r) => r.json())) };
    else {
      const [p, regs] = await Promise.all([fetch("data/prefs.json", { cache: "no-cache" }).then((r) => r.json()), fetch("data/regions.json").then((r) => r.json())]);
      prefs = { ...prefs, ...p, allRegions: regs };
      const local = store.get("favRegionsLocal", null);
      if (local) prefs.favRegions = local;
    }
  } catch { /* sin datos */ }
  $("#favZones").innerHTML = ["IT", "ES"].map((c) => (prefs.allRegions[c] || []).map((r) =>
    `<button data-r="${esc(r)}" class="${prefs.favRegions.includes(r) ? "on" : ""}">${c === "IT" ? "🇮🇹" : "🇪🇸"} ${esc(r)}</button>`).join("")).join("");
  document.querySelectorAll("#favZones button").forEach((b) => (b.onclick = async () => {
    const r = b.dataset.r;
    prefs.favRegions = prefs.favRegions.includes(r) ? prefs.favRegions.filter((x) => x !== r) : [...prefs.favRegions, r];
    b.classList.toggle("on");
    if (serverMode) {
      try {
        await fetch("/api/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ favRegions: prefs.favRegions }) });
        toast("Zonas guardadas en el Mac y el iPhone");
      } catch { toast("No se pudo guardar: ¿está start.sh en marcha?"); }
    } else {
      store.set("favRegionsLocal", prefs.favRegions);
      toast("Guardado en este móvil. Para las alertas, cámbialas también en el Mac");
    }
    renderList(); renderAlertCount();
  }));
}

async function loadAlerts() {
  try { alertHist = await fetch("data/alerts.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : [])); } catch { alertHist = []; }
  renderAlertCount();
}

function notifyNew(before) {
  const fresh = unseenAlerts().filter((a) => !before.has(a.id));
  if (!fresh.length || !("Notification" in window) || Notification.permission !== "granted") return;
  const x = byId[fresh[0].id];
  new Notification(`🏡 ${fresh.length} casa(s) nueva(s) en tus zonas`, { body: `Desde ${eur(x.price)} en ${x.town} (${x.region})`, icon: "icon.svg" });
}

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  store.set("theme", t);
  $("#theme").textContent = t === "dark" ? "☀️" : "🌙";
  document.querySelector('meta[name="theme-color"]').content = t === "dark" ? "#0b0f14" : "#f5f7f8";
}

async function loadGeoIndex() {
  try {
    if (serverMode) { geoIndex = await fetch("/api/geo-index").then((r) => r.json()); return; }
    geoFull = await fetch("data/geo.json", { cache: "no-cache" }).then((r) => r.json());
  } catch { geoFull = {}; }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith("geo:")) geoFull[k.slice(4)] = JSON.parse(localStorage.getItem(k));
    }
  } catch { /* sin almacenamiento */ }
  geoIndex = Object.fromEntries(Object.entries(geoFull).map(([k, g]) => [k, compactGeo(g)]).filter(([, g]) => g));
}

// Ubicación de una casa: servidor del Mac, análisis ya publicado o cálculo en el propio navegador
async function getGeo(x) {
  if (serverMode) return fetch("/api/geo?id=" + encodeURIComponent(x.id)).then((r) => r.json());
  if (geoFull[x.id]) return geoFull[x.id];
  const g = await clientGeo(x);
  if (!g.error) { geoFull[x.id] = g; store.set("geo:" + x.id, g); }
  return g;
}

async function load() {
  serverMode = await fetch("/api/status").then((r) => r.ok && (r.headers.get("content-type") || "").includes("json")).catch(() => false);
  $("#refresh").hidden = !serverMode;
  const d = await fetch("data/listings.json", { cache: "no-cache" }).then((r) => r.json());
  all = d.listings.map((x) => ({ ...x, _text: fold([x.title, x.description, x.title_es, x.description_es, x.town, x.province, x.address].join(" ")) }));
  byId = Object.fromEntries(all.map((x) => [x.id, x]));
  await Promise.all([loadGeoIndex(), loadPrefs(), loadAlerts()]);
  const es = all.filter((x) => x.country === "ES").length;
  $("#updated").textContent = `${new Date(d.updated).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })} · ${es} 🇪🇸 · ${all.length - es} 🇮🇹`
    + (d.errors?.length ? " · ⚠ una fuente falló" : "") + (serverMode ? "" : " · se actualiza a las 9 y a las 21");
  renderList();
  renderFavCount();
  await maybeImport();
  if (location.hash.includes("bienvenida")) { history.replaceState(null, "", location.pathname); showWelcome(true); }
  else if (!serverMode && !isInstalled()) showWelcome();
  const deep = new URLSearchParams(location.hash.slice(1)).get("casa");
  if (deep && byId[deep]) openDetail(byId[deep]);
}

async function refresh() {
  const btn = $("#refresh");
  try { await fetch("/api/refresh", { method: "POST" }); } catch { toast("Para actualizar, abre la app desde tu Mac con start.sh"); return; }
  btn.disabled = true; btn.innerHTML = "⏳<span class=\"lbl\"> Buscando…</span>";
  toast("Buscando casas nuevas en el BOE y la PVP (unos minutos)…");
  const poll = setInterval(async () => {
    const s = await fetch("/api/status").then((r) => r.json()).catch(() => ({ running: false }));
    if (!s.running) {
      clearInterval(poll);
      btn.disabled = false; btn.innerHTML = "↻<span class=\"lbl\"> Actualizar</span>";
      const before = new Set(unseenAlerts().map((a) => a.id));
      await load();
      notifyNew(before);
      toast("Listo: lista actualizada");
    }
  }, 4000);
}

async function batchGeo() {
  const todo = filtered().slice(0, 10).filter((x) => !geoIndex[x.id]);
  if (!todo.length) { toast("Las 10 primeras ya están analizadas"); return; }
  const btn = $("#batchGeo"); btn.disabled = true;
  for (const [i, x] of todo.entries()) {
    btn.textContent = `📍 Analizando ${i + 1}/${todo.length}…`;
    await getGeo(x).catch(() => null);
  }
  if (serverMode) await loadGeoIndex();
  else geoIndex = Object.fromEntries(Object.entries(geoFull).map(([k, g]) => [k, compactGeo(g)]).filter(([, g]) => g));
  btn.disabled = false; btn.textContent = "📍 Analizar ubicación de las 10 primeras";
  renderList();
}

// --- eventos
document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => show(b.dataset.view)));
document.querySelectorAll("#country button").forEach((b) => (b.onclick = () => { f.country = b.dataset.c; onFilter(); }));
$("#kinds").innerHTML = Object.entries(KINDS).filter(([k]) => DEFAULTS.kinds.includes(k)).map(([k, v]) => `<button data-k="${k}">${v}</button>`).join("");
document.querySelectorAll("#kinds button").forEach((b) => (b.onclick = () => {
  const k = b.dataset.k;
  f.kinds = f.kinds.includes(k) ? f.kinds.filter((x) => x !== k) : [...f.kinds, k];
  onFilter();
}));
// Esperar a que dejes de escribir/deslizar antes de recalcular la lista (más fluido en el móvil)
let filterTimer;
const onFilterSoon = () => { clearTimeout(filterTimer); filterTimer = setTimeout(onFilter, 160); };
for (const id of ["q", "price", "pop", "iso"]) $("#" + id).addEventListener("input", onFilterSoon);
for (const id of ["sort", "rural", "unknownPop", "onlyNew", "favFirst"]) $("#" + id).addEventListener("change", onFilter);
$("#toggleFilters").onclick = () => {
  const m = $("#morefilters"); m.hidden = !m.hidden;
  $("#toggleFilters").setAttribute("aria-expanded", String(!m.hidden));
};
$("#resetFilters").onclick = () => { Object.assign(f, DEFAULTS, { kinds: [...DEFAULTS.kinds] }); syncControls(); onFilter(); };
$("#more").onclick = () => { shown += PAGE; renderList(); };
$("#moreZone").onclick = () => { zoneShown += PAGE; renderAlerts(); };
$("#favOnly").onclick = () => { f.favOnly = !f.favOnly; onFilter(); };
$("#markSeen").onclick = () => {
  for (const a of alertHist) alertSeen.add(a.id);
  store.set("alertSeen", [...alertSeen]);
  renderAlertCount(); renderAlerts(); toast("Alertas marcadas como vistas");
};
$("#notifyBtn").onclick = async () => {
  if (!("Notification" in window)) return toast("Este navegador no admite avisos");
  const p = await Notification.requestPermission();
  toast(p === "granted" ? "Avisos activados" : "Avisos no activados");
  renderAlerts();
};
$("#theme").onclick = () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
$("#refresh").onclick = refresh;
$("#batchGeo").onclick = batchGeo;
$("#shareFavs").onclick = () => openShare();
$("#invite").onclick = () => openInvite();
window.addEventListener("hashchange", () => {
  if (location.hash.includes("import=")) { maybeImport(); return; }
  const id = new URLSearchParams(location.hash.slice(1)).get("casa");
  if (id && byId[id] && currentX?.id !== id) openDetail(byId[id]);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") store.set("lastVisit", new Date().toISOString());
});

setTheme(store.get("theme", "dark"));
syncControls();
load().catch(() => { $("#updated").textContent = "Sin datos todavía: ejecuta collector.py"; });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
