// Final group tables of the finished seasons, copied from blta.sk on 2026-10-04 (the official numbers).
// For these seasons the app shows exactly these tables; only the current season and the ones after it are
// calculated from the matches (see standings.js). Row format: player name, points, matches, wins, losses,
// set difference, position.

const RAW = {
  'blta-nulty-rocnik-2025': {
    Novak: 'Michal Bori,21,7,7,0,14,1;Tomáš Podhorný,18,7,6,1,10,2;Peter Laučík,15,7,5,2,6,3;Tomasz Szopinski,11,7,4,3,1,4;Ľubomír Šimkovič,7,7,2,5,-5,5;Lubo Šimuna,6,7,2,5,-6,6;Ladislav Nagy,5,7,2,5,-7,7;Lukáš Hnilica,1,7,0,7,-13,8',
    Roger: 'Pavol Piroha,18,7,7,0,11,1;Tomáš Elexhauser,16,7,5,2,7,2;Braňo Ivan,15,7,5,2,6,3;Matej Varga,11,7,3,4,0,4;Michael Dojčan,10,7,4,3,0,5;Michal Marhevka,6,7,2,5,-6,6;Yurii Yumashev,4,7,1,6,-9,7;Radko Cíger,1,7,1,6,-9,8',
    Rafa: 'Róbert Sloboda,21,7,7,0,14,1;Branislav Bložon,16,7,5,2,7,2;Jakub Paločný,14,7,5,2,5,3;Milan Špak,14,7,5,2,5,3;Tomáš Paulen,8,7,3,4,-3,5;Dávid Hudák,7,7,2,5,-4,6;Adam Voltemar,3,7,1,6,-10,7;Peter Schmidt,0,7,0,7,-14,8',
  },
  'winter-opening-series-2026': {
    'The Demon': 'Pavol Blahut,17,6,6,0,11,1;Pavol Piroha,14,6,4,2,6,2;Michal Bori,11,6,4,2,3,3;Jakub Paločný,10,6,4,2,2,4;Matej Varga,7,6,2,4,-3,5;Augusta Tobiášová,3,6,1,5,-8,6;Peter Laučík,1,6,0,6,-11,7',
    'Rocket Man': 'Braňo Ivan,18,6,6,0,11,1;Peter Pálenek,11,6,4,2,3,2;Tomáš Podhorný,11,6,4,2,3,2;Jan Szalay,8,6,3,3,-1,4;Dávid Hudák,8,6,2,4,-1,5;Christoph Andermann,7,6,2,4,-3,6;Vlado Rybár,0,6,0,6,-12,7',
    'El Matador': 'Róbert Sloboda,17,6,6,0,12,1;Tomáš Elexhauser,12,6,4,2,4,2;Branislav Bložon,12,6,4,2,3,3;Peter Hladký,9,6,3,3,0,4;Tomáš Paulen,9,6,3,3,0,4;Marek Norovský,4,6,1,5,-7,6;Michal Lipták,0,6,0,6,-12,7',
    Mosquito: 'Artur Hlukhota,13,6,5,1,6,1;Peter Bicko,13,6,5,1,6,1;Filip Ujfalusi,11,6,3,3,2,3;Stefan Dobrev,10,6,4,2,2,4;Andrej Vážan,10,6,3,3,1,5;Martin Saksa,4,6,1,5,-7,6;Michal Marhevka,2,6,0,6,-10,7',
    'The Magician': 'Yurii Yumashev,16,6,6,0,10,1;Volodymyr Sadykov,14,6,5,1,7,2;Tomasz Szopinski,12,6,4,2,4,3;Marek Patúc,10,6,3,3,1,4;Ľubomír Šimkovič,6,6,2,4,-4,5;Peter Valach,5,6,1,5,-6,6;Gabriel Koscelanský,0,6,0,6,-12,7',
    'El Chino': 'Radko Cíger,17,7,6,1,9,1;Juraj Urblík,15,7,5,2,6,2;Ján Beňo,15,7,5,2,6,2;Peter Schmidt,14,7,5,2,5,4;Ladislav Nagy,8,7,3,4,-3,5;Alan Almaksus,6,7,2,5,-6,6;Dmytro Novitskyi,5,7,1,6,-8,7;Lukáš Hnilica,4,7,1,6,-9,8',
  },
  'summer-rally-series-2026': {
    Carlitos: 'Tomáš Podhorný,16,6,6,0,10,1;Michael Dojčan,15,6,4,2,4,2;Peter Bicko,9,6,3,3,0,3;Augusta Tobiášová,7,6,3,3,-2,4;Yurii Yumashev,7,6,2,4,-3,5;Michal Bori,6,6,2,4,-4,6;Tomáš Krjak,6,6,1,5,-5,7',
    DelPO: 'Róbert Sloboda,18,6,5,1,12,1;Peter Hladký,15,6,6,0,12,2;Dávid Hudák,11,6,4,2,2,3;Viliam Alaksa,10,6,3,3,-2,4;Tomáš Elexhauser,6,6,2,4,-4,5;Peter Laučík,2,6,1,5,-9,6;Volodymyr Sadykov,1,6,0,6,-11,7',
    Djoker: 'Braňo Ivan,16,6,5,1,9,1;Lubo Šimuna,14,6,5,1,7,2;Oleksii Polikarenko,10,6,3,3,1,3;Lukáš Hanus,9,6,3,3,0,4;Jan Szalay,7,6,3,3,-2,5;Jakub Paločný,4,6,1,5,-7,6;Artur Hlukhota,3,6,1,5,-8,7',
    FedEX: 'Pavol Piroha,14,6,6,0,8,1;Pavol Blahut,11,6,4,2,5,2;Matej Varga,11,6,4,2,3,3;Peter Pálenek,10,6,4,2,1,4;Vlado Rybár,8,6,2,4,-2,5;Branislav Bložon,7,6,2,4,-3,6;Tomáš Paulen,2,6,0,6,-12,7',
    Dominator: 'David Stanek,14,6,5,1,7,1;Kamila Mirzaalimova,14,6,5,1,7,1;Guillaume Raoux,12,6,4,2,4,3;Stefan Dobrev,10,6,3,3,1,4;Tomasz Szopinski,10,6,3,3,1,4;Tomáš Demovič,3,6,1,5,-8,6;Martin Saksa,0,6,0,6,-12,7',
    Guga: 'Marek Šarudy,18,6,6,0,12,1;Vladimír Ježek,14,6,5,1,7,2;Andrej Pačuta,9,6,4,2,1,3;Filip Ujfalusi,9,6,3,3,1,4;Juraj Urblík,7,6,2,4,-3,5;Andrey Stolyarchuk,5,6,1,5,-6,6;Miroslav Špaček,0,6,0,6,-12,7',
    'The Fox': 'Peter Valach,13,6,5,1,7,1;Ján Beňo,12,6,4,2,4,2;Radko Cíger,12,6,4,2,4,2;Bruno Pavličko,11,6,3,3,2,4;Ľubomír Šimkovič,10,6,4,2,2,5;Gabriel Koscelanský,4,6,1,5,-7,6;Kim Wangs,0,6,0,6,-12,7',
    'Stan The Man': 'Alan Almaksus,19,7,6,1,11,1;Tomáš Skukalík,16,7,6,1,8,2;Peter Schmidt,12,7,4,3,2,3;Patrik Matula,11,7,4,3,1,4;Tomáš Hadari,11,7,4,3,1,4;Lukáš Hnilica,10,7,3,4,-1,6;Max BA,3,7,0,7,-11,7;Lukáš Obselka,2,7,1,6,-11,8',
  },
};

// slug -> group name (lower case) -> rows [{ name, points, played, wins, losses, setDiff, position }]
const FROZEN = {};
for (const [slug, groups] of Object.entries(RAW)) {
  FROZEN[slug] = {};
  for (const [name, text] of Object.entries(groups)) {
    FROZEN[slug][name.toLowerCase()] = text.split(';').map((row) => {
      const [player, points, played, wins, losses, setDiff, position] = row.split(',');
      return { name: player, points: +points, played: +played, wins: +wins, losses: +losses, setDiff: +setDiff, position: +position };
    });
  }
}

module.exports = { FROZEN };
