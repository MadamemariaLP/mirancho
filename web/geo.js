// Análisis de ubicación en el navegador (versión publicada, sin el servidor del Mac).
// Mismo resultado que geo.py; el sol se estima con Open-Meteo porque PVGIS no admite CORS.

const GEO_POI = [
  ["supermarket", "🛒", "Supermercado", ['nwr["shop"~"supermarket|convenience"]'], 25000],
  ["hospital", "🏥", "Hospital", ['nwr["amenity"="hospital"]'], 60000],
  ["doctor", "🩺", "Centro de salud / farmacia", ['nwr["amenity"~"clinic|doctors|pharmacy"]'], 20000],
  ["school", "🏫", "Escuela", ['nwr["amenity"="school"]'], 20000],
  ["station", "🚉", "Estación de tren", ['nwr["railway"="station"]["usage"!~"tourism"]'], 50000],
  ["airport", "✈️", "Aeropuerto", ['nwr["aeroway"="aerodrome"]["iata"]'], 200000],
  ["beach", "🏖️", "Playa", ['nwr["natural"="beach"]'], 80000],
  ["village", "🏘️", "Pueblo / ciudad", ['node["place"~"village|town|city"]'], 20000],
  ["town", "🏙️", "Ciudad (>10k hab.)", ['node["place"~"town|city"]'], 60000],
  ["peak", "🏔️", "Montaña (cima)", ['node["natural"="peak"]'], 25000],
  ["water", "🌊", "Río o lago", ['nwr["natural"="water"]', 'way["waterway"~"river|stream"]'], 5000],
  ["forest", "🌲", "Bosque", ['way["landuse"="forest"]', 'way["natural"="wood"]'], 3000],
];
const GEO_DRIVE = ["supermarket", "doctor", "hospital", "school", "station", "airport", "beach", "town"];
const OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

function kmBetween(a, b, c, d) {
  const p = Math.PI / 180;
  const h = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

async function getJSON(url, opts = {}, timeout = 60000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function clientGeocode(x) {
  if (x.lat) return [x.lat, x.lon, false];
  const q = [x.town, x.province, x.country === "ES" ? "España" : "Italia"].filter(Boolean).join(", ");
  const r = await getJSON("https://nominatim.openstreetmap.org/search?" + new URLSearchParams({ q, format: "json", limit: 1, countrycodes: x.country.toLowerCase() }));
  if (!r.length) return [null, null, true];
  return [+r[0].lat, +r[0].lon, true];
}

async function clientOverpass(lat, lon) {
  const parts = GEO_POI.flatMap(([, , , flts, rad]) => flts.map((f) => `${f}(around:${rad},${lat},${lon});`)).join("");
  const q = `[out:json][timeout:60];
(${parts});out center tags qt 3000;
(way["building"](around:400,${lat},${lon}););out center tags qt 400;
(way["highway"~"^(primary|secondary|tertiary|unclassified|residential|track|service)$"](around:1500,${lat},${lon}););out center tags qt 300;
(way["power"="line"](around:2000,${lat},${lon});node["power"~"pole|tower"](around:1000,${lat},${lon}););out center tags qt 50;
(way["landuse"~"vineyard|orchard|farmland|meadow|olive"](around:600,${lat},${lon}););out center tags qt 100;
(node["man_made"~"water_well|water_tower"](around:3000,${lat},${lon});node["natural"="spring"](around:3000,${lat},${lon}););out tags qt 20;
(node["communication:mobile_phone"](around:15000,${lat},${lon});nwr["tower:type"="communication"](around:15000,${lat},${lon}););out center tags qt 30;`;
  let last;
  for (const u of OVERPASS_URLS) {
    try { return (await getJSON(u, { method: "POST", body: new URLSearchParams({ data: q }) }, 90000)).elements; }
    catch (e) { last = e; }
  }
  throw last;
}

function clientClassify(elements, lat, lon) {
  const found = Object.fromEntries(GEO_POI.map(([k]) => [k, []]));
  const buildings = [], roads = [], power = [], crops = [], wells = [], antennas = [];
  for (const el of elements) {
    const t = el.tags || {};
    const a = el.lat ?? el.center?.lat, b = el.lon ?? el.center?.lon;
    if (a == null) continue;
    const d = kmBetween(lat, lon, a, b), name = t.name || "";
    if (t.building) { buildings.push(d); continue; }
    if (t.highway) { roads.push([d, t.highway, t.surface || ""]); continue; }
    if (["line", "pole", "tower"].includes(t.power)) { power.push(d); continue; }
    if (["vineyard", "orchard", "farmland", "meadow", "olive"].includes(t.landuse) && !t.natural) { crops.push([d, t.landuse, t.trees || t.crop || ""]); continue; }
    if (["water_well", "water_tower"].includes(t.man_made) || t.natural === "spring") { wells.push([d, t.natural === "spring" ? "fuente" : "pozo/depósito"]); continue; }
    if (t["communication:mobile_phone"] || t["tower:type"] === "communication") { antennas.push(d); continue; }
    const add = (k, n) => found[k].push([d, n, a, b]);
    if (["supermarket", "convenience"].includes(t.shop)) add("supermarket", name || "Supermercado");
    if (t.amenity === "hospital") add("hospital", name || "Hospital");
    if (["clinic", "doctors", "pharmacy"].includes(t.amenity)) add("doctor", name || t.amenity);
    if (t.amenity === "school") add("school", name || "Escuela");
    if (t.railway === "station") add("station", name || "Estación");
    if (t.aeroway === "aerodrome") add("airport", `${name} (${t.iata})`);
    if (t.natural === "beach") add("beach", name || "Playa");
    if (["village", "town", "city"].includes(t.place) && d > 0.3) add("village", name);
    if (["town", "city"].includes(t.place)) add("town", name);
    if (t.natural === "peak") add("peak", `${name} ${t.ele || ""} m`.trim());
    if (t.natural === "water" || ["river", "stream"].includes(t.waterway)) add("water", name || (t.waterway ? "Río/arroyo" : "Lago/embalse"));
    if (t.landuse === "forest" || t.natural === "wood") add("forest", name || "Bosque");
  }
  const nearest = {};
  for (const [k, v] of Object.entries(found)) if (v.length) nearest[k] = v.sort((p, q) => p[0] - q[0])[0];
  const asc = (p, q) => (p[0] ?? p) - (q[0] ?? q);
  return { nearest, buildings: buildings.sort((p, q) => p - q), roads: roads.sort(asc), power: power.sort((p, q) => p - q), crops, wells: wells.sort(asc), antennas: antennas.sort((p, q) => p - q) };
}

async function clientDrive(lat, lon, nearest) {
  const keys = GEO_DRIVE.filter((k) => nearest[k]);
  if (!keys.length) return {};
  const coords = [`${lon},${lat}`, ...keys.map((k) => `${nearest[k][3]},${nearest[k][2]}`)].join(";");
  try {
    const r = await getJSON(`https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=duration,distance`, {}, 30000);
    return Object.fromEntries(keys.map((k, i) => [k, r.durations[0][i + 1] == null ? null :
      { min: Math.round(r.durations[0][i + 1] / 60), km: Math.round(r.distances[0][i + 1] / 100) / 10 }]).filter(([, v]) => v));
  } catch {
    return Object.fromEntries(keys.map((k) => [k, { min: Math.round(nearest[k][0] * 1.3), km: Math.round(nearest[k][0] * 13) / 10, approx: true }]));
  }
}

async function clientTerrain(lat, lon) {
  const dd = 60 / 111320, dl = dd / Math.cos(lat * Math.PI / 180);
  const pts = [[lat, lon], [lat + dd, lon], [lat - dd, lon], [lat, lon + dl], [lat, lon - dl]];
  const r = await getJSON("https://api.open-meteo.com/v1/elevation?" + new URLSearchParams({
    latitude: pts.map((p) => p[0].toFixed(6)).join(","), longitude: pts.map((p) => p[1].toFixed(6)).join(",") }));
  const e = r.elevation;
  const dzdx = (e[3] - e[4]) / 120, dzdy = (e[1] - e[2]) / 120;
  const slope = Math.hypot(dzdx, dzdy) * 100;
  const aspect = ((Math.atan2(-dzdx, -dzdy) * 180 / Math.PI) + 360) % 360;
  const names = ["Norte", "Noreste", "Este", "Sureste", "Sur", "Suroeste", "Oeste", "Noroeste"];
  return { elevation: Math.round(e[0]), slope: Math.round(slope * 10) / 10, aspect: slope >= 3 ? names[Math.round(aspect / 45) % 8] : "Llano" };
}

async function clientSolar(lat, lon) {
  const y = new Date().getFullYear() - 1;
  const r = await getJSON("https://archive-api.open-meteo.com/v1/archive?" + new URLSearchParams({
    latitude: lat, longitude: lon, start_date: `${y}-01-01`, end_date: `${y}-12-31`, daily: "shortwave_radiation_sum", timezone: "UTC" }));
  const ghi = r.daily.shortwave_radiation_sum.reduce((s, v) => s + (v || 0), 0) / 3.6; // MJ/m² → kWh/m²
  // inclinación óptima (+12%) y pérdidas del sistema (−14%), igual que PVGIS
  return { kwhPerKwp: Math.round(ghi * 1.12 * 0.86), irradiation: Math.round(ghi * 1.12), approx: true };
}

function clientIsolation({ buildings, nearest, roads }) {
  const nearB = buildings.filter((d) => d > 0.025);
  const n200 = nearB.filter((d) => d <= 0.2).length;
  const first = nearB.length ? nearB[0] * 1000 : 400;
  const vill = nearest.village?.[0] ?? 8, sup = nearest.supermarket?.[0] ?? 25;
  const paved = roads.filter((r) => r[1] !== "track" && !["unpaved", "gravel", "dirt", "ground"].includes(r[2]));
  const road = paved.length ? paved[0][0] * 1000 : 1500;
  const s = 25 * (1 - Math.min(1, n200 / 12)) + 20 * Math.min(1, first / 300) + 25 * Math.min(1, vill / 8)
    + 15 * Math.min(1, sup / 20) + 15 * Math.min(1, road / 1000);
  const f1 = (n) => n.toFixed(1).replace(".", ",");
  return [Math.round(s), [
    `${n200} edificios a menos de 200 m` + (nearB.length ? ` (el más cercano a ${Math.round(first)} m)` : ""),
    paved.length ? `Carretera asfaltada a ${Math.round(road)} m` : "Sin carretera asfaltada a menos de 1,5 km",
    nearest.village ? `Pueblo más cercano a ${f1(vill)} km` : "Ningún pueblo a menos de 20 km",
    nearest.supermarket ? `Supermercado a ${f1(sup)} km en línea recta` : "Sin supermercado a menos de 25 km",
  ]];
}

async function clientGeo(x) {
  const [lat, lon, approx] = await clientGeocode(x);
  if (lat == null) return { error: "No se ha podido ubicar el pueblo" };
  const out = { lat, lon, approx, errors: [] };
  const [osm, terrain, solar] = await Promise.allSettled([clientOverpass(lat, lon), clientTerrain(lat, lon), clientSolar(lat, lon)]);
  if (osm.status === "fulfilled") {
    const c = clientClassify(osm.value, lat, lon);
    out.poi = Object.fromEntries(GEO_POI.filter(([k]) => c.nearest[k]).map(([k, e, lbl]) => [k,
      { emoji: e, label: lbl, km: Math.round(c.nearest[k][0] * 10) / 10, name: c.nearest[k][1], lat: c.nearest[k][2], lon: c.nearest[k][3] }]));
    out.missing = GEO_POI.filter(([k]) => !c.nearest[k]).map(([, , lbl]) => lbl);
    out.drive = await clientDrive(lat, lon, c.nearest);
    [out.isolation, out.isolationFacts] = clientIsolation(c);
    out.power = c.power.length ? Math.round(c.power[0] * 1000) : null;
    out.antenna = c.antennas.length ? Math.round(c.antennas[0] * 10) / 10 : null;
    out.wells = c.wells.slice(0, 3).map(([d, k]) => ({ m: Math.round(d * 1000), kind: k }));
    const uses = {};
    for (const [d, use, extra] of c.crops) {
      let label = { vineyard: "viñedo", orchard: "frutales", olive: "olivar", farmland: "cultivo", meadow: "prado" }[use];
      if (String(extra).includes("olive")) label = "olivar";
      uses[label] = Math.min(uses[label] ?? 9, d);
    }
    out.landUse = Object.entries(uses).sort((p, q) => p[1] - q[1]).map(([k, v]) => ({ kind: k, m: Math.round(v * 1000) }));
  } else out.errors.push("OpenStreetMap: " + osm.reason);
  if (terrain.status === "fulfilled") out.terrain = terrain.value; else out.errors.push("Elevación: " + terrain.reason);
  if (solar.status === "fulfilled") out.solar = solar.value; else out.errors.push("Sol: " + solar.reason);
  if (!out.poi) out.error = "No se pudo consultar OpenStreetMap ahora mismo; prueba en un rato.";
  return out;
}
