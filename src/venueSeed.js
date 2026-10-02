// One-time fill of venue details (address, contact, courts, hours…) for the
// venues that were created with only a name, plus the default "Kurty" menu
// item. Everything here is applied at most once per venue / per database
// (see venues.seeded_at and app_flags), so later edits made in /venues-admin
// are never overwritten and a menu item an admin removes stays removed.
//
// Sourced from blta.sk's own venue pages first, then each club's official
// site; coordinates geocoded from the street address (OpenStreetMap), except
// Zlaté Piesky, which uses the coordinates published on blta.sk. Anything
// that couldn't be verified is left out rather than guessed — fill gaps in
// /venues-admin.
const db = require('./db');
const venues = require('./venues');

const TKP = {
  phone: '+421 902 355 812',
  email: 'tkp@tkp.sk',
  website: 'https://www.tkp.sk/',
  bookingUrl: 'https://rezervujsi.tkp.sk/',
  facebook: 'https://www.facebook.com/TKPetrzalka',
  instagram: 'tenisovy_klub_petrzalka',
};

const MILOSLAV = {
  address: 'Športová 1374/18, 900 42 Miloslavov – Alžbetin Dvor',
  phone: '+421 911 229 650',
  website: 'https://www.skomiloslavov.sk/tenis',
  description: 'Tenisové kurty v športovom areáli ŠKO Miloslavov (Klub rekreačného tenisu).',
  lat: 48.0903402,
  lng: 17.3131704,
};

const SEED = {
  'Fit Camp': {
    area: 'Ružinov',
    address: 'Drieňová 11/A, 821 03 Bratislava',
    phone: '+421 910 955 595',
    email: 'info@fitcamp.sk',
    website: 'https://fitcamp.sk/',
    bookingUrl: 'https://memberzone.cz/fitcamp-fitness/Sportoviste.aspx?ID_Sportoviste=3',
    instagram: 'fitcampdrienova',
    courtType: 'OUTDOOR',
    courtsCount: 4,
    surfaces: ['CLAY', 'ARTIFICIAL_GRASS'],
    openingHours: '6:00–22:00',
    price: 'od 13 € / hod (letná sezóna 2026)',
    facilities: ['PARKING', 'SHOWERS', 'CHANGING_ROOMS', 'BAR_CAFE', 'MULTISPORT'],
    description: 'Kurty sú súčasťou športového komplexu Fit Camp. Rezervácia online, MultiSport karta akceptovaná.',
    lat: 48.1605704,
    lng: 17.1497788,
  },
  'Inter Bratislava': {
    area: 'Nové Mesto',
    address: 'Trnavská cesta 33, 821 08 Bratislava',
    phone: '+421 911 523 133',
    email: 'tenis@askinter.sk',
    website: 'https://www.askinter.sk/sk/kluby/tenis',
    facebook: 'https://www.facebook.com/askinterbratislava',
    instagram: 'askinterba',
    courtType: 'OUTDOOR',
    courtsCount: 10,
    surfaces: ['CLAY'],
    facilities: ['PARKING', 'SHOWERS'],
    description: 'Desať antukových kurtov v pokojnom prostredí hneď vedľa futbalových ihrísk. Parkovanie je možné v garáži susedného obchodného centra.',
    lat: 48.1653517,
    lng: 17.147448,
  },
  'Kurty Mladá Garda': {
    area: 'Nové Mesto',
    address: 'Račianska 103, 831 02 Bratislava',
    phone: '+421 905 568 693',
    email: 'info@tenissport.sk',
    website: 'https://ubytovanieastravovanie.stuba.sk/en/sport-complex-mlada-garda',
    facebook: 'https://www.facebook.com/stusportmladagarda',
    courtType: 'BOTH',
    courtsCount: 7,
    surfaces: ['CLAY'],
    openingHours: 'Leto Po–Pi 8:30–20:00, So–Ne 9:00–20:00; zima denne 9:30–21:00',
    description: 'Športový areál študentského domova Mladá Garda (STU). V lete 7 antukových kurtov, v zime 4 kurty v nafukovacej hale.',
    lat: 48.177312,
    lng: 17.1261017,
  },
  'Kurty Patrónka': {
    area: 'Patrónka',
    address: 'Lovinského 43, 811 05 Bratislava',
    phone: '+421 905 774 090',
    email: 'info@sportpatronka.sk',
    website: 'https://www.sportpatronka.sk/',
    bookingUrl: 'https://sportpatronka.isportsystem.sk/',
    courtType: 'BOTH',
    courtsCount: 9,
    surfaces: ['CLAY'],
    openingHours: 'Denne 8:00–22:00',
    facilities: ['RESTAURANT', 'LIGHTING', 'COACHING'],
    description: 'Šesť antukových kurtov vonku (3 s večerným osvetlením) a vyhrievaná zimná hala s 3 kurtami. V areáli je reštaurácia s terasou a tenisová akadémia; kurty sú prístupné aj pre vozíčkarov.',
    lat: 48.1638902,
    lng: 17.0799283,
  },
  'Leon - Zlaté Piesky': {
    area: 'Zlaté Piesky',
    phone: '+421 948 475 076',
    website: 'https://leontennis.com',
    facebook: 'https://www.facebook.com/leontennisacademy',
    instagram: 'leontennisacademy',
    courtType: 'BOTH',
    courtsCount: 3,
    surfaces: ['CLAY'],
    facilities: ['SHOWERS', 'BAR_CAFE', 'LIGHTING', 'COACHING'],
    description: 'Tri antukové kurty so sociálnym zázemím a barom, po zotmení s umelým osvetlením. V zime (október – marec) sa hrá v nafukovacej hale.',
    lat: 48.18616012824524,
    lng: 17.184897093063096,
  },
  'NTC Bratislava': {
    area: 'Tehelné pole',
    address: 'Príkopova 6, 831 03 Bratislava',
    phone: '+421 2 492 09 888',
    email: 'ntc@stz.sk',
    website: 'https://www.ntc.sk/',
    bookingUrl: 'https://www.ntc.sk/aktualita/rezervacia-kurtov.html',
    facebook: 'https://www.facebook.com/ntcarenaba',
    instagram: 'ntc_aegon_arena',
    courtType: 'INDOOR',
    courtsCount: 8,
    openingHours: 'Po–Pi 7:00–22:00, So–Ne 7:00–21:00',
    facilities: ['RESTAURANT', 'PRO_SHOP'],
    description: 'Národné tenisové centrum s krytými tenisovými kurtami. V komplexe sú aj bedmintonové a squashové kurty, fitness a reštaurácia s kaviarňou.',
    lat: 48.1624404,
    lng: 17.1332191,
  },
  'Slávia Filozof': {
    area: 'Ružinov',
    address: 'Nevädzová 5234/2A, 821 01 Bratislava',
    phone: '+421 905 615 543',
    website: 'https://www.slaviafilozof.sk/',
    bookingUrl: 'https://www.slaviafilozof.sk/',
    facebook: 'https://www.facebook.com/p/Tenisov%C3%A9-kurty-100063792289663/',
    courtType: 'OUTDOOR',
    courtsCount: 3,
    surfaces: ['CLAY'],
    openingHours: 'Po–Ne 8:00–22:00',
    facilities: ['PARKING', 'SHOWERS', 'CHANGING_ROOMS', 'BAR_CAFE', 'MULTISPORT'],
    description: 'Tri antukové kurty v tichom prostredí v Ružinove vedľa základnej školy, s rodinnou atmosférou a bufetom s terasou. Rezervácia online alebo telefonicky.',
    lat: 48.151624,
    lng: 17.1559447,
  },
  'Tennis ONE': {
    area: 'Nové Mesto',
    address: 'Nobelova 34, 831 02 Bratislava',
    phone: '+421 905 385 248',
    email: 'info@tennisone.sk',
    website: 'https://www.tennisone.sk/',
    courtType: 'BOTH',
    courtsCount: 4,
    surfaces: ['CLAY'],
    openingHours: 'Po–Ne 7:00–22:00',
    facilities: ['PARKING', 'SHOWERS', 'BAR_CAFE', 'COACHING'],
    description: 'Štyri udržiavané antukové kurty v areáli Istrochem, v zime pod nafukovacou halou. Rezervácia telefonicky.',
    lat: 48.1841915,
    lng: 17.1392782,
  },
  'TK Alžbetin Dvor': { ...MILOSLAV, area: 'Miloslavov – Alžbetin Dvor' },
  'TK Miloslavov': { ...MILOSLAV, area: 'Miloslavov' },
  'TK Dúbravka': {
    area: 'Dúbravka',
    address: 'Lysákova 10/A, 841 02 Bratislava',
    phone: '+421 905 109 378',
    email: 'miso.sro@inethome.sk',
    website: 'http://www.miso.ofirme.sk',
    courtType: 'BOTH',
    courtsCount: 12,
    openingHours: 'Leto 8:00–21:00, zima 8:00–22:00',
    price: 'od 3 € / hod',
    facilities: ['BAR_CAFE', 'COACHING', 'PRO_SHOP'],
    description: 'Dvanásť tenisových kurtov, v zime je 8 z nich prekrytých dvoma nafukovacími halami. Hodinové rezervácie +421 905 109 378, celoročné +421 905 240 532. V areáli aj beachvolejbal a bufet.',
    lat: 48.1902058,
    lng: 17.0406568,
  },
  'TK Lamač': {
    area: 'Lamač',
    address: 'Malokarpatské námestie, Bratislava – Lamač',
    courtType: 'OUTDOOR',
    courtsCount: 1,
    surfaces: ['CLAY'],
    description: 'Antukový dvorec Lamačského tenisového klubu nad Malokarpatským námestím, za miestnym úradom Lamač. Poloha na mape je približná.',
    lat: 48.1941258,
    lng: 17.0526234,
  },
  'TK Slovan Bratislava': {
    area: 'Nové Mesto',
    address: 'Odbojárov 3, 831 04 Bratislava',
    phone: '+421 2 206 206 00',
    website: 'https://tkslovan.sk/',
    bookingUrl: 'https://tkslovan.e-rezervace.cz/slovan/pages/Schedule.faces',
    facebook: 'https://www.facebook.com/tenisovyklubslovanbratislava',
    instagram: 'tkslovanbratislava',
    courtType: 'BOTH',
    courtsCount: 11,
    surfaces: ['CLAY', 'HARD'],
    openingHours: 'Po–Pi 8:00–20:00, So 8:00–17:00, Ne 8:00–20:00',
    facilities: ['SHOWERS', 'CHANGING_ROOMS', 'RESTAURANT', 'WELLNESS', 'COACHING'],
    description: 'Jeden z najstarších tenisových klubov v Bratislave (založený 1923). V lete 9 antukových a 2 hardové kurty, v zime haly s 3 hardovými a 4 antukovými kurtami.',
    lat: 48.1622031,
    lng: 17.1329618,
  },
  'TK Slávia STU': {
    area: 'Petržalka',
    address: 'Májová 21, 850 05 Bratislava',
    phone: '+421 903 991 122',
    email: 'recepcia@tkslaviastu.sk',
    website: 'https://www.tkslaviastu.sk/',
    facebook: 'https://www.facebook.com/slaviaagrofert/',
    instagram: 'slaviaagrofert2018',
    courtType: 'OUTDOOR',
    courtsCount: 12,
    surfaces: ['CLAY', 'HARD'],
    openingHours: 'Po–Št 7:00–21:00, Pi 7:00–20:00, So–Ne 8:00–20:00',
    facilities: ['PARKING', 'SHOWERS', 'CHANGING_ROOMS', 'COACHING', 'WELLNESS'],
    description: 'Dvanásť kurtov (10 antukových, 2 hardové) v tichom prostredí vedľa dunajskej hrádze, za Ekonomickou univerzitou.',
    lat: 48.1275167,
    lng: 17.1355954,
  },
  'TK Trnávka': {
    area: 'Trnávka',
    address: 'Vietnamská 21/A, 821 04 Bratislava',
    phone: '+421 2 4342 6981 / +421 905 847 161',
    email: 'tenisklub@stonline.sk',
    courtType: 'BOTH',
    courtsCount: 7,
    surfaces: ['CLAY'],
    openingHours: 'Po–Pi 7:00–22:00, So–Ne 8:00–22:00',
    facilities: ['LIGHTING', 'CHANGING_ROOMS', 'BAR_CAFE', 'PRO_SHOP', 'COACHING'],
    description: 'Tenis Club Trnávka: 5 antukových kurtov vonku a 2 kryté kurty v zime. V areáli aj squash, bedminton a indoor cycling.',
    lat: 48.1703594,
    lng: 17.1702222,
  },
  'TK Šamorín': {
    area: 'Šamorín',
    address: 'Pomlejská cesta 450/29, 931 01 Šamorín',
    phone: '+421 908 745 247',
    email: 'info@tksamorin.sk',
    website: 'https://tksamorin.sk/',
    bookingUrl: 'https://tksamorin.isportsystem.sk/',
    facebook: 'https://www.facebook.com/samorintenis',
    courtType: 'OUTDOOR',
    courtsCount: 5,
    surfaces: ['CLAY'],
    openingHours: 'Apríl – október, denne 7:00–21:00',
    price: '9 € / hod',
    facilities: ['PARKING'],
    description: 'Päť antukových kurtov s online rezerváciou a platbou. V areáli nie je bufet.',
    lat: 48.0406377,
    lng: 17.3204114,
  },
  'TKP Dudova': {
    ...TKP,
    area: 'Petržalka',
    address: 'Dudova 2, 851 02 Bratislava',
    courtType: 'BOTH',
    courtsCount: 8,
    surfaces: ['CLAY', 'HARD'],
    openingHours: 'Denne 7:00–22:00',
    facilities: ['SHOWERS', 'COACHING'],
    description: 'Šesť antukových a dva hardové kurty, prekryté po celý rok. Jednoduchá online objednávka a platba.',
    lat: 48.1149585,
    lng: 17.1184708,
  },
  'TKP Dunajská Lužná': {
    ...TKP,
    area: 'Dunajská Lužná',
    address: 'Rekreačná 3, 900 42 Dunajská Lužná',
    courtType: 'BOTH',
    surfaces: ['CLAY', 'HARD'],
    openingHours: 'Po–Ne 7:00–22:00',
    description: 'Antukové kurty vonku a hardový kurt v hale; v hale sú celoročne aj bedmintonové kurty.',
    lat: 48.0760757,
    lng: 17.2543503,
  },
  'TKP Nobelovo Námestie': {
    ...TKP,
    area: 'Petržalka',
    address: 'Nobelovo námestie 6, 851 01 Bratislava',
    courtType: 'OUTDOOR',
    courtsCount: 5,
    surfaces: ['CLAY'],
    openingHours: 'Denne 7:00–21:00',
    facilities: ['SHOWERS', 'COACHING'],
    description: 'Päť kvalitných antukových kurtov v areáli základnej školy. Online objednávka, platba terminálom na mieste.',
    lat: 48.1287523,
    lng: 17.1007166,
  },
  'Éči - Zlaté Piesky': {
    area: 'Zlaté Piesky',
    phone: '+421 903 428 904',
    courtType: 'OUTDOOR',
    courtsCount: 4,
    surfaces: ['CLAY'],
    facilities: ['SHOWERS'],
    description: 'Kurty „u Éčiho" sú hneď za rampou pri hlavnom vstupe do areálu Zlaté Piesky. Rezervácia iba telefonicky.',
    lat: 48.18696993935998,
    lng: 17.18520669979084,
  },
};

function seedVenueDetails() {
  const find = db.prepare('SELECT id FROM venues WHERE name = ? AND seeded_at IS NULL');
  Object.entries(SEED).forEach(([name, details]) => {
    const venue = find.get(name);
    if (!venue) return;
    const parsed = venues.parseDetails(details);
    if (parsed.error) {
      console.warn(`[venue seed] skipped "${name}": ${parsed.error}`);
      return;
    }
    const columns = { ...parsed.columns, seeded_at: new Date().toISOString() };
    const names = Object.keys(columns);
    db.prepare(`UPDATE venues SET ${names.map((n) => `${n} = @${n}`).join(', ')} WHERE id = @id`).run({ ...columns, id: venue.id });
  });
}

// Adds "Kurty / Courts" next to Rankings once. The flag (not the row) is what
// prevents a re-add, so an admin who deletes or moves it later keeps that.
function seedCourtsMenuItem() {
  if (db.prepare("SELECT 1 FROM app_flags WHERE key = 'menu_courts_added'").get()) return;
  const exists = db.prepare("SELECT 1 FROM header_items WHERE link = '/courts'").get();
  if (!exists) {
    const rankings = db.prepare("SELECT sort_order FROM header_items WHERE link = '/rankings' AND parent_id IS NULL").get();
    const maxSort = db.prepare('SELECT MAX(sort_order) AS m FROM header_items').get().m;
    const sortOrder = rankings ? rankings.sort_order : (maxSort == null ? 0 : maxSort) + 1;
    db.prepare('INSERT INTO header_items (parent_id, label_sk, label_en, link, sort_order) VALUES (NULL, ?, ?, ?, ?)')
      .run('Kurty', 'Courts', '/courts', sortOrder);
  }
  db.prepare("INSERT INTO app_flags (key) VALUES ('menu_courts_added')").run();
}

function run() {
  venues.ensureSlugs();
  seedVenueDetails();
  seedCourtsMenuItem();
}

module.exports = { run };
