// League seasons and their groups, read from blta.sk (the project pages under /project/…) on 2026-10-04.
// Used once by seasonSeed.js to create the seasons/groups and to tag existing BLTA matches; after that
// admins manage seasons and groups in /seasons-admin and this file is never read again.
//
// `from` / `to` are the date window used to decide which season an existing match belongs to.
// `anyCategory` is for the first season, whose three groups mixed all skill levels.
// `players` is only used for the one-off tagging of old matches (two players in the same group of a season
// => that match was a group match); it is not stored.

const SEASONS = [
  {
    name: 'BLTA Nultý Ročník',
    slug: 'blta-nulty-rocnik-2025',
    from: '2025-01-01',
    to: '2025-12-31',
    anyCategory: true,
    groups: [
      { name: 'Novak', category: 'ELITE', players: ['Michal Bori', 'Tomáš Podhorný', 'Peter Laučík', 'Tomasz Szopinski', 'Ľubomír Šimkovič', 'Lubo Šimuna', 'Ladislav Nagy', 'Lukáš Hnilica'] },
      { name: 'Roger', category: 'ELITE', players: ['Pavol Piroha', 'Tomáš Elexhauser', 'Braňo Ivan', 'Matej Varga', 'Michael Dojčan', 'Michal Marhevka', 'Yurii Yumashev', 'Radko Cíger'] },
      { name: 'Rafa', category: 'ELITE', players: ['Róbert Sloboda', 'Branislav Bložon', 'Jakub Paločný', 'Milan Špak', 'Tomáš Paulen', 'Dávid Hudák', 'Adam Voltemar', 'Peter Schmidt'] },
    ],
  },
  {
    name: 'Winter Opening Series 2026',
    slug: 'winter-opening-series-2026',
    from: '2026-01-01',
    to: '2026-04-30',
    groups: [
      { name: 'The Demon', category: 'ELITE', players: ['Pavol Blahut', 'Pavol Piroha', 'Michal Bori', 'Jakub Paločný', 'Matej Varga', 'Augusta Tobiášová', 'Peter Laučík'] },
      { name: 'Rocket Man', category: 'ELITE', players: ['Braňo Ivan', 'Peter Pálenek', 'Tomáš Podhorný', 'Jan Szalay', 'Dávid Hudák', 'Christoph Andermann', 'Vlado Rybár'] },
      { name: 'El Matador', category: 'ELITE', players: ['Róbert Sloboda', 'Tomáš Elexhauser', 'Branislav Bložon', 'Peter Hladký', 'Tomáš Paulen', 'Marek Norovský', 'Michal Lipták'] },
      { name: 'Mosquito', category: 'NEXT_GEN', players: ['Artur Hlukhota', 'Peter Bicko', 'Filip Ujfalusi', 'Stefan Dobrev', 'Andrej Vážan', 'Martin Saksa', 'Michal Marhevka'] },
      { name: 'The Magician', category: 'NEXT_GEN', players: ['Yurii Yumashev', 'Volodymyr Sadykov', 'Tomasz Szopinski', 'Marek Patúc', 'Ľubomír Šimkovič', 'Peter Valach', 'Gabriel Koscelanský'] },
      { name: 'El Chino', category: 'NOVICE', players: ['Radko Cíger', 'Juraj Urblík', 'Ján Beňo', 'Peter Schmidt', 'Ladislav Nagy', 'Alan Almaksus', 'Dmytro Novitskyi', 'Lukáš Hnilica'] },
    ],
  },
  {
    name: 'Summer Rally Series 2026',
    slug: 'summer-rally-series-2026',
    from: '2026-05-01',
    to: '2026-08-31',
    groups: [
      { name: 'Carlitos', category: 'ELITE', players: ['Tomáš Podhorný', 'Michael Dojčan', 'Peter Bicko', 'Augusta Tobiášová', 'Yurii Yumashev', 'Michal Bori', 'Tomáš Krjak'] },
      { name: 'DelPO', category: 'ELITE', players: ['Róbert Sloboda', 'Peter Hladký', 'Dávid Hudák', 'Viliam Alaksa', 'Tomáš Elexhauser', 'Peter Laučík', 'Volodymyr Sadykov'] },
      { name: 'Djoker', category: 'ELITE', players: ['Braňo Ivan', 'Lubo Šimuna', 'Oleksii Polikarenko', 'Lukáš Hanus', 'Jan Szalay', 'Jakub Paločný', 'Artur Hlukhota'] },
      { name: 'FedEX', category: 'ELITE', players: ['Pavol Piroha', 'Pavol Blahut', 'Matej Varga', 'Peter Pálenek', 'Vlado Rybár', 'Branislav Bložon', 'Tomáš Paulen'] },
      { name: 'Dominator', category: 'NEXT_GEN', players: ['David Stanek', 'Kamila Mirzaalimova', 'Guillaume Raoux', 'Stefan Dobrev', 'Tomasz Szopinski', 'Tomáš Demovič', 'Martin Saksa'] },
      { name: 'Guga', category: 'NEXT_GEN', players: ['Marek Šarudy', 'Vladimír Ježek', 'Andrej Pačuta', 'Filip Ujfalusi', 'Juraj Urblík', 'Andrey Stolyarchuk', 'Miroslav Špaček'] },
      { name: 'The Fox', category: 'NEXT_GEN', players: ['Peter Valach', 'Ján Beňo', 'Radko Cíger', 'Bruno Pavličko', 'Ľubomír Šimkovič', 'Gabriel Koscelanský', 'Kim Wangs'] },
      { name: 'Stan The Man', category: 'NOVICE', players: ['Alan Almaksus', 'Tomáš Skukalík', 'Peter Schmidt', 'Patrik Matula', 'Tomáš Hadari', 'Lukáš Hnilica', 'Max BA', 'Lukáš Obselka'] },
    ],
  },
  {
    name: 'Autumn Finals Series 2026',
    slug: 'autumn-finals-series-2026',
    from: '2026-09-01',
    to: '2026-12-31',
    groups: [
      { name: 'Babolat', category: 'ELITE', players: ['Branislav Bložon', 'Jan Szalay', 'Michal Bori', 'Peter Bicko', 'Volodymyr Sadykov', 'Pavel Mariani'] },
      { name: 'Dunlop', category: 'ELITE', players: ['Viliam Alaksa', 'Vlado Rybár', 'Tomáš Paulen', 'Michal Lipták', 'Marek Šarudy', 'Pavol Piroha', 'Tomáš Elexhauser'] },
      { name: 'Head', category: 'ELITE', players: ['Peter Hladký', 'Dávid Hudák', 'Tomáš Podhorný', 'Matej Szalay', 'Matej Varga', 'Peter Pálenek', 'David Stanek'] },
      { name: 'Wilson', category: 'ELITE', players: ['Róbert Sloboda', 'Martin Bielik', 'Yurii Yumashev', 'Peter Laučík', 'Artur Hlukhota', 'Jakub Paločný', 'Augusta Tobiášová'] },
      { name: 'Yonex', category: 'ELITE', players: ['Pavol Blahut', 'Lukáš Hanus', 'Stanislav Mihalovič', 'Braňo Ivan', 'Ján Szalai', 'Tomáš Krjak', 'Michael Dojčan'] },
      { name: 'Asics', category: 'NEXT_GEN', players: ['Juraj Urblík', 'Anna Goruskova', 'Ján Beňo', 'Jakub Matula', 'Andrey Stolyarchuk', 'Andrej Pačuta', 'Jozef Lukča'] },
      { name: 'Prince', category: 'NEXT_GEN', players: ['Ľubomír Šimkovič', 'Lukáš Böhm', 'Tomáš Skukalík', 'Filip Ujfalusi', 'Tomáš Demovič', 'Alan Almaksus', 'Samuel Michalek'] },
      { name: 'Slazenger', category: 'NEXT_GEN', players: ['Vladimír Ježek', 'Gabriel Koscelanský', 'Tomasz Szopinski', 'Bruno Pavličko', 'Miroslav Špaček', 'Martin Hronček', 'Peter Valach'] },
      { name: 'Technifibre', category: 'NEXT_GEN', players: ['Herman Prihunov', 'Radovan Šoltés', 'Stefan Dobrev', 'Radko Cíger', 'Guillaume Raoux', 'Tomáš Slávik', "Jerry O'Neil"] },
      { name: 'Solinco', category: 'NOVICE', players: ['Tomáš Hadari', 'Peter Schmidt', 'Martin Szalay', 'Aleksandr Piliptsevich', 'Ivan Belei', 'Lukáš Obselka', 'Stano Kemen'] },
      { name: 'Volkl', category: 'NOVICE', players: ['Peter Bilkovič', 'Lukáš Hnilica', 'Tomáš Kováčik', 'Max BA', 'Vadim Zenkevich', 'Marek Drašar', 'Patrik Matula'] },
    ],
  },
  {
    name: 'Winter Opening Series 2027',
    slug: 'winter-opening-series-2027',
    from: '2027-01-01',
    to: '2027-04-30',
    groups: [],
  },
];

module.exports = { SEASONS };
