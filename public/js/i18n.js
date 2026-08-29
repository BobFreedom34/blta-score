// Lightweight client-side i18n. No build step, no framework — just a
// dictionary, a t() lookup, and a data-i18n attribute walker, matching how
// the rest of this app is built. Slovak is the default language (this is
// a Bratislava tennis league); English is available via the switcher in
// the nav and remembered per browser.
//
// Phase 1 (this pass) covers the homepage (index.html + app.js) and the
// shared bits it depends on in common.js (nav, category/status labels,
// the share/access-denied/embed modals, toasts). Other pages still render
// in English regardless of the switcher until they get their own pass —
// that's expected, not a bug: a page with no data-i18n attributes and no
// t() calls simply has nothing for applyStaticTranslations()/t() to act
// on yet.
const LANG_STORAGE_KEY = 'blta_lang';
let currentLang = 'sk';
try {
  const saved = localStorage.getItem(LANG_STORAGE_KEY);
  if (saved === 'sk' || saved === 'en') currentLang = saved;
} catch { /* localStorage unavailable — default to sk */ }

const TRANSLATIONS = {
  sk: {
    'nav.matches': 'Zápasy',
    'nav.players': 'Hráči',
    'nav.rankings': 'Rebríček',
    'nav.newMatch': '+ Nový zápas',
    'nav.loginPlayer': 'PRIHLÁSIŤ SA AKO HRÁČ',
    'nav.logout': 'ODHLÁSIŤ SA',
    'nav.logoutWithName': 'ODHLÁSIŤ SA ({name})',

    'tabs.all': 'Všetky zápasy',
    'tabs.scheduled': 'Naplánované',
    'tabs.planned': 'Plánované',
    'tabs.live': 'Naživo',
    'tabs.finished': 'Ukončené',
    'tabs.unfinished': 'Nedokončené',

    'filters.searchPlaceholder': 'Hľadať meno hráča…',
    'filters.allCategories': 'Všetky kategórie',
    'category.FRIENDLY': 'PRIATEĽSKÝ',
    'filters.anyTime': 'Kedykoľvek',
    'filters.today': 'Dnes',
    'filters.tomorrow': 'Zajtra',
    'filters.thisWeek': 'Tento týždeň',
    'filters.nextWeek': 'Budúci týždeň',
    'filters.noDate': 'Bez dátumu',
    'filters.reset': 'Zrušiť filtre',

    'status.PLANNED': 'Plánovaný',
    'status.LIVE': 'Naživo',
    'status.FINISHED': 'Ukončený',
    'status.UNFINISHED': 'Nedokončený',

    'matches.loading': 'Načítavam zápasy…',
    'matches.noneOfType': 'Žiadne zápasy — {label}.',
    'matches.noneFiltered': 'Žiadne zápasy — {label} — nezodpovedajú vašim filtrom.',
    'matches.couldNotLoad': 'Zápasy sa nepodarilo načítať: {error}',
    'matches.liveHeading': '🔴 Naživo',
    'matches.scheduledHeading': '📅 Naplánované',
    'matches.plannedHeading': '🕓 Plánované',
    'matches.overdueWarning': '⚠️ Po termíne — výsledok ešte nie je zaznamenaný',
    'matches.setDateLocation': '📅 Nastaviť dátum a miesto',
    'matches.proposeTimes': '🗓 Navrhnúť termíny súperovi',
    'matches.addToCalendar': '📅 Pridať do kalendára',
    'matches.notifyStart': '🔔 Upozorniť: začiatok',
    'matches.notifiedStart': '✓ Upozornené: začiatok',
    'matches.notifyFinish': '🏁 Upozorniť: koniec',
    'matches.notifiedFinish': '✓ Upozornené: koniec',

    'footer.embedList': 'Vložiť tento zoznam',
    'footer.manageBadges': 'Spravovať odznaky',

    'embed.title': 'Vložiť do WordPress',
    'embed.desc': 'Vložte toto do bloku „Custom HTML“ na vašej stránke blta.sk:',
    'embed.descWithList': 'Vložte toto do bloku „Custom HTML“ na vašej stránke blta.sk, aby sa zobrazil zoznam — {label}:',
    'embed.copyCode': 'Kopírovať kód',
    'embed.copied': 'Kód skopírovaný',

    'quickSchedule.title': 'Nastaviť dátum a miesto',
    'quickSchedule.place': 'Miesto',
    'quickSchedule.placePlaceholder': 'napr. NTC Bratislava, kurt 3',
    'quickSchedule.dateTime': 'Dátum a čas',
    'common.save': 'Uložiť',

    'proposeTimes.title': 'Navrhnúť termíny súperovi',
    'proposeTimes.desc': 'Označte všetky časy, kedy môžete hrať, a niekoľko miest, ktoré vám vyhovujú — súper si jeden vyberie cez zdieľaný odkaz na zápas.',
    'proposeTimes.venues': 'Preferované miesta',
    'proposeTimes.add': 'Pridať',
    'proposeTimes.whoProposing': 'Kto navrhuje?',
    'common.optional': '(voliteľné)',
    'common.player1': 'Hráč 1',
    'common.player2': 'Hráč 2',
    'proposeTimes.shownHint': 'Zobrazí sa súperovi nad termínmi, aby vedel, komu odpovedá.',
    'proposeTimes.markTimes': 'Označte časy, kedy môžete hrať',
    'common.clearAll': 'Vymazať všetko',
    'proposeTimes.emailConfirm': 'E-mail pre potvrdenie',
    'proposeTimes.send': 'Odoslať návrh',
    'proposeTimes.markAtLeastOne': 'Označte aspoň jeden čas, kedy môžete hrať.',
    'proposeTimes.addAtLeastOneVenue': 'Pridajte aspoň jedno preferované miesto.',
    'proposeTimes.invalidEmail': 'Zadajte platnú e-mailovú adresu pre potvrdenie, alebo pole nechajte prázdne.',
    'proposeTimes.whatsappText': '{p1} vs {p2} — vyberte si termín, ktorý vám vyhovuje:',
    'proposeTimes.shareDesc': 'Pošlite tento odkaz súperovi, aby si mohol vybrať termín, ktorý mu vyhovuje. Keď si termín vyberie, dostanete potvrdzovací e-mail, ak ste ho zadali.',
    'proposeTimes.updated': 'Váš návrh bol upravený!',
    'proposeTimes.sent': 'Vaše časy boli odoslané!',

    'share.title': 'Zdieľať zápas',
    'share.copyLink': 'Kopírovať odkaz',
    'share.linkCopied': 'Odkaz skopírovaný',
    'share.defaultWhatsappText': '{p1} vs {p2} — BLTA naživo:',

    'accessDenied.title': 'Tento zápas nemôžete spravovať',
    'accessDenied.message': 'Môžete spravovať iba zápasy, v ktorých hráte (ak ich vytvoril admin), alebo zápasy, ktoré ste vytvorili sami.',

    'notify.startTitle': 'Upozorniť ma, keď začne',
    'notify.finishTitle': 'Upozorniť ma, keď sa skončí',
    'notify.startDesc': 'Pošleme vám e-mail hneď, ako zápas začne.',
    'notify.finishDesc': 'Pošleme vám výsledok e-mailom hneď, ako sa zápas skončí.',
    'notify.yourEmail': 'Váš e-mail',
    'notify.notifyMe': 'Upozorniť ma',
    'notify.or': 'alebo',
    'notify.pushInstead': '🔔 Radšej push notifikácia',
    'notify.subscribed': 'Ste prihlásený na odber!',

    'login.title': 'Prihlásiť sa ako hráč',
    'login.phoneIntro': 'Ak ste hráč BLTA, zadajte <span style="color:var(--green-light);text-transform:uppercase">svoje telefónne číslo</span> (napr. 0903111222). Ešte ho nemáte v systéme? Požiadajte admina, aby ho pridal.',
    'login.notBltaPlayer': 'Ak nie ste hráč BLTA, prihláste sa namiesto toho kódom 3344 — aj tak môžete vytvárať a spravovať svoje vlastné zápasy.',
    'login.submit': 'Prihlásiť sa',

    'page.homeTitle': 'BLTA Score — Živé zápasy',
    'calendar.eventTitle': '{p1} vs {p2} — zápas BLTA',

    'common.edit': 'Upraviť',
    'common.delete': 'Vymazať',
    'common.cancel': 'Zrušiť',

    'page.playersTitle': 'BLTA Score — Hráči',
    'players.heading': 'Hráči',
    'players.intro': 'Pridajte každého hráča ligy sem raz — potom si ho vyberiete zo zoznamu pri vytváraní zápasu.',
    'players.newPlayerPlaceholder': 'Celé meno hráča',
    'players.addPlayer': '+ Pridať hráča',
    'players.adminRequiredBefore': 'Ktoréhokoľvek existujúceho hráča môže pri plánovaní zápasu vybrať ktokoľvek — pridávanie, premenovanie alebo odstraňovanie hráčov tu si vyžaduje prihlásenie ako admin.',
    'players.loginAsAdmin': 'Prihlásiť sa ako admin',
    'players.searchPlaceholder': 'Hľadať hráčov…',
    'players.loading': 'Načítavam…',
    'players.noneSearch': 'Žiadni hráči nezodpovedajú vášmu hľadaniu.',
    'players.noneYet': 'Zatiaľ žiadni hráči. Pridajte prvého vyššie.',
    'players.couldNotLoad': 'Hráčov sa nepodarilo načítať: {error}',
    'players.noPhoneOnFile': 'Telefón nie je v systéme',
    'players.namePlaceholder': 'Meno',
    'players.nameRequired': 'Meno je povinné',
    'players.updated': 'Hráč aktualizovaný',
    'players.deleteConfirm': "Vymazať {name}? Túto akciu nemožno vrátiť späť.",
    'players.deleted': 'Vymazané: {name}',
    'players.added': 'Pridané: {name}',

    'common.loading': 'Načítavam…',

    'page.rankingsTitle': 'BLTA Score — Rebríček',
    'rankings.heading': 'Rebríček',
    'rankings.none': 'Zatiaľ žiadne poradie.',
    'rankings.playerCol': 'Hráč',
    'rankings.ageCol': 'Vek',
    'rankings.matchesCol': 'Zápasy',
    'rankings.reset': 'Obnoviť',
    'rankings.resetTitle': 'Vrátiť na hodnotu publikovanú na blta.sk',
    'rankings.pointsMustBeWhole': 'Body musia byť celé číslo',
    'rankings.pointsUpdated': 'Body aktualizované',
    'rankings.revertedToBlta': 'Vrátené na hodnotu z blta.sk',
    'rankings.overriddenTooltip': 'Ručne nastavené adminom',
    'rankings.moveUpTitle': 'Hore o {amount} od minulého týždňa',
    'rankings.moveDownTitle': 'Dole o {amount} od minulého týždňa',

    'lang.switchTo': 'EN',
  },
  en: {
    'nav.matches': 'Matches',
    'nav.players': 'Players',
    'nav.rankings': 'Rankings',
    'nav.newMatch': '+ New match',
    'nav.loginPlayer': 'LOG IN AS PLAYER',
    'nav.logout': 'LOG OUT',
    'nav.logoutWithName': 'LOG OUT ({name})',

    'tabs.all': 'All Matches',
    'tabs.scheduled': 'Scheduled',
    'tabs.planned': 'Planned',
    'tabs.live': 'Live',
    'tabs.finished': 'Finished',
    'tabs.unfinished': 'Unfinished',

    'filters.searchPlaceholder': 'Search player name…',
    'filters.allCategories': 'All categories',
    'category.FRIENDLY': 'FRIENDLY',
    'filters.anyTime': 'Any time',
    'filters.today': 'Today',
    'filters.tomorrow': 'Tomorrow',
    'filters.thisWeek': 'This week',
    'filters.nextWeek': 'Next week',
    'filters.noDate': 'No date (TBD)',
    'filters.reset': 'Reset filters',

    'status.PLANNED': 'Planned',
    'status.LIVE': 'Live',
    'status.FINISHED': 'Finished',
    'status.UNFINISHED': 'Unfinished',

    'matches.loading': 'Loading matches…',
    'matches.noneOfType': 'No {label} matches.',
    'matches.noneFiltered': 'No {label} matches match your filters.',
    'matches.couldNotLoad': 'Could not load matches: {error}',
    'matches.liveHeading': '🔴 Live',
    'matches.scheduledHeading': '📅 Scheduled',
    'matches.plannedHeading': '🕓 Planned',
    'matches.overdueWarning': '⚠️ Overdue — no result recorded yet',
    'matches.setDateLocation': '📅 Set date &amp; location',
    'matches.proposeTimes': '🗓 Propose times for opponent',
    'matches.addToCalendar': '📅 Add to Calendar',
    'matches.notifyStart': '🔔 Notify: start',
    'matches.notifiedStart': '✓ Notified: start',
    'matches.notifyFinish': '🏁 Notify: finish',
    'matches.notifiedFinish': '✓ Notified: finish',

    'footer.embedList': 'Embed this list',
    'footer.manageBadges': 'Manage badges',

    'embed.title': 'Embed on WordPress',
    'embed.desc': 'Paste this into a "Custom HTML" block on your blta.sk page:',
    'embed.descWithList': 'Paste this into a "Custom HTML" block on your blta.sk page to show the {label} list:',
    'embed.copyCode': 'Copy code',
    'embed.copied': 'Embed code copied',

    'quickSchedule.title': 'Set date &amp; location',
    'quickSchedule.place': 'Place',
    'quickSchedule.placePlaceholder': 'e.g. NTC Bratislava, Court 3',
    'quickSchedule.dateTime': 'Date &amp; time',
    'common.save': 'Save',

    'proposeTimes.title': 'Propose times for the opponent',
    'proposeTimes.desc': "Mark every time you could play and a few venues you're happy with — the other player picks one via the match's share link.",
    'proposeTimes.venues': 'Preferred venues',
    'proposeTimes.add': 'Add',
    'proposeTimes.whoProposing': "Who's proposing?",
    'common.optional': '(optional)',
    'common.player1': 'Player 1',
    'common.player2': 'Player 2',
    'proposeTimes.shownHint': "Shown to the other player above the times, so they know who they're responding to.",
    'proposeTimes.markTimes': 'Mark the times you can play',
    'common.clearAll': 'Clear all',
    'proposeTimes.emailConfirm': 'Email for confirmation',
    'proposeTimes.send': 'Send proposal',
    'proposeTimes.markAtLeastOne': 'Mark at least one time you can play.',
    'proposeTimes.addAtLeastOneVenue': 'Add at least one preferred venue.',
    'proposeTimes.invalidEmail': 'Enter a valid confirmation email address, or leave it blank.',
    'proposeTimes.whatsappText': '{p1} vs {p2} — pick a time that works for you:',
    'proposeTimes.shareDesc': "Send this link to your opponent so they can pick the best time for them. Once they choose a date, you'll get a confirmation email if you added one.",
    'proposeTimes.updated': 'Your proposal was updated!',
    'proposeTimes.sent': 'Your times were sent!',

    'share.title': 'Share this match',
    'share.copyLink': 'Copy link',
    'share.linkCopied': 'Link copied',
    'share.defaultWhatsappText': '{p1} vs {p2} — BLTA live score:',

    'accessDenied.title': "Can't manage this match",
    'accessDenied.message': 'You can only manage matches you play in (if an admin created them) or matches you created yourself.',

    'notify.startTitle': 'Notify me when it starts',
    'notify.finishTitle': 'Notify me when it finishes',
    'notify.startDesc': "We'll email you as soon as this match starts.",
    'notify.finishDesc': "We'll email you the result as soon as this match finishes.",
    'notify.yourEmail': 'Your email',
    'notify.notifyMe': 'Notify me',
    'notify.or': 'or',
    'notify.pushInstead': '🔔 Push notification instead',
    'notify.subscribed': "You're subscribed!",

    'login.title': 'Log in as player',
    'login.phoneIntro': 'If you\'re a BLTA player, enter <span style="color:var(--green-light);text-transform:uppercase">your phone number</span> (e.g. 0903111222). Don\'t have one on file yet? Ask an admin to add it.',
    'login.notBltaPlayer': "If you're not a BLTA player, log in with 3344 instead — you can still create and manage your own matches.",
    'login.submit': 'Log in',

    'page.homeTitle': 'BLTA Score — Live Matches',
    'calendar.eventTitle': '{p1} vs {p2} — BLTA match',

    'common.edit': 'Edit',
    'common.delete': 'Delete',
    'common.cancel': 'Cancel',

    'page.playersTitle': 'BLTA Score — Players',
    'players.heading': 'Players',
    'players.intro': 'Add every league player here once — then pick them from the list when creating a match.',
    'players.newPlayerPlaceholder': 'Player full name',
    'players.addPlayer': '+ Add player',
    'players.adminRequiredBefore': 'Anyone can pick existing players when planning a match — adding, renaming, or removing players here requires an admin login.',
    'players.loginAsAdmin': 'Log in as admin',
    'players.searchPlaceholder': 'Search players…',
    'players.loading': 'Loading…',
    'players.noneSearch': 'No players match your search.',
    'players.noneYet': 'No players yet. Add the first one above.',
    'players.couldNotLoad': 'Could not load players: {error}',
    'players.noPhoneOnFile': 'No phone on file',
    'players.namePlaceholder': 'Name',
    'players.nameRequired': 'Name is required',
    'players.updated': 'Player updated',
    'players.deleteConfirm': "Delete {name}? This can't be undone.",
    'players.deleted': 'Deleted {name}',
    'players.added': 'Added {name}',

    'common.loading': 'Loading…',

    'page.rankingsTitle': 'BLTA Score — Rankings',
    'rankings.heading': 'Rankings',
    'rankings.none': 'No standings yet.',
    'rankings.playerCol': 'Player',
    'rankings.ageCol': 'Age',
    'rankings.matchesCol': 'Matches',
    'rankings.reset': 'Reset',
    'rankings.resetTitle': 'Revert to the value published on blta.sk',
    'rankings.pointsMustBeWhole': 'Points must be a whole number',
    'rankings.pointsUpdated': 'Points updated',
    'rankings.revertedToBlta': 'Reverted to blta.sk value',
    'rankings.overriddenTooltip': 'Manually set by an admin',
    'rankings.moveUpTitle': 'Up {amount} since last week',
    'rankings.moveDownTitle': 'Down {amount} since last week',

    'lang.switchTo': 'SK',
  },
};

// Looks up `key` in the current language, falling back to English, then to
// the raw key itself (so a missing translation fails loud/visible instead
// of silently rendering blank). `vars` does simple {name} interpolation.
function t(key, vars) {
  let s = (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) || TRANSLATIONS.en[key] || key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]);
    }
  }
  return s;
}

function setLang(lang) {
  currentLang = lang;
  try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch { /* ignore */ }
  location.reload();
}

// Walks every element carrying a data-i18n* attribute and fills it in from
// the dictionary — covers the three shapes static markup needs: plain
// text content, a placeholder, or (for the one spot with an embedded
// <span>, the login modal's intro line) raw trusted HTML we authored
// ourselves rather than user input.
function applyStaticTranslations() {
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
}

function initLangSwitcher() {
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === currentLang);
    btn.addEventListener('click', () => {
      if (btn.dataset.lang !== currentLang) setLang(btn.dataset.lang);
    });
  });
}

applyStaticTranslations();
initLangSwitcher();
