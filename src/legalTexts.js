// The legal pages of the site (linked from the footer): the privacy policy, the cookies and the terms of entry. One piece of text per page and language, written
// into the page by the server (public/legal.html has only the frame), so a visitor and a search engine read it without a script.
//
// The operator (name, address, IČO, e-mail) comes from Backend > Menu > Contact (src/routes/contact.js), so the texts never carry a copy of it.
// The texts describe what the app really does (see the data it keeps in src/db/); when the app starts keeping something new, this file is where it is added.
// They are a careful draft, not legal advice: have them read by a lawyer before they are relied on.
const contact = require('./routes/contact');

const UPDATED = '17. 11. 2026';
const UPDATED_EN = '17 November 2026';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function operator(lang) {
  const c = contact.read() || {};
  const lines = [c.orgName, ...(c.address ? String(c.address).split(/\r?\n/) : []), c.ico ? `IČO: ${c.ico}` : ''].filter(Boolean);
  const mail = c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '';
  return { lines: lines.map(esc).join('<br>'), mail, hasMail: !!c.email, lang };
}

const SK = {
  privacy: (o, b, u) => ({
    h1: 'Ochrana osobných údajov',
    body: `
<p class="blog-meta">Posledná aktualizácia: ${UPDATED}</p>
<p>Tu sa dozvieš, aké osobné údaje o tebe ${b} spracúva, prečo, komu ich odovzdáva a aké práva máš. Píšeme to po ľudsky; ak niečomu nerozumieš, napíš nám.</p>

<h2>Kto je prevádzkovateľ</h2>
<p>${o.lines}${o.hasMail ? `<br>E-mail: ${o.mail}` : ''}</p>

<h2>Aké údaje spracúvame a prečo</h2>
<ul>
<li><strong>Účet hráča:</strong> meno, telefónne číslo, e-mail a prihlasovací kód. Slúži na to, aby si sa mohol prihlásiť, hrať zápasy a ligu. Právny základ: plnenie zmluvy (tvoja účasť v lige).</li>
<li><strong>Profil hráča (dobrovoľné):</strong> fotografia, národnosť, dátum narodenia, výška, váha, štýl hry, raketa, struny, obľúbený hráč. Vypĺňaš ich sám a môžeš ich kedykoľvek zmeniť alebo zmazať. Právny základ: tvoj súhlas.</li>
<li><strong>Zápasy, výsledky a rebríčky:</strong> s kým si hral, výsledok, body a poradie. Sú verejné, lebo ide o podstatu ligy. Právny základ: oprávnený záujem prevádzkovateľa a hráčov na transparentnej a overiteľnej súťaži.</li>
<li><strong>Registrácia na turnaj:</strong> meno, telefón, e-mail, kategória, poznámka, stav úhrady štartovného. Právny základ: plnenie zmluvy a zákonná povinnosť pri účtovníctve.</li>
<li><strong>Správy medzi hráčmi a v zápase:</strong> text správ, ktoré napíšeš v aplikácii.</li>
<li><strong>Upozornenia (push):</strong> technický údaj tvojho prehliadača na doručenie upozornení, ak ich povolíš. Kedykoľvek ich vypneš v prehliadači.</li>
<li><strong>Prihlasovanie a bezpečnosť:</strong> čas prihlásenia a technické údaje potrebné na ochranu účtu pred zneužitím. Právny základ: oprávnený záujem (bezpečnosť).</li>
<li><strong>Meranie návštevnosti:</strong> iba ak to povolíš v lište cookies (pozri <a href="${u('/cookies')}">Cookies</a>). Právny základ: tvoj súhlas.</li>
</ul>

<h2>Čo je na webe verejné a ako to skryť</h2>
<p>Verejne vidno tvoje meno, výsledky, štatistiky, umiestnenie v rebríčku a profilovú fotografiu, ak si ju pridal. Ak nechceš, aby bol tvoj profil verejne zobrazený alebo vyhľadateľný, napíš nám a administrátor ho skryje. Skrytý profil sa neuvádza v zozname hráčov ani v mape stránok pre vyhľadávače.</p>

<h2>Komu údaje odovzdávame</h2>
<ul>
<li>poskytovateľ hostingu a databázy (spracúva údaje v našom mene),</li>
<li>poskytovateľ úložiska (Google Drive) pre zálohy a fotografie z turnajov,</li>
<li>poskytovateľ e-mailových služieb na odosielanie správ (napr. o výsledku zápasu, kódu na obnovenie prístupu),</li>
<li>poskytovateľ platobnej služby alebo tvoja banka, ak platíš štartovné cez platobný odkaz či prevodom,</li>
<li>Google (Tag Manager a nástroje, ktoré cez neho spúšťame) a ďalšie reklamné či analytické služby, <strong>len ak to povolíš</strong> v lište cookies.</li>
</ul>
<p>Údaje nepredávame. Nerobíme automatizované rozhodovanie, ktoré by na teba malo právne účinky. Niektorí poskytovatelia môžu údaje spracúvať aj mimo EÚ; v takom prípade sa opierame o primerané záruky (napr. štandardné zmluvné doložky).</p>

<h2>Ako dlho údaje uchovávame</h2>
<p>Údaje účtu a profilu, kým je tvoj účet aktívny, alebo kým nepožiadaš o vymazanie. Výsledky a rebríčky uchovávame ako históriu ligy; ak požiadaš o vymazanie, osobné údaje v nich anonymizujeme alebo odstránime v rozsahu, ktorý to umožňuje. Doklady o platbách uchovávame, ako vyžaduje zákon. Zálohy sa pravidelne obmieňajú.</p>

<h2>Tvoje práva</h2>
<p>Máš právo na prístup k údajom, ich opravu, vymazanie, obmedzenie spracúvania, prenosnosť a právo namietať proti spracúvaniu na základe oprávneného záujmu. Súhlas môžeš kedykoľvek odvolať (cookies v lište cookies, profil v nastaveniach alebo e-mailom); nemá to vplyv na zákonnosť spracúvania pred odvolaním. Máš aj právo podať sťažnosť na Úrad na ochranu osobných údajov Slovenskej republiky (<a href="https://dataprotection.gov.sk" rel="noopener">dataprotection.gov.sk</a>).</p>
<p>Svoje práva uplatníš e-mailom${o.hasMail ? ` na ${o.mail}` : ''}. Odpovieme najneskôr do jedného mesiaca.</p>`,
  }),

  cookies: (o, b, u) => ({
    h1: 'Cookies',
    body: `
<p class="blog-meta">Posledná aktualizácia: ${UPDATED}</p>
<p>Cookies a podobné úložisko v prehliadači používame v troch podobách. Stránka funguje rovnako, či analytické a reklamné povolíš, alebo nie.</p>

<h2>Nevyhnutné (bez súhlasu)</h2>
<p>Bez nich by ${b} nefungoval a nevyžadujú súhlas: prihlásenie hráča alebo administrátora (relácia), výber mesta pri práci v administrácii, zapamätanie jazyka (SK/EN) a zapamätanie tvojej voľby v lište cookies.</p>

<h2>Meranie návštevnosti a marketing (iba so súhlasom)</h2>
<p>Používame Google Tag Manager. Kým nepovolíš, všetky druhy úložiska ostávajú zakázané (Google Consent Mode v2). Ak súhlasíš, môžu sa cez Tag Manager spustiť analytické a reklamné nástroje (napr. meranie návštevnosti, meranie reklamných kampaní) a tieto nástroje môžu ukladať cookies a odosielať údaje svojim prevádzkovateľom.</p>

<h2>Ako zmeniť svoju voľbu</h2>
<p>V pätičke stránky klikni na <strong>Cookies</strong>; lišta sa otvorí znova a voľbu môžeš zmeniť. Cookies môžeš zmazať aj v nastaveniach svojho prehliadača.</p>

<p>Viac o tom, ako zaobchádzame s údajmi, nájdeš v <a href="${u('/privacy')}">zásadách ochrany osobných údajov</a>. Prevádzkovateľ:<br>${o.lines}</p>`,
  }),

  terms: (o, b, u) => ({
    h1: 'Obchodné podmienky',
    body: `
<p class="blog-meta">Posledná aktualizácia: ${UPDATED}</p>
<p>Tieto podmienky platia, keď sa cez ${b} prihlásiš do turnaja alebo ligy a zaplatíš štartovné.</p>

<h2>Kto je organizátor</h2>
<p>${o.lines}${o.hasMail ? `<br>E-mail: ${o.mail}` : ''}<br>Turnaje klubov a komunít organizujú samotné kluby; v takom prípade je organizátorom klub uvedený pri turnaji.</p>

<h2>Prihlásenie</h2>
<p>Prihlásiť sa môžeš na stránke turnaja alebo série. Pri prihlásení zadáš meno, kontakt a kategóriu. Prihlásenie je záväzné po jeho potvrdení v aplikácii; ak je turnaj obmedzený počtom miest, rozhoduje poradie prihlásenia a pravidlá turnaja (Propozície).</p>

<h2>Štartovné a platba</h2>
<p>Výška štartovného je uvedená pri každom turnaji či sérii pred prihlásením. Zaplatiť môžeš prevodom na účet (po prihlásení sa ti zobrazí IBAN a QR kód s variabilným symbolom) alebo cez platobný odkaz, ak ho organizátor uvedie. Ak štartovné ešte nie je pripísané, môžeme ti poslať pripomienku. Podujatie s nulovým štartovným alebo s nápisom „zadarmo“ platbu nevyžaduje.</p>

<h2>Odhlásenie a vrátenie štartovného</h2>
<p>Ak sa nemôžeš zúčastniť, odhlás sa v aplikácii čo najskôr a daj nám vedieť, aby sa miesto mohlo uvoľniť pre iného hráča. O vrátení štartovného rozhodujú pravidlá konkrétneho turnaja a dohoda s organizátorom; ak sa turnaj neuskutoční z dôvodu na strane organizátora, štartovné sa vráti.</p>

<h2>Pravidlá hry a správanie</h2>
<p>Zápasy sa hrajú podľa <a href="${u('/propozicie')}">Propozícií</a>. Hráč zodpovedá za správne zadané výsledky a za férové správanie; organizátor môže hráča pri hrubom porušení pravidiel zo súťaže vylúčiť.</p>

<h2>Reklamácie a kontakt</h2>
<p>Ak máš problém s prihlásením, platbou alebo výsledkom, napíš nám${o.hasMail ? ` na ${o.mail}` : ''}; odpovieme čo najskôr. Spotrebiteľ sa môže obrátiť aj na orgán dohľadu alebo na subjekt alternatívneho riešenia sporov (<a href="https://www.mhsr.sk/obchod/ochrana-spotrebitela/alternativne-riesenie-spotrebitelskych-sporov" rel="noopener">zoznam na stránke ministerstva hospodárstva</a>).</p>

<p>Spracovanie osobných údajov popisujú <a href="${u('/privacy')}">zásady ochrany osobných údajov</a>.</p>`,
  }),
};

const EN = {
  privacy: (o, b, u) => ({
    h1: 'Privacy policy',
    body: `
<p class="blog-meta">Last updated: ${UPDATED_EN}</p>
<p>This page explains what personal data ${b} processes about you, why, who receives it and what rights you have. If anything is unclear, write to us.</p>

<h2>Who is the controller</h2>
<p>${o.lines}${o.hasMail ? `<br>Email: ${o.mail}` : ''}</p>

<h2>What data we process and why</h2>
<ul>
<li><strong>Player account:</strong> name, phone number, email and a login code. It lets you sign in and play matches and the league. Legal basis: performance of a contract (your participation in the league).</li>
<li><strong>Player profile (optional):</strong> photo, nationality, date of birth, height, weight, playing style, racket, strings, favourite player. You fill these in yourself and can change or delete them at any time. Legal basis: your consent.</li>
<li><strong>Matches, results and rankings:</strong> who you played, the result, points and position. They are public because they are the point of the league. Legal basis: the legitimate interest of the operator and the players in a transparent, verifiable competition.</li>
<li><strong>Tournament registration:</strong> name, phone, email, category, a note and whether the entry fee is paid. Legal basis: performance of a contract and legal accounting obligations.</li>
<li><strong>Messages between players and in a match:</strong> the text you write in the app.</li>
<li><strong>Notifications (push):</strong> a technical identifier of your browser used to deliver notifications, if you allow them. You can turn them off in your browser at any time.</li>
<li><strong>Sign-in and security:</strong> the time of sign-in and the technical data needed to protect accounts from misuse. Legal basis: legitimate interest (security).</li>
<li><strong>Measuring visits:</strong> only if you allow it in the cookie banner (see <a href="${u('/cookies')}">Cookies</a>). Legal basis: your consent.</li>
</ul>

<h2>What is public and how to hide it</h2>
<p>Your name, results, statistics, ranking position and profile photo (if you added one) are visible to everybody. If you do not want your profile to be shown or found publicly, write to us and an administrator will hide it. A hidden profile is left out of the list of players and out of the sitemap given to search engines.</p>

<h2>Who receives the data</h2>
<ul>
<li>the hosting and database provider (processes data on our behalf),</li>
<li>the storage provider (Google Drive) for backups and tournament photos,</li>
<li>the email service provider that sends messages (for example about a match result or a code to recover access),</li>
<li>a payment service provider or your bank if you pay the entry fee by payment link or bank transfer,</li>
<li>Google (Tag Manager and the tools we run through it) and other advertising or analytics services, <strong>only if you allow it</strong> in the cookie banner.</li>
</ul>
<p>We do not sell data. We do not make automated decisions that have legal effects on you. Some providers may process data outside the EU; in that case we rely on appropriate safeguards (for example standard contractual clauses).</p>

<h2>How long we keep the data</h2>
<p>Account and profile data while your account is active or until you ask for deletion. Results and rankings are kept as the history of the league; if you ask for deletion, we anonymise or remove the personal data in them as far as that is possible. Payment records are kept as the law requires. Backups are rotated regularly.</p>

<h2>Your rights</h2>
<p>You have the right of access, rectification, erasure, restriction, portability and the right to object to processing based on legitimate interest. You can withdraw consent at any time (cookies in the cookie banner, the profile in your settings or by email); this does not affect the lawfulness of processing before the withdrawal. You also have the right to complain to the Office for Personal Data Protection of the Slovak Republic (<a href="https://dataprotection.gov.sk" rel="noopener">dataprotection.gov.sk</a>).</p>
<p>To use your rights, email${o.hasMail ? ` ${o.mail}` : ' us'}. We reply within one month at the latest.</p>`,
  }),

  cookies: (o, b, u) => ({
    h1: 'Cookies',
    body: `
<p class="blog-meta">Last updated: ${UPDATED_EN}</p>
<p>We use cookies and similar browser storage in three ways. The site works the same whether or not you allow the analytics and advertising ones.</p>

<h2>Necessary (no consent needed)</h2>
<p>${b} would not work without these, and they need no consent: signing in as a player or an administrator (the session), the city chosen while working in the administration, remembering the language (SK/EN) and remembering your choice in the cookie banner.</p>

<h2>Measuring visits and marketing (only with your consent)</h2>
<p>We use Google Tag Manager. Until you allow it, every kind of storage stays denied (Google Consent Mode v2). If you agree, analytics and advertising tools (for example measuring visits and advertising campaigns) can run through Tag Manager, and those tools may store cookies and send data to their operators.</p>

<h2>How to change your choice</h2>
<p>Click <strong>Cookies</strong> in the footer; the banner opens again and you can change the choice. You can also delete cookies in your browser settings.</p>

<p>More about how we handle data is in the <a href="${u('/privacy')}">privacy policy</a>. Operator:<br>${o.lines}</p>`,
  }),

  terms: (o, b, u) => ({
    h1: 'Terms and conditions',
    body: `
<p class="blog-meta">Last updated: ${UPDATED_EN}</p>
<p>These terms apply when you sign up for a tournament or the league through ${b} and pay an entry fee.</p>

<h2>Who is the organiser</h2>
<p>${o.lines}${o.hasMail ? `<br>Email: ${o.mail}` : ''}<br>Tournaments of clubs and communities are run by the clubs themselves; then the organiser is the club named on the tournament.</p>

<h2>Signing up</h2>
<p>You can sign up on the page of a tournament or a series. You give your name, a contact and a category. A registration is binding once it is confirmed in the app; if a tournament has a limited number of places, the order of registration and the rules of the tournament (Rules) decide.</p>

<h2>Entry fee and payment</h2>
<p>The entry fee is shown on each tournament or series before you sign up. You can pay by bank transfer (after signing up you see the IBAN and a QR code with a variable symbol) or by a payment link, if the organiser provides one. If the fee has not been received yet, we may send you a reminder. An event with a zero fee, or marked "free", needs no payment.</p>

<h2>Withdrawing and refunds</h2>
<p>If you cannot take part, withdraw in the app as early as you can and let us know so the place can go to another player. A refund of the entry fee is governed by the rules of the particular tournament and your agreement with the organiser; if a tournament does not take place for a reason on the organiser's side, the fee is refunded.</p>

<h2>Rules of play and conduct</h2>
<p>Matches are played under the <a href="${u('/propozicie')}">Rules</a>. A player is responsible for entering results correctly and for fair conduct; the organiser may exclude a player from the competition for serious breaches.</p>

<h2>Complaints and contact</h2>
<p>If you have a problem with a registration, a payment or a result, write to us${o.hasMail ? ` at ${o.mail}` : ''}; we will reply as soon as we can. A consumer may also contact the supervisory authority or a body for alternative dispute resolution (<a href="https://www.mhsr.sk/obchod/ochrana-spotrebitela/alternativne-riesenie-spotrebitelskych-sporov" rel="noopener">list on the website of the Ministry of Economy</a>).</p>

<p>How personal data is processed is described in the <a href="${u('/privacy')}">privacy policy</a>.</p>`,
  }),
};

// the page: { heading, html } for the key (privacy | cookies | terms) in the language; `brand` is the name of the site (BLTA, or the brand of a city)
// urlOf(code): the public address of a page in this language (and under this city), so a link follows a changed slug of Backend > SEO
function page(key, lang, brand, urlOf) {
  const make = (lang === 'en' ? EN : SK)[key];
  if (!make) return null;
  const { h1, body } = make(operator(lang), esc(brand || 'BLTA'), (code) => esc(urlOf ? urlOf(code) : code));
  return `<article class="blog-article legal-article"><h1>${esc(h1)}</h1><div class="blog-body">${body}</div></article>`;
}

const KEYS = ['privacy', 'cookies', 'terms'];
module.exports = { page, KEYS };
