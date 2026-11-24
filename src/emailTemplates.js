// The plain-text e-mails the site sends (everything except the welcome e-mail, which has its own look: src/welcomeEmail.js). Each one is a TEMPLATE: a subject and a body with {variables}.
// The built-in text below is what has always been sent; Backend > E-mails (super admin) edits it, and the edited texts are kept as JSON in site_settings under 'emailTemplates'
// ({ <key>: { subject, body } }). What is not saved (or saved empty) is the built-in text.
//
// Writing a text:
//  - {name} is replaced by the value (the list of the variables of each e-mail is shown next to its text);
//  - a line whose {variables} are ALL empty is left out (so "Telefón: {phone}" disappears when there is no phone);
//  - a line that starts with {?variable} is kept only when that variable has a value, a line that starts with {!variable} only when it has none (the marker itself is removed);
//  - several empty lines in a row become one.
const db = require('./db');

const KEY = 'emailTemplates';
const LIMITS = { subject: 200, body: 4000 };

const v = (name, desc, sample) => ({ name, desc, sample });

// the variables the player-facing and admin texts share
const WHEN_VARS = [
  v('court', 'the name of the court', 'Kurt 1'),
  v('whenShort', 'day and time, short (streda 14.10.2026 18:00–19:00)', 'streda 14.10.2026 18:00–19:00'),
];

const TEMPLATES = [
  // ------------------------------------------------------------------ players: matches
  {
    key: 'matchStarted', group: 'Match notifications', audience: 'A player or a visitor who asked to be told',
    title: 'Match started', when: 'A match starts (to everyone who tapped "Notify me: Start" for it).',
    vars: [v('player1', 'first player', 'Peter Novák'), v('player2', 'second player', 'Jozef Kováč'), v('category', 'category', 'ELITE'), v('location', 'place (empty = no line)', 'Kurt 1'), v('link', 'link to the match', 'https://score.blta.sk/match/abc')],
    subject: 'Zápas začal: {player1} vs {player2}',
    body: ['{player1} vs {player2} práve začal!', 'Kategória: {category}', 'Miesto: {location}', 'Sledovať naživo: {link}'].join('\n'),
  },
  {
    key: 'matchFinishedSubscriber', group: 'Match notifications', audience: 'A player or a visitor who asked to be told',
    title: 'Match finished', when: 'A match ends (to everyone who tapped "Notify me: Finish" for it).',
    vars: [v('player1', 'first player', 'Peter Novák'), v('player2', 'second player', 'Jozef Kováč'), v('result', 'score, reason of the end and the winner', '6-3, 6-4 — víťaz Peter Novák'), v('date', 'date and time of the match', '14. 10. 2026, 18:00:00'), v('location', 'place (empty = no line)', 'Kurt 1'), v('link', 'link to the match', 'https://score.blta.sk/match/abc')],
    subject: 'Zápas skončil: {player1} vs {player2}',
    body: ['{player1} vs {player2}', 'Výsledok: {result}', 'Dátum: {date}', 'Miesto: {location}', 'Odkaz: {link}'].join('\n'),
  },
  {
    key: 'proposalReceived', group: 'Match notifications', audience: 'The other player',
    title: 'Times proposed for a match', when: 'Somebody proposes (or counter-proposes) times for a match.',
    vars: [v('proposer', 'who proposed', 'Peter Novák'), v('link', 'link to the match', 'https://score.blta.sk/match/abc')],
    subject: '{proposer} ti navrhol termíny na hru!',
    body: ['{proposer} ti navrhol termíny na váš zápas na BLTA.', 'Vyber si ten, ktorý ti vyhovuje, tu: {link}'].join('\n'),
  },
  {
    key: 'proposalConfirmed', group: 'Match notifications', audience: 'Whoever left an e-mail when proposing',
    title: 'Time confirmed', when: 'The other player has picked a time and a place from the proposal.',
    vars: [v('player1', 'first player', 'Peter Novák'), v('player2', 'second player', 'Jozef Kováč'), v('date', 'the chosen time', '14. 10. 2026, 18:00:00'), v('location', 'the chosen place', 'Kurt 1'), v('link', 'link to the match', 'https://score.blta.sk/match/abc')],
    subject: 'Termín potvrdený: {player1} vs {player2}',
    body: ['Pre zápas, ktorý si navrhol, bol vybraný termín: {player1} vs {player2}.', 'Kedy: {date}', 'Kde: {location}', 'Odkaz: {link}'].join('\n'),
  },
  // ------------------------------------------------------------------ players: looking for a game
  {
    key: 'playRequest', group: 'Looking for an opponent', audience: 'The owner of the post',
    title: 'Somebody wants to play (singles)', when: 'A player picks a free time of a "Chcem hrať" post.',
    vars: [v('joiner', 'who wants to play', 'Jozef Kováč'), v('date', 'the picked time', '14. 10. 2026, 18:00:00'), v('message', 'his message (empty = no line)', 'Dám ti pokoj :)'), v('link', 'link to the board', 'https://score.blta.sk/hladam-supera')],
    subject: '{joiner} chce s tebou hrať!',
    body: ['{joiner} videl tvoj príspevok „Chcem hrať“ na BLTA a vybral si jeden z tvojich voľných termínov na priateľský zápas:', 'Kedy: {date}', 'Jeho odkaz: "{message}"', 'Pozri si to tu: {link}'].join('\n'),
  },
  {
    key: 'playRequestDoubles', group: 'Looking for an opponent', audience: 'The owner of the post',
    title: 'Somebody wants to play (doubles partner)', when: 'A player offers to be the partner on a "Hľadám partnera" post.',
    vars: [v('joiner', 'who offers', 'Jozef Kováč'), v('date', 'the picked time', '14. 10. 2026, 18:00:00'), v('message', 'his message (empty = no line)', ''), v('link', 'link to the board', 'https://score.blta.sk/hladam-supera')],
    subject: '{joiner} by s tebou hral štvorhru!',
    body: ['{joiner} videl tvoj príspevok „Hľadám partnera“ na BLTA a vybral si jeden z tvojich voľných termínov — chce s tebou hrať štvorhru ako tvoj partner:', 'Kedy: {date}', 'Jeho odkaz: "{message}"', 'Pozri si to tu: {link}'].join('\n'),
  },
  {
    key: 'playRequestAccepted', group: 'Looking for an opponent', audience: 'The player who asked',
    title: 'Time accepted', when: 'The owner of the post accepts the time (a friendly match is created).',
    vars: [v('owner', 'the owner of the post', 'Peter Novák'), v('date', 'the time', '14. 10. 2026, 18:00:00'), v('link', 'link to the match', 'https://score.blta.sk/match/abc')],
    subject: '{owner} prijal tvoj termín na hru!',
    body: ['{owner} prijal termín, ktorý si si vybral na BLTA — máte dohodnutý priateľský zápas.', 'Kedy: {date}', 'Zápas: {link}'].join('\n'),
  },
  {
    key: 'partnerAccepted', group: 'Looking for an opponent', audience: 'The player who offered to be a partner',
    title: 'Accepted as a doubles partner', when: 'The owner of a doubles post accepts the offer.',
    vars: [v('owner', 'the owner of the post', 'Peter Novák'), v('date', 'the time', '14. 10. 2026, 18:00:00')],
    subject: '{owner} ťa prijal ako partnera na štvorhru!',
    body: ['{owner} prijal tvoju ponuku na BLTA — ste partneri na štvorhru.', 'Kedy: {date}', 'Zápas štvorhry vytvorí on; keď bude vytvorený, uvidíš ho v zozname svojich zápasov.'].join('\n'),
  },
  {
    key: 'playRequestDenied', group: 'Looking for an opponent', audience: 'The player who asked',
    title: 'Time declined', when: 'The owner of the post declines the picked time (always with a reason).',
    vars: [v('owner', 'the owner of the post', 'Peter Novák'), v('reason', 'his note', 'V ten deň nestíham'), v('link', 'link to the board', 'https://score.blta.sk/hladam-supera')],
    subject: '{owner} ti v tomto termíne nemôže vyhovieť',
    body: ['{owner} nemohol prijať termín, ktorý si si vybral na BLTA.', 'Jeho poznámka: "{reason}"', 'Pozri si jeho ďalšie voľné termíny: {link}'].join('\n'),
  },
  // ------------------------------------------------------------------ players: account
  {
    key: 'pinReset', group: 'Account', audience: 'The player',
    title: 'Reset of the login code', when: 'A player asks for a new login code ("Forgot my code"). Keep the {link}: it is the only way to set the new code.',
    vars: [v('name', 'player name', 'Peter Novák'), v('link', 'the one-time link (valid 1 hour)', 'https://score.blta.sk/reset-code?token=abc')],
    subject: 'Obnovenie prihlasovacieho kódu pre BLTA',
    body: ['Ahoj {name},', '', 'Niekto (dúfajme, že ty) požiadal o obnovenie tvojho prihlasovacieho kódu pre BLTA.', 'Nastav si nový tu: {link}', '', 'Tento odkaz platí 1 hodinu. Ak si o to nežiadal, tento e-mail jednoducho ignoruj.'].join('\n'),
  },
  // ------------------------------------------------------------------ court reservations
  {
    key: 'courtReservationPlayer', group: 'Court reservations', audience: 'The player',
    title: 'Reservation confirmed', when: 'A player reserves a court (only when the player has an e-mail).',
    vars: [v('first', 'first name (empty = "Ahoj,")', 'Mária'), ...WHEN_VARS, v('courtNote', 'the note of the court in brackets, or nothing', ' (antuka, Nobelova 34)'), v('when', 'day and time (streda 14.10.2026, 18:00–19:00)', 'streda 14.10.2026, 18:00–19:00'), v('price', 'price (empty = no line)', '27 €'), v('cancelNote', 'how late the reservation can be cancelled', 'Rezerváciu môžeš zrušiť najneskôr 2 hodiny pred začiatkom.'), v('link', 'link to My reservations', 'https://score.blta.sk/rezervacie-kurtov')],
    subject: 'Rezervácia kurtu potvrdená: {court}, {whenShort}',
    body: ['{?first}Ahoj {first},', '{!first}Ahoj,', '', 'tvoja rezervácia kurtu je potvrdená.', '', 'Kurt: {court}{courtNote}', 'Kedy: {when}', 'Cena: {price}', '', '{cancelNote} Nájdeš ju v sekcii Moje rezervácie: {link}', '', 'Tešíme sa na teba na kurte!', 'BLTA – Bratislavská Liga Tenisových Amatérov'].join('\n'),
  },
  {
    key: 'courtReservationAdmin', group: 'Court reservations', audience: 'The admin',
    title: 'Reservation made (to the admin)', when: 'A player reserves a court.',
    vars: [v('player', 'player name', 'Mária Mailová'), v('phone', 'phone', '+421900111222'), v('email', 'e-mail', 'maria@example.com'), ...WHEN_VARS, v('when', 'day and time', 'streda 14.10.2026, 18:00–19:00'), v('price', 'price (empty = no line)', '27 €'), v('link', 'link to the calendar', 'https://score.blta.sk/rezervacie-kurtov')],
    subject: 'Nová rezervácia kurtu: {player} – {court}, {whenShort}',
    body: ['Hráč si práve rezervoval kurt:', '', 'Hráč: {player}', 'Telefón: {phone}', 'E-mail: {email}', 'Kurt: {court}', 'Kedy: {when}', 'Cena: {price}', '', 'Kalendár rezervácií: {link}'].join('\n'),
  },
  {
    key: 'courtCancelledPlayer', group: 'Court reservations', audience: 'The player',
    title: 'Reservation cancelled by the player (to the player)', when: 'A player cancels their reservation.',
    vars: [v('first', 'first name (empty = "Ahoj,")', 'Mária'), ...WHEN_VARS, v('short', 'court, day and time', 'Kurt 1, streda 14.10.2026 18:00–19:00'), v('when', 'day and time', 'streda 14.10.2026, 18:00–19:00'), v('link', 'link to the reservations', 'https://score.blta.sk/rezervacie-kurtov')],
    subject: 'Rezervácia kurtu zrušená: {short}',
    body: ['{?first}Ahoj {first},', '{!first}Ahoj,', '', 'tvoja rezervácia kurtu je zrušená.', '', 'Kurt: {court}', 'Kedy: {when}', '', 'Nový termín si môžeš rezervovať tu: {link}', '', 'BLTA – Bratislavská Liga Tenisových Amatérov'].join('\n'),
  },
  {
    key: 'courtCancelledByAdmin', group: 'Court reservations', audience: 'The player',
    title: 'Reservation cancelled by the admin (to the player)', when: 'An admin cancels the reservation of a player.',
    vars: [v('first', 'first name (empty = "Ahoj,")', 'Mária'), ...WHEN_VARS, v('short', 'court, day and time', 'Kurt 1, streda 14.10.2026 18:00–19:00'), v('when', 'day and time', 'streda 14.10.2026, 18:00–19:00'), v('link', 'link to the reservations', 'https://score.blta.sk/rezervacie-kurtov')],
    subject: 'Rezervácia kurtu zrušená: {short}',
    body: ['{?first}Ahoj {first},', '{!first}Ahoj,', '', 'tvoju rezerváciu kurtu zrušil administrátor BLTA.', '', 'Kurt: {court}', 'Kedy: {when}', '', 'Ak ide o omyl alebo sa chceš dohodnúť na inom termíne, napíš nám. Nový termín si môžeš rezervovať tu: {link}', '', 'BLTA – Bratislavská Liga Tenisových Amatérov'].join('\n'),
  },
  {
    key: 'courtCancelledAdmin', group: 'Court reservations', audience: 'The admin',
    title: 'Reservation cancelled by the player (to the admin)', when: 'A player cancels their reservation.',
    vars: [v('player', 'player name', 'Mária Mailová'), v('phone', 'phone', '+421900111222'), v('email', 'e-mail', 'maria@example.com'), v('short', 'court, day and time', 'Kurt 1, streda 14.10.2026 18:00–19:00'), ...WHEN_VARS, v('when', 'day and time', 'streda 14.10.2026, 18:00–19:00'), v('price', 'price (empty = no line)', '27 €'), v('link', 'link to the calendar', 'https://score.blta.sk/rezervacie-kurtov')],
    subject: 'Zrušená rezervácia kurtu: {player} – {short}',
    body: ['Hráč zrušil svoju rezerváciu kurtu:', '', 'Hráč: {player}', 'Telefón: {phone}', 'E-mail: {email}', 'Kurt: {court}', 'Kedy: {when}', 'Cena: {price}', '', 'Termín je opäť voľný a dá sa znova rezervovať.', 'Kalendár rezervácií: {link}'].join('\n'),
  },
  // ------------------------------------------------------------------ tournaments and series
  {
    key: 'paymentReminder', group: 'Tournaments and series', audience: 'The registered player',
    title: 'Reminder: entry fee not paid', when: 'The organiser presses "Remind unpaid" in Backend.',
    vars: [v('name', 'player name', 'Peter Novák'), v('season', 'tournament / series', 'Summer Open 2027'), v('feeNote', 'the fee in brackets, or nothing', '(15 €) '), v('paymentUrl', 'the online payment link (empty = pay with the organiser)', 'https://score.blta.sk/platba/1'), v('organiser', 'how to reach the organiser (empty = no line)', 'robert@blta.sk')],
    subject: 'Pripomienka platby štartovného: {season}',
    body: ['Dobrý deň {name},', '', 'evidujeme vašu registráciu do "{season}", ale štartovné {feeNote}zatiaľ nemáme zaplatené.', '', '{?paymentUrl}Zaplatiť môžete online tu: {paymentUrl}', '{!paymentUrl}Platbu prosím dohodnite s organizátorom.', '', 'Ak ste už zaplatili, tento e-mail prosím ignorujte (platbu ešte nemusíme mať zaznamenanú).', '', '{?organiser}Otázky? {organiser}'].join('\n'),
  },
  {
    key: 'substituteIn', group: 'Tournaments and series', audience: 'The substitute',
    title: 'Substitute is in', when: 'A place got free (or the maximum was raised) and a substitute joins the tournament.',
    vars: [v('name', 'player name', 'Peter Novák'), v('season', 'tournament', 'Summer Open 2027'), v('pageUrl', 'link to the tournament page (empty = no line)', 'https://score.blta.sk/turnaje/summer-open'), v('organiser', 'how to reach the organiser (empty = no line)', 'robert@blta.sk')],
    subject: 'Ste v turnaji: {season}',
    body: ['Dobrý deň {name},', '', 'dobrá správa: uvoľnilo sa miesto a ste teraz v zozname hráčov "{season}" (už nie ste náhradník).', '', '{?pageUrl}Stránka: {pageUrl}', '', '{?organiser}Otázky? {organiser}'].join('\n'),
  },
  {
    key: 'seasonRegistration', group: 'Tournaments and series', audience: 'The admin',
    title: 'Registration for a season or tournament', when: 'A player registers through the form of a season / tournament page.',
    vars: [v('kindIn', '"na turnaj" or "do série"', 'na turnaj'), v('kindWhere', '"v turnaji" or "v sérii"', 'v turnaji'), v('season', 'name of the season / tournament', 'Summer Open 2027'), v('name', 'player name', 'Peter Novák'), v('account', 'what happened with his account, in brackets (or nothing)', ' (nový hráč — v appke sme mu vytvorili účet)'), v('category', 'category ("zaradí admin" when not chosen)', 'ELITE'), v('categoryTag', 'the category in brackets for the subject (or nothing)', ' (ELITE)'), v('substituteTag', '" (náhradník)" or nothing', ''), v('phone', 'phone', '0903111222'), v('email', 'e-mail', 'peter@example.com'), v('note', 'his note (empty = no line)', ''), v('substituteWarning', 'the warning for a substitute (or nothing)', ''), v('total', 'how many are registered', '24'), v('link', 'link to the list and payments', 'https://score.blta.sk/tournaments-admin')],
    subject: 'Registrácia {kindIn}{substituteTag}: {name}{categoryTag}',
    body: ['Nová registrácia {kindIn} {season}:', '', 'Meno: {name}{account}', 'Kategória: {category}', 'Telefón: {phone}', 'E-mail: {email}', 'Poznámka: {note}', '', '{substituteWarning}', '', 'Prihlásených {kindWhere}: {total}', 'Zoznam a úhrady: {link}'].join('\n'),
  },
  {
    key: 'seasonUnregistration', group: 'Tournaments and series', audience: 'The admin',
    title: 'Withdrawal from a season or tournament', when: 'A registered player drops out.',
    vars: [v('kindOf', '"turnaja" or "série"', 'turnaja'), v('kindFrom', '"z turnaja" or "zo série"', 'z turnaja'), v('kindWhere', '"v turnaji" or "v sérii"', 'v turnaji'), v('season', 'name', 'Summer Open 2027'), v('name', 'player name', 'Peter Novák'), v('phone', 'phone (empty = no line)', '0903111222'), v('email', 'e-mail (empty = no line)', 'peter@example.com'), v('substituteNote', 'a note when he was a substitute (or nothing)', ''), v('total', 'how many are registered now', '23'), v('link', 'link to the list', 'https://score.blta.sk/tournaments-admin')],
    subject: 'Odhlásenie {kindFrom}: {name}',
    body: ['Odhlásenie z {kindOf} {season}:', '', 'Meno: {name}', 'Telefón: {phone}', 'E-mail: {email}', '', '{substituteNote}', '', 'Prihlásených {kindWhere}: {total}', 'Zoznam a úhrady: {link}'].join('\n'),
  },
  // ------------------------------------------------------------------ to the admin
  {
    key: 'matchFinishedAdmin', group: 'To the admin', audience: 'The admin',
    title: 'A match was finished', when: 'Every match that ends in the app.',
    vars: [v('category', 'category', 'ELITE'), v('player1', 'first player', 'Peter Novák'), v('player2', 'second player', 'Jozef Kováč'), v('winner', 'winner', 'Peter Novák'), v('score', 'score (with the reason of the end)', '6-3, 6-4'), v('location', 'place', 'Kurt 1'), v('scheduled', 'planned time', '14. 10. 2026, 18:00:00'), v('started', 'start', '14. 10. 2026, 18:05:00'), v('ended', 'end', '14. 10. 2026, 19:10:00'), v('duration', 'duration (empty = no line)', '65 min'), v('link', 'link to the match', 'https://score.blta.sk/match/abc')],
    subject: 'Zápas ukončený: {player1} vs {player2} ({category})',
    body: ['Kategória: {category}', 'Hráči: {player1} vs {player2}', 'Víťaz: {winner}', 'Skóre: {score}', 'Miesto: {location}', 'Naplánované: {scheduled}', 'Začiatok: {started}', 'Koniec: {ended}', 'Trvanie: {duration}', 'Odkaz: {link}'].join('\n'),
  },
  {
    key: 'newRegistration', group: 'To the admin', audience: 'The admin',
    title: 'New player registered', when: 'A player registers on the site (a brand-new profile).',
    vars: [v('name', 'player name', 'Peter Novák'), v('phone', 'phone', '0903111222'), v('email', 'e-mail', 'peter@example.com'), v('level', 'the tennis level he chose (empty = no line)', 'Next Gen – mierne pokročilý')],
    subject: 'Nová registrácia hráča: {name}',
    body: ['Nový hráč sa práve zaregistroval na BLTA:', 'Meno: {name}', 'Telefón: {phone}', 'E-mail: {email}', 'Tenisová úroveň: {level}'].join('\n'),
  },
  {
    key: 'newRegistrationClaimed', group: 'To the admin', audience: 'The admin',
    title: 'Player took over a roster profile', when: 'A player registers under a name an admin had already added (without phone and e-mail).',
    vars: [v('name', 'player name', 'Peter Novák'), v('phone', 'phone', '0903111222'), v('email', 'e-mail', 'peter@example.com'), v('level', 'the tennis level he chose (empty = no line)', 'Next Gen – mierne pokročilý')],
    subject: 'Nová registrácia hráča: {name}',
    body: ['{name} si práve priradil svoj existujúci profil hráča na BLTA (doteraz nemal uvedený telefón ani e-mail):', 'Meno: {name}', 'Telefón: {phone}', 'E-mail: {email}', 'Tenisová úroveň: {level}'].join('\n'),
  },
  {
    key: 'adminResetRequest', group: 'To the admin', audience: 'The admin',
    title: 'Reset of a login code requested (player has no e-mail)', when: 'A player without an e-mail asks for a new login code.',
    vars: [v('name', 'player name', 'Peter Novák'), v('phone', 'phone', '0903111222')],
    subject: 'Žiadosť o reset prihlasovacieho kódu: {name}',
    body: ['{name} (telefón {phone}) požiadal o reset svojho prihlasovacieho kódu pre BLTA.', 'Nemá uvedený e-mail, takže mu nie je možné poslať odkaz na samoobslužný reset.', 'Resetuj ho z jeho profilu (Upraviť profil → Resetovať prihlasovací kód) po tom, čo si overíš, že je to naozaj on.'].join('\n'),
  },
  {
    key: 'clubWaiting', group: 'To the admin', audience: 'The admin',
    title: 'New club waits for approval', when: 'A player creates a club.',
    vars: [v('club', 'club name', 'Tenis Dúbravka'), v('city', 'city (empty = no line)', 'Bratislava'), v('creator', 'who created it (empty = no line)', 'Peter Novák'), v('link', 'link to Backend > Communities', 'https://score.blta.sk/communities-admin')],
    subject: 'Nový klub čaká na schválenie: {club}',
    body: ['Hráč založil nový klub, ktorý čaká na tvoje schválenie:', 'Názov: {club}', 'Mesto: {city}', 'Založil: {creator}', '', 'Schváliť ho môžeš v Backende > Communities: {link}'].join('\n'),
  },
  {
    key: 'contactRequest', group: 'To the admin', audience: 'The league contact address',
    title: 'Message from the website contact form', when: 'Somebody writes through "Napíš nám" on the national page.',
    vars: [v('name', 'who wrote', 'Peter Novák'), v('email', 'his e-mail', 'peter@example.com'), v('phone', 'his phone', '0903111222'), v('language', 'language of the page', 'SK'), v('message', 'the message', 'Chcem sa pridať do ligy.')],
    subject: 'SLTA: správa z webu od {name}',
    body: ['Meno: {name}', 'Email: {email}', 'Telefón: {phone}', 'Jazyk stránky: {language}', '', 'Doplňujúce informácie:', '{message}'].join('\n'),
  },
  {
    key: 'kioskBatteryLow', group: 'To the admin', audience: 'The admin',
    title: 'Kiosk phone battery is low', when: 'The phone on a court is at 20 % or less and not charging (once per low battery).',
    vars: [v('court', 'court name', 'Kurt 1'), v('season', 'tournament', 'Summer Open 2027'), v('percent', 'battery, in per cent', '15')],
    subject: 'Slabá batéria: {court} ({percent} %)',
    body: ['Telefón, ktorý leží na kurte "{court}" (turnaj {season}), má {percent} % batérie a nenabíja sa.', '', 'Pripojte ho k nabíjačke, inak sa vypne a zápasy sa nebudú dať zapisovať.', 'Ďalší e-mail príde, až keď sa telefón nabije a batéria opäť klesne.'].join('\n'),
  },
  {
    key: 'backupFailed', group: 'To the admin', audience: 'The admin',
    title: 'Daily database backup failed', when: 'The backup to Google Drive fails.',
    vars: [v('error', 'the error message', 'Invalid credentials')],
    subject: 'BLTA: záloha databázy zlyhala',
    body: ['Dnešná automatická záloha databázy BLTA na Google Drive zlyhala:', '', '{error}', '', 'Samotná stránka nie je ovplyvnená — znamená to len, že dnešná záloha mimo servera sa neuskutočnila. Kompletnú chybu nájdeš v Render logoch.'].join('\n'),
  },
];

const byKey = new Map(TEMPLATES.map((t) => [t.key, t]));
const GROUPS = [...new Set(TEMPLATES.map((t) => t.group))];

function savedAll() {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(KEY);
  try { return row ? JSON.parse(row.value) || {} : {}; } catch { return {}; }
}

const textOf = (saved, field, fallback) => (saved && typeof saved[field] === 'string' && saved[field].trim() ? saved[field] : fallback);

// -> { subject, body } of one template: the saved text, or the built-in one
function current(key, all = savedAll()) {
  const t = byKey.get(key);
  if (!t) throw new Error(`Unknown e-mail: ${key}`);
  return { subject: textOf(all[key], 'subject', t.subject), body: textOf(all[key], 'body', t.body) };
}

// every template with its current and its built-in text (what the Backend shows)
function list() {
  const all = savedAll();
  return TEMPLATES.map((t) => {
    const now = current(t.key, all);
    return { key: t.key, group: t.group, audience: t.audience, title: t.title, when: t.when, vars: t.vars, subject: now.subject, body: now.body, defaultSubject: t.subject, defaultBody: t.body, edited: now.subject !== t.subject || now.body !== t.body };
  });
}

const unknownVars = (template, text) => [...String(text).matchAll(/\{[?!]?(\w+)\}/g)].map((m) => m[1]).filter((n) => !template.vars.some((x) => x.name === n));

// -> { error } or the saved template. A text left empty goes back to the built-in one.
function save(key, input) {
  const t = byKey.get(key);
  if (!t) return { error: 'Unknown e-mail' };
  const b = input || {};
  const subject = typeof b.subject === 'string' ? b.subject.replace(/\s+/g, ' ').trim() : '';
  const body = typeof b.body === 'string' ? b.body.replace(/\r/g, '').trim() : '';
  if (subject.length > LIMITS.subject) return { error: `The subject is too long (max ${LIMITS.subject} characters)` };
  if (body.length > LIMITS.body) return { error: `The text is too long (max ${LIMITS.body} characters)` };
  const bad = [...new Set([...unknownVars(t, subject), ...unknownVars(t, body)])];
  if (bad.length) return { error: `Unknown variable${bad.length > 1 ? 's' : ''}: ${bad.map((n) => `{${n}}`).join(', ')}. Use only the ones listed for this e-mail.` };
  const all = savedAll();
  if (!subject && !body) delete all[key];
  else all[key] = { subject, body };
  db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(all));
  return list().find((x) => x.key === key);
}

function reset(key) {
  if (!byKey.has(key)) return { error: 'Unknown e-mail' };
  const all = savedAll();
  delete all[key];
  db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(all));
  return list().find((x) => x.key === key);
}

const has = (vars, name) => String(vars[name] == null ? '' : vars[name]).trim() !== '';

// Fills a text: the rules of the header of this file
function fill(text, vars) {
  const out = [];
  String(text).replace(/\r/g, '').split('\n').forEach((raw) => {
    let line = raw;
    const marker = /^\{([?!])(\w+)\}/.exec(line);
    if (marker) {
      if ((marker[1] === '?') !== has(vars, marker[2])) return;
      line = line.slice(marker[0].length);
    }
    const names = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (names.length && names.every((n) => !has(vars, n))) return; // a line made of empty variables only is left out
    out.push(line.replace(/\{(\w+)\}/g, (all, n) => (n in vars ? String(vars[n] == null ? '' : vars[n]) : all)));
  });
  const lines = [];
  out.forEach((l) => { if (l.trim() === '' && (lines.length === 0 || lines[lines.length - 1].trim() === '')) return; lines.push(l); });
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}

const fillSubject = (text, vars) => String(text).replace(/\{(\w+)\}/g, (all, n) => (n in vars ? String(vars[n] == null ? '' : vars[n]) : all)).replace(/\s+/g, ' ').trim();

// -> { subject, text } of the e-mail with these values; `override` ({ subject, body }) is the text being edited in the Backend (nothing is saved)
function render(key, vars, override) {
  const now = override ? { subject: override.subject || current(key).subject, body: override.body || current(key).body } : current(key);
  return { subject: fillSubject(now.subject, vars || {}), text: fill(now.body, vars || {}) };
}

// the example values of a template (preview and test e-mail)
function sampleVars(key) {
  const t = byKey.get(key);
  if (!t) return {};
  return Object.fromEntries(t.vars.map((x) => [x.name, x.sample]));
}

module.exports = { TEMPLATES, GROUPS, list, save, reset, render, current, sampleVars, fill };
