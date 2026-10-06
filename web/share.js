// Compartir guardadas, análisis IA, cálculos y datos de contacto mediante un enlace.
// Todo viaja dentro del enlace (después de #), así que no pasa por ningún servidor.

const PUBLIC_URL = "https://madamemarialp.github.io/mirancho/";

async function packShare(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let out = bytes, tag = "j";
  if ("CompressionStream" in window) {
    out = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    tag = "z";
  }
  let bin = "";
  for (const b of out) bin += String.fromCharCode(b);
  return tag + "." + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function unpackShare(s) {
  const [tag, b64] = s.split(".");
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  let bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (tag === "z") bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  return JSON.parse(new TextDecoder().decode(bytes));
}

function shareDialog(html) {
  let dlg = $("#shareDlg");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "shareDlg";
    dlg.className = "mini";
    document.body.append(dlg);
  }
  dlg.innerHTML = html;
  dlg.showModal();
  return dlg;
}

function openShare() {
  const ids = [...favs];
  const withAi = ids.filter((id) => aiResult(id) && !aiResult(id).error);
  const withValor = ids.filter((id) => store.get("valor:" + id, null));
  const withNotes = ids.filter((id) => noteOf(id));
  const me = store.get("me", { name: "", phone: "" });
  if (!ids.length) { toast("Primero guarda alguna casa con ☆"); return; }
  const dlg = shareDialog(`
    <h2>📤 Compartir</h2>
    <p class="muted small">Se crea un enlace con lo que marques. Quien lo abra podrá elegir qué añadir a su MiRancho.</p>
    <div class="checks">
      <label><input type="checkbox" id="shFavs" checked disabled> ★ ${ids.length} casa(s) guardada(s)</label>
      <label><input type="checkbox" id="shAi" ${withAi.length ? "checked" : "disabled"}> 🤖 Análisis de IA (${withAi.length})</label>
      <label><input type="checkbox" id="shNotes" ${withNotes.length ? "checked" : "disabled"}> 📝 Notas y estados (${withNotes.length})</label>
      <label><input type="checkbox" id="shValor" ${withValor.length ? "checked" : "disabled"}> 📈 Cálculos de «¿Está barata?» (${withValor.length})</label>
      <label><input type="checkbox" id="shMe" ${me.name ? "" : "disabled"}> 👤 Mi nombre y teléfono para los mensajes${me.name ? ` (${esc(me.name)})` : " (aún no lo has escrito)"}</label>
    </div>
    <div class="actions">
      <button class="btn ghost" id="shCancel">Cancelar</button>
      <button class="btn primary" id="shGo">Compartir enlace</button>
    </div>`);
  $("#shCancel").onclick = () => dlg.close();
  $("#shGo").onclick = async () => {
    const data = { v: 1, favs: ids };
    if ($("#shAi").checked) data.ai = Object.fromEntries(withAi.map((id) => [id, aiResult(id)]));
    if ($("#shValor").checked) data.valor = Object.fromEntries(withValor.map((id) => [id, store.get("valor:" + id)]));
    if ($("#shMe").checked) data.me = me;
    if ($("#shNotes").checked) data.notes = Object.fromEntries(withNotes.map((id) => [id, noteOf(id)]));
    const url = PUBLIC_URL + "#import=" + await packShare(data);
    const text = `Te comparto ${ids.length} casa(s) de MiRancho`;
    dlg.close();
    if (navigator.share) {
      try { await navigator.share({ title: "MiRancho", text, url }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); toast("Enlace copiado: pégalo en WhatsApp o en un mensaje"); }
    catch { prompt("Copia este enlace:", url); }
  };
}

async function maybeImport() {
  const raw = new URLSearchParams(location.hash.slice(1)).get("import");
  if (!raw) return;
  history.replaceState(null, "", location.pathname);
  let data;
  try { data = await unpackShare(raw); } catch { toast("El enlace compartido está incompleto"); return; }
  const favsIn = (data.favs || []).filter((id) => byId[id]);
  const aiIn = Object.entries(data.ai || {}).filter(([id]) => byId[id]);
  const valorIn = Object.entries(data.valor || {}).filter(([id]) => byId[id]);
  const notesIn = Object.entries(data.notes || {}).filter(([id]) => byId[id]);
  const gone = (data.favs || []).length - favsIn.length;
  const myMe = store.get("me", { name: "" });
  const dlg = shareDialog(`
    <h2>📥 Te han compartido casas</h2>
    <p class="muted small">Elige qué añadir. Lo que ya tengas se mantiene; solo se completa lo que falte.</p>
    <div class="checks">
      <label><input type="checkbox" id="imFavs" ${favsIn.length ? "checked" : "disabled"}> ★ ${favsIn.length} casa(s) a tus guardadas</label>
      <label><input type="checkbox" id="imAi" ${aiIn.length ? "checked" : "disabled"}> 🤖 ${aiIn.length} análisis de IA</label>
      <label><input type="checkbox" id="imNotes" ${notesIn.length ? "checked" : "disabled"}> 📝 ${notesIn.length} nota(s) y estado(s)</label>
      <label><input type="checkbox" id="imValor" ${valorIn.length ? "checked" : "disabled"}> 📈 ${valorIn.length} cálculo(s) de «¿Está barata?»</label>
      <label><input type="checkbox" id="imMe" ${data.me?.name ? (myMe.name ? "" : "checked") : "disabled"}> 👤 Usar nombre y teléfono${data.me?.name ? `: ${esc(data.me.name)}${data.me.phone ? " · " + esc(data.me.phone) : ""}` : " (no incluidos)"}${myMe.name && data.me?.name ? ` <span class="muted">(sustituye a «${esc(myMe.name)}»)</span>` : ""}</label>
    </div>
    ${gone > 0 ? `<p class="muted small">${gone} casa(s) ya no están a la venta y no se añadirán.</p>` : ""}
    <div class="actions">
      <button class="btn ghost" id="imCancel">No, gracias</button>
      <button class="btn primary" id="imGo">Añadir</button>
    </div>`);
  $("#imCancel").onclick = () => dlg.close();
  $("#imGo").onclick = () => {
    let n = 0;
    if ($("#imFavs").checked) { for (const id of favsIn) if (!favs.has(id)) { favs.add(id); n++; } store.set("favs", [...favs]); }
    if ($("#imAi").checked) for (const [id, a] of aiIn) if (!aiResult(id)) store.set("ai:" + id, a);
    if ($("#imValor").checked) for (const [id, v] of valorIn) if (!store.get("valor:" + id, null)) store.set("valor:" + id, v);
    if ($("#imMe").checked && data.me) store.set("me", data.me);
    if ($("#imNotes").checked) {
      const who = data.me?.name || "la otra persona";
      for (const [id, theirs] of notesIn) {
        const mine = noteOf(id);
        if (!mine) { store.set("note:" + id, theirs); continue; }
        // conserva lo tuyo y añade su texto si es distinto
        const text = theirs.text && !(mine.text || "").includes(theirs.text)
          ? [mine.text, `— ${who}: ${theirs.text}`].filter(Boolean).join("\n") : mine.text;
        store.set("note:" + id, { ...mine, status: mine.status || theirs.status, maxBid: mine.maxBid ?? theirs.maxBid, text });
      }
    }
    dlg.close();
    renderFavCount();
    show("favs");
    toast(`Añadidas ${n} casa(s) nuevas a tus guardadas`);
  };
}

// ---------- Invitar y bienvenida
// iPadOS se presenta como «Macintosh» pero con pantalla táctil
const isIOSDevice = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/.test(navigator.userAgent);
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function inviteText(topic) {
  return `🏡 ¡Encontremos nuestro rancho!

Te invito a MiRancho, la app donde buscamos juntos casas rurales y de pueblo baratas en España e Italia (subastas oficiales, con riesgos, reforma y entorno analizados).

👉 Ábrela aquí: ${PUBLIC_URL}#bienvenida

📲 Para tenerla como una app:
• iPhone/iPad: ábrela en Safari → botón Compartir (cuadrado con flecha ⬆︎) → «Añadir a pantalla de inicio» → Añadir.
• Android: ábrela en Chrome → menú ⋮ → «Instalar app» o «Añadir a pantalla de inicio».
${topic ? `
🔔 Para recibir las alertas de casas nuevas:
1. Instala la app gratuita «ntfy».
2. Pulsa + y suscríbete al canal: ${topic}
(Es privado, no lo compartas.)
` : ""}
⭐ Guarda las que te gusten con la estrella y compártemelas desde «Guardadas».`;
}

async function openInvite() {
  let topic = "";
  if (serverMode) topic = (await fetch("/api/ntfy").then((r) => r.json()).catch(() => ({}))).topic || "";
  const dlg = shareDialog(`
    <h2>👥 Invitar a MiRancho</h2>
    <p class="muted small">Envía este mensaje por WhatsApp, SMS o correo. Puedes editarlo antes.</p>
    ${topic ? `<label class="small"><input type="checkbox" id="invTopic" checked> Incluir el canal de alertas al móvil (solo para personas de confianza)</label>` : ""}
    <textarea id="invText" rows="14"></textarea>
    <div class="actions">
      <button class="btn ghost" id="invCancel">Cerrar</button>
      <button class="btn primary" id="invGo">📤 Enviar invitación</button>
    </div>`);
  const fill = () => { $("#invText").value = inviteText($("#invTopic")?.checked ? topic : ""); };
  fill();
  $("#invTopic")?.addEventListener("change", fill);
  $("#invCancel").onclick = () => dlg.close();
  $("#invGo").onclick = async () => {
    const text = $("#invText").value;
    if (navigator.share) {
      try { await navigator.share({ title: "MiRancho", text }); dlg.close(); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(text); toast("Invitación copiada: pégala en WhatsApp"); dlg.close(); }
    catch { $("#invText").select(); toast("Selecciona y copia el texto"); }
  };
}

function showWelcome(force = false) {
  if (!force && store.get("welcomed", false)) return;
  store.set("welcomed", true);
  const installed = isInstalled();
  const tab0 = isIOSDevice() ? "ios" : isAndroid() ? "android" : "pc";
  const STEPS = {
    ios: `<ol class="steps">
        <li>Abre el enlace en <b>Safari</b> (si estás en WhatsApp, pulsa ⋯ o el icono de brújula → «Abrir en Safari»).</li>
        <li>Pulsa <b>Compartir</b> <span class="kbd">⬆︎</span>: abajo en el centro (en iPad, arriba a la derecha).</li>
        <li>Baja y elige <b>«Añadir a pantalla de inicio»</b>.</li>
        <li>Pulsa <b>Añadir</b> y abre MiRancho desde su icono verde 🏡.</li>
      </ol>`,
    android: `<ol class="steps">
        <li>Abre el enlace en <b>Chrome</b>.</li>
        <li>Pulsa el menú <span class="kbd">⋮</span> (arriba a la derecha).</li>
        <li>Elige <b>«Instalar app»</b> o <b>«Añadir a pantalla de inicio»</b>.</li>
      </ol>`,
    pc: `<ol class="steps">
        <li><b>Safari (Mac):</b> menú Archivo → <b>«Añadir al Dock»</b>.</li>
        <li><b>Chrome:</b> icono de instalar en la barra de direcciones, o menú ⋮ → <b>«Instalar MiRancho»</b>.</li>
      </ol>`,
  };
  const steps = installed ? `<p class="good">✅ Ya la tienes instalada como app.</p>` : `
      <div class="seg os-tabs">${[["ios", "🍏 iPhone / iPad"], ["android", "🤖 Android"], ["pc", "💻 Ordenador"]]
        .map(([k, v]) => `<button data-os="${k}" class="${k === tab0 ? "on" : ""}">${v}</button>`).join("")}</div>
      <div id="osSteps">${STEPS[tab0]}</div>`;
  const dlg = shareDialog(`
    <div class="welcome">
      <img src="icon-192.png" alt="" width="64" height="64">
      <h2>¡Encontremos nuestro rancho! 🏡</h2>
      <p>MiRancho busca casas rurales y de pueblo baratas en las subastas oficiales de España e Italia y te dice, de cada una, si hay trampas, cuánto costaría reformarla y cómo es su entorno.</p>
      <h3>📲 Instálala en tu móvil</h3>
      ${steps}
      <h3>Cómo se usa</h3>
      <ul class="small">
        <li>🏡 <b>Casas</b>: filtra por precio, zona y tipo; toca una casa para ver su ficha.</li>
        <li>🔔 <b>Alertas</b>: casas nuevas en nuestras zonas favoritas.</li>
        <li>★ <b>Guardadas</b>: las que te gusten; compártelas con «📤 Compartir».</li>
      </ul>
      <button class="btn primary wide" id="welcomeGo">¡Vamos a buscar!</button>
    </div>`);
  dlg.querySelectorAll(".os-tabs button").forEach((b) => (b.onclick = () => {
    dlg.querySelectorAll(".os-tabs button").forEach((o) => o.classList.toggle("on", o === b));
    $("#osSteps").innerHTML = STEPS[b.dataset.os];
  }));
  $("#welcomeGo").onclick = () => dlg.close();
}
