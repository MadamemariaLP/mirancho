// Notas y estado por casa + recordatorios de subasta en el calendario.

const STATUS = {
  like: { icon: "💚", label: "Me interesa" },
  visit: { icon: "👀", label: "Visitada" },
  bid: { icon: "💶", label: "Pujar" },
  no: { icon: "❌", label: "Descartada" },
};

const noteOf = (id) => store.get("note:" + id, null);

function setNote(id, patch) {
  const n = { ...(noteOf(id) || {}), ...patch, updated: new Date().toISOString() };
  store.set("note:" + id, n);
  // marcar una casa como interesante/pujar la guarda automáticamente
  if (n.status && n.status !== "no" && !favs.has(id)) { favs.add(id); store.set("favs", [...favs]); renderFavCount(); }
  return n;
}

function noteChip(x) {
  const n = noteOf(x.id);
  if (!n || (!n.status && !n.text)) return "";
  const st = STATUS[n.status];
  const bid = n.status === "bid" && n.maxBid ? ` hasta ${eur(n.maxBid)}` : "";
  return `<p class="note-chip">${st ? `<b>${st.icon} ${st.label}${bid}</b>` : "📝"}${n.text ? ` · ${esc(n.text.slice(0, 70))}${n.text.length > 70 ? "…" : ""}` : ""}</p>`;
}

function renderNotas() {
  const x = currentX, el = body("notas");
  const n = noteOf(x.id) || {};
  el.innerHTML = `
    <div class="status-row">${Object.entries(STATUS).map(([k, s]) =>
      `<button data-s="${k}" class="status-btn ${n.status === k ? "on" : ""}">${s.icon} ${s.label}</button>`).join("")}</div>
    <label class="bid-row" ${n.status === "bid" ? "" : "hidden"}>Pujar como máximo
      <input id="maxBid" type="number" inputmode="numeric" placeholder="€" value="${n.maxBid ?? ""}"></label>
    <textarea id="noteText" rows="4" placeholder="Tus notas: qué te gustó, dudas, qué preguntar en la visita…">${esc(n.text || "")}</textarea>
    <p class="muted small" id="noteSaved">${n.updated ? "Guardado " + new Date(n.updated).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "Se guarda solo mientras escribes. Se comparte con «📤 Compartir»."}</p>
    <div class="cal-box">
      <b>📅 Recordatorio de la subasta</b>
      ${calendarInfo(x)}
    </div>`;
  el.querySelectorAll(".status-btn").forEach((b) => (b.onclick = () => {
    const s = b.dataset.s === (noteOf(x.id) || {}).status ? null : b.dataset.s;
    setNote(x.id, { status: s });
    if (s === "no") toast("Descartada: se oculta de la lista de casas");
    renderNotas();
    $("#detailFav").textContent = favs.has(x.id) ? "★" : "☆";
  }));
  let t;
  const save = () => { clearTimeout(t); t = setTimeout(() => {
    setNote(x.id, { text: $("#noteText").value, maxBid: +$("#maxBid").value || null });
    $("#noteSaved").textContent = "Guardado ✓";
  }, 400); };
  $("#noteText").addEventListener("input", save);
  $("#maxBid").addEventListener("input", save);
  const ics = $("#icsBtn");
  if (ics) ics.onclick = () => downloadICS(x);
}

// ---------- Calendario

// Convierte fecha/hora local de una zona (p. ej. Europe/Rome) a Date en UTC
function zonedDate(date, time, tz) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "09:00").split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(guess).map((p) => [p.type, p.value]));
  const asTz = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess.getTime() - (asTz - guess.getTime()));
}

function auctionWhen(x) {
  if (x.country === "ES" && x.endISO) return new Date(x.endISO);
  if (x.date) return zonedDate(x.date, x.time || (x.country === "ES" ? "18:00" : "09:00"), x.country === "IT" ? "Europe/Rome" : "Europe/Madrid");
  return null;
}

function daysLeft(x) {
  const w = auctionWhen(x);
  return w ? Math.ceil((w - Date.now()) / 86400000) : null;
}

function calendarInfo(x) {
  const w = auctionWhen(x);
  if (!w) return `<p class="muted small">Este anuncio no indica fecha.</p>`;
  if (w < new Date()) return `<p class="muted small">La fecha ya pasó (${w.toLocaleDateString("es-ES", { dateStyle: "long" })}).</p>`;
  const when = w.toLocaleString("es-ES", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const tip = x.country === "IT"
    ? "En Italia las ofertas se presentan normalmente <b>hasta las 12:00 del día anterior</b> a la venta (revisa el aviso). Te avisaremos 3 días y 1 día antes."
    : "Las pujas en el BOE se hacen online <b>hasta el cierre</b> y necesitas el certificado digital y el depósito. Te avisaremos 3 días, 1 día y 2 horas antes.";
  return `<p class="small">${x.country === "ES" ? "Cierre de la subasta" : "Venta"}: <b>${when}</b> (hora de tu móvil) · faltan <b>${daysLeft(x)} días</b></p>
    <p class="muted small">${tip}</p>
    <div class="actions">
      <button id="icsBtn" class="btn primary">📅 Añadir a mi calendario</button>
      <a class="btn ghost" target="_blank" rel="noopener" href="${googleCalUrl(x)}">Google Calendar</a>
    </div>`;
}

const icsDate = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c);

function calTexts(x) {
  const n = noteOf(x.id);
  const title = `${x.country === "ES" ? "⏰ Cierre subasta" : "⏰ Venta"}: ${x.town} · ${eur(x.price)}`;
  const desc = [
    `${x.title}`,
    `Precio: ${eur(x.price)}${x.minOffer ? ` (oferta mínima ${eur(x.minOffer)})` : ""}`,
    n?.maxBid ? `Mi puja máxima: ${eur(n.maxBid)}` : "",
    x.country === "IT" ? "Ofertas normalmente hasta las 12:00 del día anterior (revisa el aviso)." : "Puja online en el Portal de Subastas del BOE antes del cierre.",
    `Anuncio: ${x.url}`,
    `MiRancho: ${PUBLIC_URL}#casa=${encodeURIComponent(x.id)}`,
  ].filter(Boolean).join("\n");
  return { title, desc, where: [x.town, x.province, x.country === "ES" ? "España" : "Italia"].filter(Boolean).join(", ") };
}

function downloadICS(x) {
  const start = auctionWhen(x);
  const end = new Date(start.getTime() + 60 * 60000);
  const { title, desc, where } = calTexts(x);
  const alarms = (x.country === "ES" ? ["-P3D", "-P1D", "-PT2H"] : ["-P3D", "-P1D"]).map((t) =>
    ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(title)}`, `TRIGGER:${t}`, "END:VALARM"].join("\r\n"));
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MiRancho//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${x.id}@mirancho`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(title)}`, `DESCRIPTION:${icsText(desc)}`, `LOCATION:${icsText(where)}`, `URL:${x.url}`,
    ...alarms, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `subasta-${x.town || "casa"}.ics`.replace(/\s+/g, "-");
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("Abre el archivo y pulsa «Añadir» para guardarlo en tu calendario");
}

function googleCalUrl(x) {
  const start = auctionWhen(x);
  if (!start) return "#";
  const end = new Date(start.getTime() + 60 * 60000);
  const { title, desc, where } = calTexts(x);
  return "https://calendar.google.com/calendar/render?" + new URLSearchParams({
    action: "TEMPLATE", text: title, dates: `${icsDate(start)}/${icsDate(end)}`, details: desc, location: where });
}

// ---------- Próximas subastas de tus guardadas
function renderUpcoming() {
  const el = $("#upcoming");
  if (!el) return;
  const list = all.filter((x) => favs.has(x.id) && noteOf(x.id)?.status !== "no")
    .map((x) => ({ x, d: daysLeft(x) })).filter((o) => o.d != null && o.d >= 0).sort((a, b) => a.d - b.d);
  if (!list.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<h3 class="subhead">⏰ Próximas fechas</h3><ul class="upcoming">${list.slice(0, 8).map(({ x, d }) => {
    const n = noteOf(x.id), st = STATUS[n?.status];
    return `<li data-id="${esc(x.id)}" class="${d <= 3 ? "soon" : ""}"><span class="days"><b>${d}</b>${d === 1 ? "día" : "días"}</span>
      <span class="what"><b>${esc(x.town)}</b> · ${eur(x.price)}${st ? ` · ${st.icon} ${st.label}` : ""}${n?.maxBid ? ` hasta ${eur(n.maxBid)}` : ""}</span></li>`;
  }).join("")}</ul>`;
  el.querySelectorAll("li").forEach((li) => (li.onclick = () => openDetail(byId[li.dataset.id])));
}
