# Šablóny textov a editor e-mailu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pomenované šablóny (karta = živý náhľad + upraviteľné HTML) vložiteľné do textov Propozícií, Info a Blogu cez jeden spoločný editor; e-mail dostane vlastné prvky a editor so živým náhľadom.

**Architecture:** Jedna knižnica šablón (`public/js/text-templates.js`) a jeden editor (`public/js/rich-editor.js`) nahradia dve kópie editora v Rules/Info a textarea v Blogu. Server-side čističe HTML (`src/rules.js`, `src/htmlSanitize.js`) dostanú zdieľanú pomôcku `src/templateStyle.js`, ktorá povolí len bezpečný `style` (farby). E-mailový renderer `dress()` v `src/welcomeEmail.js` sa rozšíri o prvky a server vykresľuje náhľad rovnakým kódom ako e-mail.

**Tech Stack:** Node.js + Express + better-sqlite3 (vanilla JS v `public/js`), kontroly ako `scripts/check-*.js` (spúšťa ich `npm test`; jednotlivo `npm test -- <časť názvu>`).

**Spec:** `docs/superpowers/specs/2026-11-19-text-templates-design.md`

## Global Constraints

- Šablóny sú len z existujúcich prvkov webu (`style.css`: `pr-note`, `pr-list`, `pr-list num`, `pr-sub`, `pr-cats/pr-cat`, `pr-points/pr-pt`, `pr-coef`, `pr-cycles/pr-cycle`, `pr-table`, `grey-tile`, `black-tile`).
- Vložený blok je obyčajný HTML; zmena šablóny sa do už vložených blokov nepremieta.
- Karta šablóny: vizuálny náhľad a upraviteľné HTML vedľa seba; to, čo je v HTML poli, sa vloží.
- Čističe nikdy nepustia: skript, `on*` atribúty, `javascript:`/`data:` adresy, `url(`/`expression(` v štýle, cudzie triedy.
- Povolený `style` len pre `color`, `background`, `background-color`, `border-color`, `border-left-color`; hodnoty len `#hex`, `rgb()/rgba()/hsl()`, `var(--…)`, názov farby.
- E-mail: inline štýly a tabuľky, žiadne CSS triedy; editor e-mailu len pre super admina (ako teraz).
- Názvy šablón SK + EN; texty backendu sú anglicky (ako ostatný backend).
- Windows, bez Pythonu; commit končí `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Zmena dizajnu na turnaji/lige sa týka oboch; tu sa tých stránok nedotýkame.

## Review Focus

- `style="color:red;background:url(http://x)"` v šablóne: `url(` časť zmizne, bezpečná časť ostane.
- Šablóna s nezatvoreným tagom alebo `<script>` vo vloženom HTML: po uložení vyvážená a bez skriptu (Rules aj Blog).
- Starý blogový článok bez tried a Propozície uložené pred zmenou sa po novom čističi nezmenia (regresia).
- Admin mesta (CITY) smie upravovať Rules/Info/Blog so šablónami, ale `/api/welcome-email/*` mu vráti 403.
- E-mailový riadok `[Klik](javascript:alert(1))` sa nevykreslí ako odkaz; `---` v strede vety sa nezmení na oddeľovač.
- Šablóna vložená v SK aj EN paneli a pri zobrazení zdroja HTML sa nestratí (prepínanie vizuálne/HTML).

---

### Task 1: Bezpečný štýl a rozšírené čističe

**Files:**
- Create: `src/templateStyle.js`
- Modify: `src/rules.js` (`sanitize`, riadky ~75–125), `src/htmlSanitize.js` (`sanitizeHtml`, `ALLOWED`, `ATTRS`, `RENAME`)
- Test: `scripts/check-text-templates.js` (nový; čisté jednotkové testy bez servera, štýl ako `scripts/check-footer.js`: `test(name, fn)` + `assert`)

**Interfaces:**
- Produces: `safeStyle(css: string) -> string` (prázdny reťazec, ak nezostalo nič povolené); `TEMPLATE_CLASS: RegExp` (`pr-*`, `grey-tile`, `black-tile`, `win|bad|yes|no|elite|nextgen|novice|num`).
- Consumes: nič.

- [ ] **Step 1: Failing tests v `check-text-templates.js`** (importuje `../src/templateStyle`, `../src/rules` pre `sanitize`, `../src/htmlSanitize` pre `sanitizeHtml`; `process.env.DATA_DIR` na dočasný priečinok pred require `rules`):
  - `safeStyle keeps allowed colours`: `safeStyle('color:#b2fa06;background:rgba(178,250,6,.12)') === 'color:#b2fa06;background:rgba(178,250,6,.12)'`
  - `safeStyle drops url(), expression() and unknown properties`: `safeStyle('background:url(http://x);position:fixed;color:red') === 'color:red'`
  - `rules.sanitize keeps a pr-note with a colour`: vstup `<p class="pr-note" style="border-left-color:#b2fa06">A</p>` sa nezmení
  - `rules.sanitize drops script and onclick`: `<p onclick="x()">A<script>1</script></p>` neobsahuje `script` ani `onclick`
  - `sanitizeHtml keeps template classes and divs`: `<div class="pr-cats"><div class="pr-cat novice">N</div></div>` ostane
  - `sanitizeHtml drops foreign classes and style url`: `<p class="evil" style="background:url(x)">A</p>` → `<p>A</p>`
  - `sanitizeHtml leaves an old article unchanged`: `<h2>T</h2><p>Text <a href="/x">l</a></p>` ostane rovnaké
- [ ] **Step 2: Run** `node scripts/check-text-templates.js` — očakávané FAIL (modul chýba).
- [ ] **Step 3: Implement `safeStyle` a `TEMPLATE_CLASS` v `src/templateStyle.js`.** Rozdeliť podľa `;`, vlastnosť na malé písmená, hodnotu overiť regexom farby; všetko ostatné zahodiť.
- [ ] **Step 4: `rules.js` `sanitize`: pri tagu čítať aj `style=` cez `safeStyle` a `class` cez `TEMPLATE_CLASS` (nahradí `CLASS_OK`). `htmlSanitize.js`: do `ALLOWED` pridať `div`, `span`; z `RENAME` ich vyradiť; pri každom povolenom tagu povoliť `class` (filtrované `TEMPLATE_CLASS`) a `style` (cez `safeStyle`).**
- [ ] **Step 5: Run** `node scripts/check-text-templates.js` — všetko PASS; `npm test -- blog` a `npm test -- rules` — PASS (regresia).
- [ ] **Step 6: Commit** `git add src/templateStyle.js src/rules.js src/htmlSanitize.js scripts/check-text-templates.js` — `Safe template classes and colours in the text sanitizers`.

### Task 2: Knižnica šablón zo skutočných prvkov

**Files:**
- Create: `public/js/text-templates.js`
- Modify: `scripts/check-text-templates.js`

**Interfaces:**
- Produces: `window.TEXT_TEMPLATES: Array<{ id: string, name: { sk: string, en: string }, html: string }>` (v Node `module.exports` rovnaké pole).
- Consumes: Task 1 čističe (test).

- [ ] **Step 1: Failing test `every template survives both sanitizers unchanged`:** pre každú šablónu `rules.sanitize(t.html) === t.html` a po zjednodušení medzier rovnako `sanitizeHtml`; `ids are unique and names have sk and en`; `there are at least 9 templates`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement šablóny** presne z HTML, ktoré už používa uložený text Propozícií (`src/rulesSeed.js`): `note` (`<p class="pr-note">…`), `note-green` (`pr-note` + `style="border-left-color:#b2fa06;background:rgba(178,250,6,.12)"`), `list` (`pr-list`), `list-numbered` (`pr-list num`), `subheading` (`h3.pr-sub`), `categories` (`pr-cats` s tromi `pr-cat novice|nextgen|elite`), `points` (`pr-points`/`pr-pt`), `coefficients` (`pr-coef`), `cycles` (`pr-cycles`/`pr-cycle`), `table` (`pr-table`), `grey-tile`, `black-tile`. Ukážkový text v SK, názvy SK/EN.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `Library of text templates built from the existing page elements`.

### Task 3: Spoločný editor a karta šablóny; Rules a Info naň prejdú

**Files:**
- Create: `public/js/rich-editor.js`
- Modify: `public/js/rules-admin.js` (lišta ~32, obsluha ~181–266), `public/js/about-admin.js` (lišta ~51, obsluha ~165+), `public/rules-admin.html`, `public/about-admin.html` (pridať `<script>` pre `text-templates.js` a `rich-editor.js` pred ich skripty), `public/css/style.css` (nový blok `.tpl-*` na konci)
- Test: `scripts/check-text-templates.js` (serverový test cez `/api/rules`; pomocné `as()` a prihlásenie admina z `check-footer.js` skopírovať)

**Interfaces:**
- Produces: `RichEditor.toolbarHtml(): string` (tlačidlá B, I, H, zoznamy, Link, Clear, `Template`, `</> HTML`); `RichEditor.bind(host: HTMLElement, opts: { editorSel, sourceSel }): void` (jedna delegovaná obsluha lišty); `RichEditor.openTemplatePicker(onInsert: (html: string) => void): void`.
- Consumes: `window.TEXT_TEMPLATES` (Task 2).

- [ ] **Step 1: Failing test `a template saved to a rules section comes back unchanged`:** admin `POST /api/rules`, `PUT` s `html` = ľubovoľná šablóna z knižnice, `GET /api/rules` vráti rovnaké HTML (a `…<script>` verzia vráti bez skriptu).
- [ ] **Step 2: Run** — PASS len ak Task 1 hotový; inak FAIL (ukazuje, čo čistič zahadzuje).
- [ ] **Step 3: Implement `rich-editor.js`.** Lišta a obsluha sa presunú z `rules-admin.js`/`about-admin.js` (rovnaké `execCommand`, `tidy`, prepínač zdroja HTML). Nové tlačidlo `Template` otvorí okno: mriežka kariet, každá karta = ľavá časť `div` s živým náhľadom (`innerHTML` z textarea) a pravá časť `textarea` s HTML (upraviteľné, náhľad sa obnovuje pri písaní); tlačidlo `Insert` vloží aktuálny obsah textarea do editora pri kurzore (`insertHTML`; v režime zdroja na pozíciu kurzora v textarea). Okno sa zatvára Esc/krížik.
- [ ] **Step 4: Prepísať `rules-admin.js` a `about-admin.js` tak, aby volali `RichEditor`; odstrániť zdvojený kód.** Správanie ostáva rovnaké (uloženie, kopírovanie z mesta).
- [ ] **Step 5: Run** `npm test -- text-templates` a `npm test -- rules` — PASS. Vizuálne cez `preview_start` (`blta-score-dev`): /rules-admin, okno šablón, vloženie šablóny, zmena farby v HTML karte sa prejaví v náhľade; screenshot.
- [ ] **Step 6: Commit** — `Shared rich editor with a template picker for Rules and Info`.

### Task 4: Blog dostane ten istý editor

**Files:**
- Modify: `public/js/blog-admin.js` (textarea pre `bodySk`/`bodyEn`, ~riadky 66–80), `public/blog-admin.html` (skripty)
- Test: `scripts/check-text-templates.js`

**Interfaces:**
- Consumes: `RichEditor.toolbarHtml()`, `RichEditor.bind(...)`, `sanitizeHtml` (Task 1).

- [ ] **Step 1: Failing test `a blog article keeps template markup and loses scripts`:** admin vytvorí článok s `bodySk` obsahujúcim `categories` šablónu a `<script>`; prečítaný článok má šablónu a nemá `script`.
- [ ] **Step 2: Run** — FAIL ak Task 1 nie je spravený správne pre blog.
- [ ] **Step 3: Implement.** Telo článku (SK, EN) bude `contenteditable` s lištou; pri uložení sa pošle `innerHTML` (alebo obsah zdroja HTML, ak je zapnutý). Excerpt a SEO polia ostávajú textarea.
- [ ] **Step 4: Run** `npm test -- blog` a `npm test -- text-templates` — PASS; vizuálne /blog-admin a verejný článok (šablóny vyzerajú ako na Propozíciách, blog načítava `style.css`).
- [ ] **Step 5: Commit** — `Blog uses the shared editor with templates`.

### Task 5: Prvky e-mailu a živý náhľad

**Files:**
- Modify: `src/welcomeEmail.js` (`dress`), `src/routes/welcomeEmail.js` (nový `POST /preview`), `public/js/emails-admin.js` (karta: tlačidlá prvkov + iframe náhľad), `public/css/style.css` (malý blok pre rozloženie karty)
- Test: `scripts/check-text-templates.js` (jednotkové testy `dress` cez `welcomeEmail.render`)

**Interfaces:**
- Produces: `welcomeEmail.render(lang, { name, link }, bodyOverride?: string) -> { subject, text, html }` (tretí parameter slúži náhľadu, nič neukladá); `POST /api/welcome-email/preview` telo `{ lang, subject, body }` → `{ html }` (len super admin).
- Syntax riadkov: `# Nadpis`, `> Rámček`, `[Text](adresa)` (len `https://`, `mailto:` a cesty), `---`.

- [ ] **Step 1: Failing tests:**
  - `heading line renders a big title`: render s telom `# Ahoj\nText` obsahuje `font-size:26px` pre `Ahoj` a nie `# `
  - `box line renders a framed block`: `> Dôležité` obsahuje `border-left` a `Dôležité`
  - `button line renders a link button`: `[Profil](https://score.blta.sk/x)` obsahuje `href="https://score.blta.sk/x"` a `Profil`
  - `javascript button is not a link`: `[X](javascript:alert(1))` neobsahuje `href="javascript`
  - `--- in the middle of a sentence is plain text`: `A --- B` neobsahuje oddeľovač; samostatný riadok `---` obsahuje `<hr`/riadok s `border-top`
  - `preview endpoint is super admin only`: admin mesta dostane 403, super admin 200 s `html`
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Rozšíriť `dress()`** o štyri prvky pred existujúce pravidlá (krok/odrážka/tlačidlo-riadok/odsek ostávajú); `render` dostane voliteľné `bodyOverride` a použije ho namiesto uloženého textu. Route `/preview` volá `render` a vracia `{ html }`.
- [ ] **Step 4: UI v `emails-admin.js`:** pod každým textom lišta prvkov (Heading, Step, Bullet, Box, Button, Divider), ktoré vložia riadok na kurzor; vedľa textu `iframe` so `srcdoc` z `/preview` (obnova s oneskorením 400 ms pri písaní, SK/EN prepínač náhľadu). Tlačidlá Save a Test ostávajú.
- [ ] **Step 5: Run** `npm test -- text-templates` — PASS; vizuálne /emails-admin (potrebné admin prihlásenie): písanie mení náhľad; poslať test do vlastnej schránky a porovnať.
- [ ] **Step 6: Commit** — `E-mail elements and a live preview in Backend > E-mails`.

### Task 6: Súpis stránok s vlastným editorom a nasadenie

**Files:**
- Modify: podľa súpisu (iba ak nájde ďalšie texty s vlastným editorom, napr. FAQ `public/js/faq-admin.js`)

- [ ] **Step 1: Súpis.** `grep -ln "contenteditable\|<textarea" public/js/*-admin.js` a vypísať Robertovi, ktoré ďalšie texty majú editor (nerobiť zmeny bez jeho výberu).
- [ ] **Step 2: `npm test` (celé) a potom nasadiť až na Robertovo „deploy“** (`git push`, Render nasadí automaticky).

## Self-review

- Pokrytie spec: šablóny z existujúcich prvkov (T2), karta náhľad + HTML (T3), Rules/Info/Blog na jednom editore (T3–T4), čističe (T1), e-mailové prvky + živý náhľad (T5), ďalšie stránky (T6). Úprava šablón v backende a ostatné e-maily sú mimo rozsahu podľa spec.
- Rozšírenie oproti spec: bezpečný `style` (len farby), aby sa farby dali meniť v HTML karte; spec to vyžaduje („farby, ktoré čistič povolí“).
- Konzistencia: `TEMPLATE_CLASS` a `safeStyle` (T1) používajú T2–T4; `RichEditor` rozhranie (T3) používa T4; `render(..., bodyOverride)` (T5) je jediná zmena podpisu.
