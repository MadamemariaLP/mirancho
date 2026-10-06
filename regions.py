"""Provincia → región (Italia) / comunidad autónoma (España)."""
import unicodedata

IT = {
    "Abruzzo": ["Chieti", "L'Aquila", "Pescara", "Teramo"],
    "Basilicata": ["Matera", "Potenza"],
    "Calabria": ["Catanzaro", "Cosenza", "Crotone", "Reggio di Calabria", "Reggio Calabria", "Vibo Valentia"],
    "Campania": ["Avellino", "Benevento", "Caserta", "Napoli", "Salerno"],
    "Emilia-Romagna": ["Bologna", "Ferrara", "Forlì-Cesena", "Forli Cesena", "Modena", "Parma", "Piacenza", "Ravenna",
                       "Reggio nell'Emilia", "Reggio Emilia", "Rimini"],
    "Friuli-Venezia Giulia": ["Gorizia", "Pordenone", "Trieste", "Udine"],
    "Lazio": ["Frosinone", "Latina", "Rieti", "Roma", "Viterbo"],
    "Liguria": ["Genova", "Imperia", "La Spezia", "Savona"],
    "Lombardia": ["Bergamo", "Brescia", "Como", "Cremona", "Lecco", "Lodi", "Mantova", "Milano",
                  "Monza e della Brianza", "Monza e Brianza", "Pavia", "Sondrio", "Varese"],
    "Marche": ["Ancona", "Ascoli Piceno", "Fermo", "Macerata", "Pesaro e Urbino", "Pesaro-Urbino"],
    "Molise": ["Campobasso", "Isernia"],
    "Piemonte": ["Alessandria", "Asti", "Biella", "Cuneo", "Novara", "Torino", "Verbano-Cusio-Ossola", "Vercelli"],
    "Puglia": ["Bari", "Barletta-Andria-Trani", "Barletta Andria Trani", "Brindisi", "Foggia", "Lecce", "Taranto"],
    "Sardegna": ["Cagliari", "Nuoro", "Oristano", "Sassari", "Sud Sardegna", "Carbonia-Iglesias", "Medio Campidano",
                 "Ogliastra", "Olbia-Tempio", "Gallura Nord-Est Sardegna", "Ogliastra Sardegna"],
    "Sicilia": ["Agrigento", "Caltanissetta", "Catania", "Enna", "Messina", "Palermo", "Ragusa", "Siracusa", "Trapani"],
    "Toscana": ["Arezzo", "Firenze", "Grosseto", "Livorno", "Lucca", "Massa-Carrara", "Massa Carrara", "Pisa",
                "Pistoia", "Prato", "Siena"],
    "Trentino-Alto Adige": ["Bolzano", "Bolzano/Bozen", "Trento"],
    "Umbria": ["Perugia", "Terni"],
    "Valle d'Aosta": ["Aosta", "Valle d'Aosta"],
    "Veneto": ["Belluno", "Padova", "Rovigo", "Treviso", "Venezia", "Verona", "Vicenza"],
}
ES = {
    "Andalucía": ["Almería", "Cádiz", "Córdoba", "Granada", "Huelva", "Jaén", "Málaga", "Sevilla"],
    "Aragón": ["Huesca", "Teruel", "Zaragoza"],
    "Asturias": ["Asturias"],
    "Illes Balears": ["Illes Balears", "Baleares", "Islas Baleares"],
    "Canarias": ["Las Palmas", "Palmas (Las)", "Santa Cruz de Tenerife"],
    "Cantabria": ["Cantabria"],
    "Castilla-La Mancha": ["Albacete", "Ciudad Real", "Cuenca", "Guadalajara", "Toledo"],
    "Castilla y León": ["Ávila", "Burgos", "León", "Palencia", "Salamanca", "Segovia", "Soria", "Valladolid", "Zamora"],
    "Cataluña": ["Barcelona", "Girona", "Gerona", "Lleida", "Lérida", "Tarragona"],
    "C. Valenciana": ["Alicante", "Alacant", "Castellón", "Castelló", "Valencia", "València"],
    "Extremadura": ["Badajoz", "Cáceres"],
    "Galicia": ["A Coruña", "La Coruña", "Coruña (A)", "Lugo", "Ourense", "Orense", "Pontevedra"],
    "Madrid": ["Madrid"],
    "Murcia": ["Murcia"],
    "Navarra": ["Navarra"],
    "País Vasco": ["Araba", "Álava", "Bizkaia", "Vizcaya", "Gipuzkoa", "Guipúzcoa"],
    "La Rioja": ["La Rioja", "Rioja (La)"],
    "Ceuta": ["Ceuta"],
    "Melilla": ["Melilla"],
}


def _n(s):
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().upper()
    return " ".join(s.replace("-", " ").replace("'", " ").split())


_INDEX = {c: {_n(p): r for r, ps in d.items() for p in ps} for c, d in (("IT", IT), ("ES", ES))}


def region(country, province):
    idx = _INDEX.get(country, {})
    for part in [province or ""] + (province or "").split("/"):
        r = idx.get(_n(part))
        if r:
            return r
    return None


def all_regions():
    return {"IT": list(IT), "ES": list(ES)}
