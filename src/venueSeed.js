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
const path = require('path');
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

// Venues added to the list from here, once each (the app_flags row, not the venue, stops a re-add: an admin who deletes one keeps it
// deleted). A venue the admin already made under a spelling of the same name ("Pro Set", "Proset"…) gets the details instead of a twin,
// unless its details were filled in before. Sourced from each club's own site or page (2026-10-12; TK Júliusa Pántika and Tenis Club 26: their Facebook pages only): contact, price list and booking pages; what a site
// does not say (a surface, a court count) is left out. Coordinates: the map point on the club's own page (Top Tenis, Love4Tennis), the courts
// of the club in OpenStreetMap (Dúbravka), the street address geocoded from OpenStreetMap (Pro Set).
const NEW_VENUES = [
  {
    flag: 'venue_added_tk_pro_set',
    name: 'TK Pro Set',
    sameAs: ['proset', 'tkproset'],
    details: {
      area: 'Petržalka',
      address: 'Vlastenecké námestie 1, 851 01 Bratislava',
      phone: '+421 905 601 385',
      email: 'madajova.proset@gmail.com',
      website: 'https://www.pro-set.sk/',
      bookingUrl: 'https://www.pro-set.sk/reservations',
      courtType: 'BOTH',
      courtsCount: 4,
      surfaces: ['CLAY'],
      openingHours: 'Po–Ne 8:00–22:00',
      price: 'leto od 10 € / hod, zimná hala od 20 € / hod (špička 15–21 h drahšia)',
      facilities: ['LIGHTING', 'RACKET_RENTAL', 'COACHING', 'MULTISPORT'],
      description: 'Štyri antukové kurty tenisového klubu TK Pro Set (od roku 1996): v lete vonku, od októbra do apríla v nafukovacej hale. Online rezervácia; osvetlenie 3 € / hod, požičanie rakety 2 €. Karta MultiSport sa akceptuje iba v lete. Od sezóny 2026 aj tenisová akadémia pre deti.',
      lat: 48.1252846,
      lng: 17.1118133,
    },
  },
  {
    flag: 'venue_added_tk_dubravka',
    name: 'TK Dúbravka - Lysákova',
    sameAs: ['tkdubravka', 'dubravka', 'dubravskesportovecentrum', 'tkdubravkalysakova', 'tenisovyklubdubravka'],
    details: {
      area: 'Dúbravka',
      address: 'Lysákova 1, 841 01 Bratislava',
      phone: '+421 905 109 378',
      email: 'dsc@atlas.sk',
      website: 'https://www.dubravskesportovecentrum.sk/',
      bookingUrl: 'https://dubravskesportovecentrum.isportsystem.sk/',
      facebook: 'https://www.facebook.com/sktcd/',
      instagram: 'tk_dubravka',
      courtType: 'BOTH',
      courtsCount: 13,
      openingHours: 'Po–Pi 8:00–22:00, So–Ne 8:00–20:00',
      price: 'leto 8–13 € / hod (člen / nečlen), hala v zime 17–25 € / hod; osvetlenie +3,50 €',
      facilities: ['LIGHTING', 'SHOWERS', 'BAR_CAFE', 'COACHING'],
      description: 'Dúbravské športové centrum: areál s 13 tenisovými dvorcami a dvoma nafukovacími halami (v zime 2 × 4 dvorce), domov Tenisového klubu Dúbravka od roku 1999. Šatne so sprchami, bufet, tenisová škola, beach volejbal, workoutové a detské ihrisko. Hodinové rezervácie online, celosezónne cez klub.',
      lat: 48.1899,
      lng: 17.0418,
    },
  },
  {
    flag: 'venue_added_top_tenis',
    name: 'Top Tenis - Budatínska',
    sameAs: ['toptenis', 'toptenisbudatinska', 'toptenissk', 'tktoptenis'],
    details: {
      area: 'Petržalka',
      address: 'Budatínska 61, Bratislava',
      phone: '+421 905 380 001',
      email: 'toptenis@toptenis.sk',
      website: 'https://www.toptenis.sk/',
      bookingUrl: 'https://www.toptenis.sk/online-booking/',
      facebook: 'https://www.facebook.com/Toptenisik',
      instagram: 'toptenissk',
      courtType: 'BOTH',
      openingHours: 'Po–Ne 8:00–22:00',
      price: 'leto 8–12 € / hod, zimná hala 16–21 € / hod; osvetlenie +4 € / hod',
      facilities: ['LIGHTING', 'COACHING'],
      description: 'Kurty TOP Tenis, n.o. v areáli ZŠ Budatínska 61 v Petržalke: v lete vonku, v zime v hale. Tréningy pre deti aj dospelých, tenisové tábory a turnaje. Večer je osvetlenie na dvoch kurtoch. Online rezervácia.',
      lat: 48.103412,
      lng: 17.099693,
    },
  },
  {
    flag: 'venue_added_love4tennis',
    name: 'Love4Tennis',
    sameAs: ['love4tennis', 'love4tennisacademy', 'l4t', 'love4tennisturbinova'],
    details: {
      area: 'Nové Mesto',
      address: 'Turbínova 1, 831 04 Bratislava',
      phone: '+421 911 508 720',
      email: 'academy@love4tennis.com',
      website: 'https://love4tennis.com/sk/',
      facebook: 'https://www.facebook.com/TKLOVE4TENNIS/',
      instagram: 'love4tennis_cibulkova_academy',
      courtType: 'BOTH',
      courtsCount: 8,
      surfaces: ['CLAY', 'HARD'],
      openingHours: 'Po–Pi 8:00–22:00, víkend po dohode',
      price: 'leto 10–15 € / hod, zima 25 € / hod',
      facilities: ['COACHING'],
      description: 'Tenisová akadémia Love4Tennis (Dominika Cibulková): šesť antukových a dva hardové kurty (povrch ako na US Open); v zime sú všetky kurty zakryté a vyhrievané. Kurt sa objednáva telefonicky alebo e-mailom v pracovné dni 12:00–20:00.',
      lat: 48.1735685,
      lng: 17.151149,
    },
  },
  {
    flag: 'venue_added_tk_pantik_senec',
    name: 'TK Júliusa Pántika - Senec',
    sameAs: ['tkjuliusapantika', 'tenisovyklubjuliusapantika', 'tkjuliusapantikasenec', 'tkpantik', 'pantik', 'senec'],
    details: {
      area: 'Senec',
      address: 'Pezinská 1, 903 01 Senec',
      phone: '+421 905 315 554',
      email: 'kurty.pantik@gmail.com',
      facebook: 'https://www.facebook.com/people/Tenisov%C3%BD-klub-J%C3%BAliusa-P%C3%A1ntika/100078854433824/',
      description: 'Tenisový klub v Senci, ktorý vznikol na počesť pamiatky hereckej osobnosti Júliusa Pántika. Informácie o kurtoch a rezervácii vám poskytne klub na uvedenom telefóne alebo e-maile.',
      lat: 48.2182904,
      lng: 17.3921304,
    },
  },
  {
    flag: 'venue_added_tenis_club_26',
    name: 'Tenis Club 26',
    sameAs: ['tenisclub26', 'tc26', 'tenisclub26vrakuna'],
    // the street is Stavbárska (given by the BLTA admin; the club's Facebook page has no street at all); the house number is not confirmed anywhere,
    // so there is no number and no map point rather than a guess (add them in /venues-admin)
    details: {
      area: 'Vrakuňa',
      address: 'Stavbárska ulica, Bratislava',
      phone: '+421 910 292 291',
      email: 'hornik26@gmail.com',
      facebook: 'https://www.facebook.com/people/TENIS-CLUB-26/100069321905468/',
      courtType: 'BOTH',
      description: 'Tenisové kurty a hala vo Vrakuni.',
    },
  },
  {
    flag: 'venue_added_matchball',
    name: 'Matchball',
    sameAs: ['matchball', 'matchballkurty'],
    details: {
      area: 'Petržalka',
      address: 'Smolenická 20, 851 05 Bratislava',
      phone: '+421 2 638 375 27',
      email: '5eterko@gmail.com',
      facebook: 'https://www.facebook.com/people/Matchball-Kurty/100063567554407/',
      facilities: ['BAR_CAFE', 'RESTAURANT'],
      description: 'Matchball - Kurty: športovo-oddychový areál s barom a reštauráciou. K dispozícii sú tenisové kurty, streetball, ping-pong, šípky, detské ihrisko, oddychová zóna a záhrada na súkromné eventy; domáca a streetfood kuchyňa.',
      lat: 48.1087596,
      lng: 17.099546,
    },
  },
];

function addNewVenues() {
  NEW_VENUES.forEach(({ flag, name, sameAs, details }) => {
    if (db.prepare('SELECT 1 FROM app_flags WHERE key = ?').get(flag)) return;
    const parsed = venues.parseDetails(details);
    if (parsed.error) {
      console.warn(`[venue seed] skipped "${name}": ${parsed.error}`);
      return;
    }
    const compact = (text) => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const existing = db.prepare('SELECT id, name, seeded_at FROM venues').all().find((v) => sameAs.includes(compact(v.name)));
    const stamp = new Date().toISOString();
    if (existing) {
      if (!existing.seeded_at) {
        const columns = { ...parsed.columns, seeded_at: stamp };
        db.prepare(`UPDATE venues SET ${Object.keys(columns).map((n) => `${n} = @${n}`).join(', ')} WHERE id = @id`).run({ ...columns, id: existing.id });
      }
    } else {
      const columns = { name, slug: venues.uniqueSlug(name), ...parsed.columns, seeded_at: stamp };
      const names = Object.keys(columns);
      db.prepare(`INSERT INTO venues (${names.join(', ')}) VALUES (${names.map((n) => `@${n}`).join(', ')})`).run(columns);
    }
    db.prepare('INSERT INTO app_flags (key) VALUES (?)').run(flag);
  });
}

// The tennis venues of Košice (the city slta.sk/kosice), added once each when that city exists (the app_flags row stops a re-add: an admin who
// deletes one keeps it deleted; a venue of that name that is already there is left alone). Sourced from each venue's own site (2026-10-24):
// NTC Košice (ntckosice.sk), Tenis Komplex (teniskomplex.sk), Tenisové kurty Medická (tenniskosice.sk), Tenisové kurty Anička
// (tenisovekurtyanicka.sk, read through a web search: the site's certificate has expired), TK DRANaM (dranam.sk). What a site does not say
// (a price, a court count, a surface) is left out. Coordinates: the street address geocoded from OpenStreetMap (NTC Košice: its own entry
// there), the courts of Anička in OpenStreetMap; Medická has no map point because its site gives a street, not a number.
const CITY_VENUES = {
  kosice: [
    {
      flag: 'venue_added_kosice_ntc',
      name: 'NTC Košice',
      details: {
        area: 'Košice-Západ',
        address: 'Popradská 84E, 040 11 Košice',
        phone: '+421 55 321 43 80',
        email: 'ntckosice@ntckosice.sk',
        website: 'https://www.ntckosice.sk/',
        facebook: 'https://www.facebook.com/ntckosice',
        instagram: 'ntckosice',
        courtType: 'BOTH',
        courtsCount: 11,
        surfaces: ['CLAY'],
        openingHours: '7:00–21:00',
        facilities: ['PARKING', 'RESTAURANT', 'RACKET_RENTAL', 'PRO_SHOP', 'MULTISPORT'],
        description: 'Národné tréningové centrum Košice: 3 kurty v tenisovej hale a 8 vonkajších antukových kurtov v lete. Rezervácia na recepcii telefonicky alebo online cez web centra. Požičanie rakiet 2 € / ks.',
        lat: 48.7095421,
        lng: 21.2272488,
      },
    },
    {
      flag: 'venue_added_kosice_tenis_komplex',
      name: 'Tenis Komplex Košice',
      details: {
        area: 'KVP',
        address: 'Wuppertálska 4, 040 23 Košice',
        phone: '+421 911 282 919',
        email: 'info@teniskomplex.sk',
        website: 'https://www.teniskomplex.sk/',
        bookingUrl: 'https://teniskomplex.isportsystem.sk/',
        facebook: 'https://www.facebook.com/teniskomplex',
        instagram: 'tenis.komplex',
        courtType: 'BOTH',
        courtsCount: 4,
        surfaces: ['CLAY'],
        openingHours: 'Po–Ne 7:00–22:00',
        facilities: ['BAR_CAFE'],
        description: 'Športový komplex z roku 1999: 4 antukové kurty, bedminton, squash, bowling a fitness. Bar a pizzéria. Rezervácia online alebo telefonicky (aj 055 645 26 11).',
        lat: 48.7136734,
        lng: 21.2200939,
      },
    },
    {
      flag: 'venue_added_kosice_medicka',
      name: 'Tenisové kurty Medická',
      details: {
        area: 'Košice-Západ',
        address: 'Medická ulica, 040 01 Košice',
        website: 'https://www.tenniskosice.sk/',
        bookingUrl: 'https://medicka.courtbee.com',
        instagram: 'teniskosice',
        courtType: 'BOTH',
        openingHours: 'Apríl–september 7:00–20:00 (vonkajšie), október–apríl 7:00–22:00 (kryté)',
        facilities: ['PARKING', 'SHOWERS', 'CHANGING_ROOMS', 'RACKET_RENTAL'],
        description: 'Tréningové centrum v centre Košíc, kde sa hrá po celý rok: v lete vonkajšie kurty, v zime 2 kryté kurty v nafukovacej hale. Bezplatné parkovanie, šatne so sprchou, požičanie rakiet.',
      },
    },
    {
      flag: 'venue_added_kosice_anicka',
      name: 'Tenisové kurty Anička',
      details: {
        area: 'Košice-Sever',
        address: 'Kostolianska cesta 12, 040 01 Košice',
        phone: '+421 907 422 032',
        website: 'http://www.tenisovekurtyanicka.sk/',
        courtType: 'OUTDOOR',
        courtsCount: 8,
        surfaces: ['CLAY'],
        facilities: ['LIGHTING'],
        description: 'Tenisový areál pri parku Anička: 8 antukových kurtov v rade (2 z nich osvetlené) a centrálny kurt s tribúnou.',
        lat: 48.74417,
        lng: 21.25191,
      },
    },
    {
      flag: 'venue_added_kosice_dranam',
      name: 'TK DRANaM',
      details: {
        area: 'Košice-Sever',
        address: 'Vysokoškolská 4, 040 01 Košice',
        phone: '+421 905 515 893',
        email: 'dranam@dranam.sk',
        website: 'http://www.dranam.sk/',
        facebook: 'https://www.facebook.com/TKDRANaM',
        instagram: 'tkdranam',
        facilities: ['COACHING'],
        description: 'Tenisový klub DRANaM Košice: skupinové, súkromné aj individuálne tréningy pre deti a dospelých. Areál na Vysokoškolskej 4.',
        lat: 48.7342664,
        lng: 21.2449475,
      },
    },
  ],
};

function addCityVenues() {
  Object.entries(CITY_VENUES).forEach(([citySlug, list]) => {
    const city = db.prepare('SELECT id FROM leagues WHERE slug = ?').get(citySlug);
    if (!city) return; // the city is not there (yet): tried again at the next start
    const compact = (text) => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    list.forEach(({ flag, name, details }) => {
      if (db.prepare('SELECT 1 FROM app_flags WHERE key = ?').get(flag)) return;
      const parsed = venues.parseDetails(details);
      if (parsed.error) {
        console.warn(`[venue seed] skipped "${name}": ${parsed.error}`);
        return;
      }
      const there = db.prepare('SELECT name FROM venues WHERE league_id = ?').all(city.id).some((v) => compact(v.name) === compact(name));
      if (!there) {
        const columns = { name, slug: venues.uniqueSlug(name), league_id: city.id, ...parsed.columns, seeded_at: new Date().toISOString() };
        const names = Object.keys(columns);
        db.prepare(`INSERT INTO venues (${names.join(', ')}) VALUES (${names.map((n) => `@${n}`).join(', ')})`).run(columns);
      }
      db.prepare('INSERT INTO app_flags (key) VALUES (?)').run(flag);
    });
  });
}

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
// The photo shown above a venue's name on the /courts cards (venues.image_url): files under public/img/courts/, each taken from the
// venue's own website. Set once per venue (flag venue_image:<name>), so a photo an admin changes or clears later is never put back.
const VENUE_IMAGES = {
  'Fit Camp': '/img/courts/fit-camp.jpg',
  'NTC Bratislava': '/img/courts/ntc-bratislava.jpg',
  'Tennis ONE': '/img/courts/tennis-one.jpg',
  'TK Slovan Bratislava': '/img/courts/tk-slovan-bratislava.jpg',
  'TKP Dudova': '/img/courts/tkp-dudova.jpg',
  'TKP Dunajská Lužná': '/img/courts/tkp-dunajska-luzna.jpg',
  'TKP Nobelovo Námestie': '/img/courts/tkp-nobelovo-namestie.jpg',
  'Slávia Filozof': '/img/courts/slavia-filozof.jpg',
  'TK Slávia STU': '/img/courts/tk-slavia-stu.jpg',
  'Matchball': '/img/courts/matchball.jpg',
  'Love4Tennis': '/img/courts/love4tennis.jpg',
  'Tenis Club 26': '/img/courts/tenis-club-26.jpg',
  'TK Dúbravka - Lysákova': '/img/courts/tk-dubravka-lysakova.jpg',
  'Leon - Zlaté Piesky': '/img/courts/leon-zlate-piesky.jpg',
  'Inter Bratislava': '/img/courts/inter-bratislava.jpg',
  'Éči - Zlaté Piesky': '/img/courts/eci-zlate-piesky.jpg',
  'Kurty Patrónka': '/img/courts/kurty-patronka.jpg',
  'TK Trnávka': '/img/courts/tk-trnavka.jpg',
  'Top Tenis - Budatínska': '/img/courts/top-tenis-budatinska.jpg',
};

function seedVenueImages() {
  Object.entries(VENUE_IMAGES).forEach(([name, imageUrl]) => {
    const flag = `venue_image:${name}`;
    if (db.prepare('SELECT 1 FROM app_flags WHERE key = ?').get(flag)) return;
    // The venue is found by its name or by the slug the file is named after (the venue may have been renamed a little). A venue that
    // is not there yet is tried again at the next start; one that has a photo already is left alone.
    const slug = path.basename(imageUrl, path.extname(imageUrl));
    const found = db.prepare('SELECT id, image_url FROM venues WHERE name = ? COLLATE NOCASE OR slug = ?').get(name, slug);
    if (!found) return;
    if (!found.image_url) db.prepare('UPDATE venues SET image_url = ? WHERE id = ?').run(imageUrl, found.id);
    db.prepare('INSERT INTO app_flags (key) VALUES (?)').run(flag);
  });
}

// Venues that were created twice by mistake: the duplicate is removed once (flag venue_removed:<name>), so one an admin adds again later is
// left alone. The places of matches are free text and stay as they are (see EXTRA_ALIASES in venues.js for the matches of the removed one).
const DUPLICATE_VENUES = ['TK Alžbetin Dvor'];

function removeDuplicateVenues() {
  DUPLICATE_VENUES.forEach((name) => {
    const flag = `venue_removed:${name}`;
    if (db.prepare('SELECT 1 FROM app_flags WHERE key = ?').get(flag)) return;
    db.prepare('DELETE FROM venues WHERE name = ? COLLATE NOCASE').run(name);
    db.prepare('INSERT INTO app_flags (key) VALUES (?)').run(flag);
  });
}

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
  addNewVenues();
  addCityVenues();
  seedVenueImages();
  removeDuplicateVenues();
  seedCourtsMenuItem();
}

module.exports = { run };
