// Enlaces de búsqueda prefiltrados a portales privados (no permiten lectura automática)
// y a otras fuentes públicas que no tienen API.
const PROVINCIAS_ES = [
  ["A Coruña", "a-coruna"], ["Albacete", "albacete"], ["Alicante", "alicante"], ["Almería", "almeria"],
  ["Asturias", "asturias"], ["Ávila", "avila"], ["Badajoz", "badajoz"], ["Burgos", "burgos"],
  ["Cáceres", "caceres"], ["Cádiz", "cadiz"], ["Cantabria", "cantabria"], ["Castellón", "castellon"],
  ["Ciudad Real", "ciudad-real"], ["Córdoba", "cordoba"], ["Cuenca", "cuenca"], ["Girona", "girona"],
  ["Granada", "granada"], ["Guadalajara", "guadalajara"], ["Huelva", "huelva"], ["Huesca", "huesca"],
  ["Jaén", "jaen"], ["La Rioja", "la-rioja"], ["León", "leon"], ["Lleida", "lleida"], ["Lugo", "lugo"],
  ["Málaga", "malaga"], ["Murcia", "murcia"], ["Navarra", "navarra"], ["Ourense", "ourense"],
  ["Palencia", "palencia"], ["Pontevedra", "pontevedra"], ["Salamanca", "salamanca"], ["Segovia", "segovia"],
  ["Sevilla", "sevilla"], ["Soria", "soria"], ["Tarragona", "tarragona"], ["Teruel", "teruel"],
  ["Toledo", "toledo"], ["Valencia", "valencia"], ["Valladolid", "valladolid"], ["Zamora", "zamora"],
  ["Zaragoza", "zaragoza"],
];
const REGIONI_IT = [
  ["Abruzzo", "abruzzo"], ["Basilicata", "basilicata"], ["Calabria", "calabria"], ["Campania", "campania"],
  ["Emilia-Romagna", "emilia-romagna"], ["Friuli-Venezia Giulia", "friuli-venezia-giulia"], ["Lazio", "lazio"],
  ["Liguria", "liguria"], ["Lombardia", "lombardia"], ["Marche", "marche"], ["Molise", "molise"],
  ["Piemonte", "piemonte"], ["Puglia", "puglia"], ["Sardegna", "sardegna"], ["Sicilia", "sicilia"],
  ["Toscana", "toscana"], ["Trentino-Alto Adige", "trentino-alto-adige"], ["Umbria", "umbria"],
  ["Valle d'Aosta", "valle-d-aosta"], ["Veneto", "veneto"],
];

function renderPortals(el, maxPrice) {
  const p = maxPrice;
  const es = PROVINCIAS_ES.map(([n, s]) => `
    <div class="zone"><b>${n}</b>
      <a target="_blank" rel="noopener" href="https://www.idealista.com/venta-viviendas/${s}-provincia/con-precio-hasta_${p}/">Idealista</a>
      <a target="_blank" rel="noopener" href="https://www.fotocasa.es/es/comprar/viviendas/${s}-provincia/todas-las-zonas/l?maxPrice=${p}">Fotocasa</a>
    </div>`).join("");
  const it = REGIONI_IT.map(([n, s]) => `
    <div class="zone"><b>${n}</b>
      <a target="_blank" rel="noopener" href="https://www.immobiliare.it/vendita-case/${s}/?prezzoMassimo=${p}">Immobiliare</a>
      <a target="_blank" rel="noopener" href="https://www.idealista.it/vendita-case/${s}/con-prezzo_${p}/">Idealista.it</a>
      <a target="_blank" rel="noopener" href="https://www.casa.it/vendita/residenziale/${s}/?priceMax=${p}">Casa.it</a>
    </div>`).join("");
  el.innerHTML = `
    <div class="portals">
      <p class="intro">Idealista, Fotocasa, Immobiliare y Casa.it bloquean la lectura automática, así que aquí tienes
      sus búsquedas ya filtradas a <b>${p.toLocaleString("es-ES")} €</b> por zona (el precio sigue al filtro de arriba).
      Los anuncios de las pestañas Anuncios y Mapa salen directamente de los portales oficiales.</p>

      <h2>Otras fuentes oficiales</h2>
      <ul class="official">
        <li><a target="_blank" rel="noopener" href="https://subastas.boe.es/">Portal de Subastas del BOE</a> — judiciales, notariales, Hacienda y Seguridad Social (ya incluido en la app)</li>
        <li><a target="_blank" rel="noopener" href="https://pvp.giustizia.it/pvp/">Portale delle Vendite Pubbliche</a> — aste giudiziarie (ya incluido en la app)</li>
        <li><a target="_blank" rel="noopener" href="https://casea1euro.it/">Case a 1 euro</a> — comuni italianos que venden casas a 1 € con compromiso de reforma</li>
        <li><a target="_blank" rel="noopener" href="https://www.agenziademanio.it/">Agenzia del Demanio</a> — venta de inmuebles del Estado italiano</li>
      </ul>

      <h2>🇪🇸 España por provincia</h2>
      <div class="grid">${es}</div>
      <h2>🇮🇹 Italia por región</h2>
      <div class="grid">${it}</div>
    </div>`;
}
