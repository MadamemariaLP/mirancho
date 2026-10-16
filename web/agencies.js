// Agencias locales de confianza en las zonas favoritas + mensaje en italiano para encargarles la búsqueda.
// Las agencias vienen de data/agencies.json (revisadas a mano); los pueblos con más movimiento se calculan
// en el momento con las casas de la app que cumplen tus filtros.
let agencyData = null;
const AG_WANTS = [
  ["paese", "🏘️ Casa de pueblo", "una casa indipendente in paese"],
  ["campagna", "🌾 Casa de campo / casale", "un rustico o casale in campagna"],
  ["terreno", "🌳 Con terreno", "con un po' di terreno o giardino"],
  ["pronta", "🏡 Lista para entrar", "abitabile o con lavori minimi"],
  ["reforma", "🔨 Acepto reforma", "anche da ristrutturare, purché strutturalmente sana"],
];

// Pueblos con más casas que encajan con tus filtros (precio, habitantes, tipo) en una región
function agencyHotspots(region, n = 6) {
  const maxPop = POP_STEPS[f.pop];
  const towns = {};
  for (const x of all) {
    if (x.region !== region || !x.town || x.verdict === "stop") continue;
    if (x.price > f.price || !f.kinds.includes(x.kindCode)) continue;
    if (x.population == null ? !f.unknownPop : x.population > maxPop) continue;
    if (f.hideNo && noteOf(x.id)?.status === "no") continue;
    const k = fold(x.town) + "|" + x.province;
    const t = towns[k] ||= { town: x.town.replace(/ (Di|Del|Dello|Della|Dei|Delle|Degli|Nel|Sul|All'|Dell')(?=[ \w])/g, (w) => w.toLowerCase()), province: x.province, n: 0, min: Infinity, pop: x.population };
    t.n++; t.min = Math.min(t.min, x.price);
  }
  return Object.values(towns).sort((a, b) => b.n - a.n || a.min - b.min).slice(0, n);
}

function agencyMsg(d) {
  const wants = AG_WANTS.filter(([k]) => d.wants.includes(k)).map(([, , it]) => it);
  const tipo = wants.filter((w) => w.startsWith("una") || w.startsWith("un ")).join(" oppure ") || "una casa";
  const extra = wants.filter((w) => !(w.startsWith("una") || w.startsWith("un ")));
  const zone = d.towns.length ? `, preferibilmente nella zona di ${d.towns.slice(0, -1).join(", ")}${d.towns.length > 1 ? " o " : ""}${d.towns.at(-1)}` : "";
  return `Buongiorno${d.agency ? " " + d.agency : ""},

vi scrivo dalla Spagna perché sto cercando casa in ${d.region}${zone}, e vorrei affidare la ricerca a un'agenzia locale di fiducia.

Cosa cerco:
• ${tipo}${extra.length ? ", " + extra.join(", ") : ""};
• budget massimo di circa ${eur(d.budget)}, spese escluse;
• strada di accesso carrabile e allacci di luce e acqua (presenti o facili da realizzare);
• documenti in regola: conformità urbanistica e catastale, immobile libero.

Vi chiederei di:
1. segnalarmi immobili adatti, anche quelli non ancora pubblicati sui portali;
2. fare una prima verifica (stato, documenti, eventuali vincoli) e mandarmi foto o un breve video;
3. organizzare le visite, anche in videochiamata, quando sarò in Italia.

Potreste indicarmi le vostre condizioni (provvigione o eventuale incarico di ricerca) e, se avete già qualcosa, inviarmi qualche proposta?

Posso comunicare in italiano, spagnolo o inglese. Potete rispondermi via email${d.phone ? " o WhatsApp" : ""}.

Grazie mille e cordiali saluti,
${d.name || "…"}${d.phone ? "\n" + d.phone : ""}`;
}

async function renderAgencies(el) {
  if (!agencyData) {
    el.innerHTML = `<p class="muted" style="margin-top:16px">Cargando agencias…</p>`;
    try { agencyData = await fetch("data/agencies.json").then((r) => r.json()); }
    catch { el.innerHTML = `<p class="muted" style="margin-top:16px">No se pudieron cargar las agencias. Prueba con conexión.</p>`; return; }
  }
  const regions = Object.keys(agencyData.regions);
  const fav = regions.filter((r) => prefs.favRegions.includes(r));
  let region = store.get("agRegion", fav[0] || regions[0]);
  if (!regions.includes(region)) region = regions[0];
  const me = store.get("me", { name: "", phone: "" });
  let wants = store.get("agWants", ["paese", "campagna", "terreno", "reforma"]);
  let picked = null; // pueblos elegidos a mano (si no, los 3 con más movimiento)

  el.innerHTML = `
    <div class="portals agencies">
      <p class="intro">Agencias con buena reputación en tus zonas para que <b>busquen la casa por ti</b>: te avisan de casas
      que aún no están en los portales, las revisan y organizan las visitas. Elige región, copia el mensaje en italiano y
      mándaselo a 2 o 3 agencias.</p>
      <div class="seg" id="agRegions">${regions.map((r) => `<button data-r="${esc(r)}">${esc(r)}</button>`).join("")}</div>

      <h2>📍 Dónde hay más movimiento</h2>
      <p class="muted small" id="agHotNote"></p>
      <div class="hot" id="agHot"></div>

      <h2>✍️ Tu mensaje en italiano</h2>
      <div class="chips" id="agWants">${AG_WANTS.map(([k, es]) => `<button data-k="${k}">${es}</button>`).join("")}</div>
      <div class="calc two">
        <label>Tu nombre<input id="agName" value="${esc(me.name)}" autocomplete="name"></label>
        <label>Teléfono / WhatsApp (opcional)<input id="agPhone" value="${esc(me.phone)}" autocomplete="tel"></label>
      </div>
      <textarea id="agMsg" rows="16"></textarea>
      <div class="actions"><button id="agCopy" class="btn primary">📋 Copiar mensaje</button></div>
      <p class="muted small">El presupuesto sigue al filtro de precio de «Casas» (<b id="agBudget"></b>). Cada agencia tiene su
      botón para mandarlo ya con su nombre. La app no envía nada por su cuenta.</p>

      <h2>🤝 Agencias en <span id="agRegionName"></span></h2>
      <p class="muted small" id="agZones"></p>
      <ul class="cards" id="agList"></ul>
      <p class="muted small">Reputación consultada el ${esc(agencyData.updated)} (Google, webs de las agencias y portales). En Italia
      la comisión habitual es del 3–4 % + IVA por parte, y a veces hay un mínimo fijo en casas baratas: pregunta antes de firmar
      cualquier «incarico».</p>
    </div>`;

  const data = (agency) => ({
    agency, region, wants, budget: +f.price, name: $("#agName").value, phone: $("#agPhone").value,
    towns: picked?.length ? picked : agencyHotspots(region, 3).map((t) => t.town),
  });
  const subject = () => `Ricerca casa in ${region}`;
  const draw = () => {
    const R = agencyData.regions[region];
    el.querySelectorAll("#agRegions button").forEach((b) => b.classList.toggle("on", b.dataset.r === region));
    el.querySelectorAll("#agWants button").forEach((b) => b.classList.toggle("on", wants.includes(b.dataset.k)));
    $("#agRegionName").textContent = region;
    $("#agBudget").textContent = eur(+f.price);
    $("#agZones").textContent = R.note || "";
    const hot = agencyHotspots(region);
    $("#agHotNote").textContent = hot.length
      ? `Pueblos de ${region} con más casas que encajan con tus filtros ahora mismo. Toca uno para añadirlo al mensaje.`
      : `Ahora mismo no hay casas en ${region} con tus filtros; amplía precio o habitantes en «Casas».`;
    const sel = picked?.length ? picked : hot.slice(0, 3).map((t) => t.town);
    $("#agHot").innerHTML = hot.map((t) => `
      <button class="hotbtn ${sel.includes(t.town) ? "on" : ""}" data-t="${esc(t.town)}">
        <b>${esc(t.town)}</b> <span class="muted">${esc(t.province)}</span>
        <span class="sub">${t.n} casa${t.n > 1 ? "s" : ""} · desde ${eur(t.min)}${t.pop ? ` · ${t.pop.toLocaleString("es-ES")} hab.` : ""}</span>
      </button>`).join("") + (sel.length ? `<button class="link" id="agSeeHot">Ver las casas de ${esc(sel[0])} →</button>` : "");
    $("#agMsg").value = agencyMsg(data(""));
    $("#agList").innerHTML = R.agencies.map((a, i) => `
      <li class="card agency">
        <div class="card-top">
          <span class="${a.good ? "verdict v-ok" : "tag"}">${esc(a.rep)}</span>
          ${(a.langs || []).map((l) => `<span class="tag">${esc(l)}</span>`).join("")}
        </div>
        <h3>${esc(a.name)}</h3>
        <p class="place">📍 <b>${esc(a.area)}</b></p>
        <p class="kind">${esc(a.why)}</p>
        <div class="actions">
          <button class="btn primary" data-copy="${i}">📋 Copiar para ${esc(a.short || a.name)}</button>
          ${a.email ? `<a class="btn ghost" href="mailto:${esc(a.email)}?subject=${encodeURIComponent(subject())}&body=${encodeURIComponent(agencyMsg(data(a.short || a.name)))}">✉️ Correo</a>` : ""}
          ${a.whatsapp ? `<a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/${esc(a.whatsapp.replace(/\D/g, ""))}?text=${encodeURIComponent(agencyMsg(data(a.short || a.name)))}">💬 WhatsApp</a>` : ""}
          ${a.phone ? `<a class="btn ghost" href="tel:${esc(a.phone.replace(/\s/g, ""))}">📞 ${esc(a.phone)}</a>` : ""}
          <a class="btn ghost" target="_blank" rel="noopener" href="${esc(a.web)}">Web ↗</a>
        </div>
      </li>`).join("");
    el.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => {
      const a = R.agencies[+b.dataset.copy];
      const txt = agencyMsg(data(a.short || a.name));
      try { await navigator.clipboard.writeText(txt); toast(`Mensaje para ${a.short || a.name} copiado`); }
      catch { $("#agMsg").value = txt; $("#agMsg").select(); toast("Selecciona y copia el texto"); }
    }));
    el.querySelectorAll(".hotbtn").forEach((b) => (b.onclick = () => {
      const cur = picked?.length ? picked : sel.slice();
      const t = b.dataset.t;
      picked = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
      draw();
    }));
    const see = $("#agSeeHot");
    if (see) see.onclick = () => {
      f.q = ""; f.favOnly = false; f.country = "IT"; store.set("filters", f);
      syncControls(); show("list");
      $("#q").value = sel[0] || region; onFilter();
    };
  };

  el.querySelectorAll("#agRegions button").forEach((b) => (b.onclick = () => {
    region = b.dataset.r; picked = null; store.set("agRegion", region); draw();
  }));
  el.querySelectorAll("#agWants button").forEach((b) => (b.onclick = () => {
    const k = b.dataset.k;
    wants = wants.includes(k) ? wants.filter((x) => x !== k) : [...wants, k];
    store.set("agWants", wants); draw();
  }));
  for (const id of ["agName", "agPhone"]) $("#" + id).addEventListener("input", () => {
    store.set("me", { name: $("#agName").value, phone: $("#agPhone").value }); draw();
  });
  $("#agCopy").onclick = async () => {
    try { await navigator.clipboard.writeText($("#agMsg").value); toast("Mensaje copiado"); }
    catch { $("#agMsg").select(); toast("Selecciona y copia el texto"); }
  };
  draw();
}
