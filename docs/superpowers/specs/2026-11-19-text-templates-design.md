# Šablóny textov a editor e-mailu — dizajn

Dátum: 2026-11-19 · Stav: čaká na schválenie

## Zámer a prečo
Robert chce vedieť sám upravovať vzhľad textov (Propozície, Info, Blog, ďalšie textové stránky) a uvítacieho e-mailu bez zásahu programátora.
Hotové dizajnové prvky webu majú dostať názvy a dať sa vkladať do textov ako **šablóny**. E-mail dostane **vlastnú sadu prvkov** a editor
so živým náhľadom, ako e-mail bude vyzerať.

## Ciele
- Jedna knižnica pomenovaných šablón (názov SK/EN, náhľad, HTML), použitá vo všetkých textových editoroch webu.
- Tlačidlo „Vložiť šablónu“ v editore; vložený blok je obyčajný HTML, ktorý sa dá ďalej upravovať.
- Blog dostane vizuálny editor namiesto surového HTML poľa.
- Rules a Info prestanú mať každý svoju kópiu editora: spoločný editor.
- E-mail: editor s prvkami a živým náhľadom (pravá strana, rovnaké HTML, aké odíde).

## Nie ciele
- Žiadny blokový editor typu Notion; žiadne šablóny ako značky, ktoré sa dopĺňajú až pri zobrazení.
- Zmena šablóny neprepíše už vložené bloky (je to zámerný kompromis variantu 1).
- Úprava šablón v backende (zatiaľ sa šablóny menia v kóde). Editor šablón môže prísť neskôr.
- Ďalšie e-maily (pripomienka platby, reset kódu a pod.) v tejto etape; prvky e-mailu sa ale robia znovupoužiteľné.

## Anti-ciele (zlyhanie, aj keby to technicky fungovalo)
- Šablóna sa po uložení stratí alebo sa rozbije (čistič HTML ju zahodí).
- Cez šablóny by sa dal vložiť skript, štýl alebo cudzia trieda (otvorená diera v čističi).
- Editor e-mailu ukáže iný vzhľad, než aký príde do schránky.

## Obmedzenia
- Čističe HTML sú dva a rozdielne: `src/rules.js` `sanitize` (povolí tagy a triedy podľa `CLASS_OK`) a `src/htmlSanitize.js` `sanitizeHtml`
  (blog: žiadne triedy, žiadne div/span). Šablóny musia prežiť oba, bez rozšírenia na „všetko“.
- E-mail ignoruje CSS triedy: prvky musia mať inline štýly a tabuľkové rozloženie (`src/welcomeEmail.js` `dress`).
- Texty sú v SK a EN; šablóna má názov v oboch jazykoch, vložený text si píše autor.
- Backend je pre super admina aj pre admina mesta; editor e-mailu je len pre super admina (ako teraz).

## Prístupy (zvolený: 1)
1. **Vložené bloky (zvolené).** Najjednoduchšie a najbezpečnejšie, funguje so súčasnými editormi. Nevýhoda: už vložené bloky sa po zmene šablóny nemenia.
2. Šablóny ako značky v texte: zmena sa prejaví všade, ale úprava vo vizuálnom editore je ťažká a práca oveľa väčšia.
3. Plný blokový editor: najpohodlnejší, ale nahrádza všetky editory naraz, najväčšie riziko.

## Dizajn

### Knižnica šablón webu (`public/js/text-templates.js`)
Zoznam `{ id, name: {sk,en}, html }`. Každá šablóna používa len existujúce triedy webu (`pr-note`, `pr-list`, `pr-sub`, `grey-tile`, `black-tile`,
zelený závoj…). Prvá sada: Zelená poznámka (zelený závoj), Oranžová poznámka, Sivá dlaždica, Čierna dlaždica, Číslovaný zoznam,
Zelený zoznam, Podnadpis sekcie. Zoznam sa dá neskôr rozšíriť bez zmeny editora.

**Karta šablóny (schválené Robertom):** každá šablóna sa zobrazuje ako karta s dvoma časťami vedľa seba: **vizuálne zobrazenie** (živý náhľad) a **HTML**
(upraviteľné pole). Zmena v HTML (napr. farba) sa hneď prejaví v náhľade a vloží sa to, čo je v karte práve napísané. Rovnaká karta je aj pri už vloženom
bloku (zdroj HTML sa dá kedykoľvek dodatočne upraviť). Farby, ktoré kartu menia, musia byť z tých, čo čistič povolí (triedy/farby webu), inak sa pri
uložení zahodia; karta to ukáže hneď v náhľade.

**Zdroj šablón:** prvá sada sa vytvorí z toho, čo už Propozície a Info skutočne používajú: prvky z `style.css` (`pr-note`, `pr-list`, `pr-list.num`, `pr-sub`,
`pr-card`…) a opakujúce sa bloky z uloženého textu týchto stránok. Nič sa nevymýšľa nové; najprv sa urobí súpis použitých prvkov.

### Spoločný editor (`public/js/rich-editor.js`)
Vizuálny editor (contenteditable) s lištou: tučné, kurzíva, nadpis, zoznam, odkaz, zdroj HTML a **Vložiť šablónu** (menu s názvami a malým náhľadom).
Vyberie sa z už existujúceho kódu v `rules-admin.js` a `about-admin.js`; oba prejdú na tento editor. `blog-admin.js` ho dostane namiesto textarea
(zdroj HTML ostáva ako prepínač pre prípad potreby).

### Čističe
Povolený zoznam tried šablón je jeden (`src/templateClasses.js`) a oba čističe ho používajú. Blog povolí v `sanitizeHtml` `class` len z tohto zoznamu
a tag `div`; ostatné atribúty a tagy ostávajú zakázané. Testy: skript v šablóne, cudzia trieda, `style=`, `javascript:` stále zmiznú.

### E-mail
Telo e-mailu ostáva text po riadkoch (už uložený formát). Prvky e-mailu sú riadky s jednoduchou syntaxou, ktorú `dress()` vykreslí s inline štýlmi:
nadpis (`# Text`), očíslovaný krok (`1. Názov – text`), odrážka (`- text`), rámček (`> text`), tlačidlo (`[Text](adresa)` alebo `Popis: https://…`),
oddeľovač (`---`). Editor má tlačidlá, ktoré tieto riadky vložia, a **živý náhľad** vedľa textu: server vykreslí presne to isté HTML
(`POST /api/welcome-email/preview` → `{ html }`, zobrazí sa v iframe so `srcdoc`). Ostáva textová záloha (čistý text e-mailu).

### Kde to býva
Backend > Rules, Backend > Info, Backend > Blog (vizuálny editor so šablónami); Backend > E-mails (editor s náhľadom).
Ďalšie textové stránky: po prvom nasadení sa pozrieme, ktoré ešte majú vlastný editor, a dostanú ten istý.

## Moje rozhodnutia (nie Robertove, dá sa zmeniť)
- Syntax riadkov v e-maile namiesto blokového JSON: bez migrácie uložených textov, aj ručné písanie ostáva.
- Šablóny sa menia v kóde, nie v backende (jednoduchšie, bezpečnejšie; editor šablón až potom).
- Náhľad e-mailu vykresľuje server, nie prehliadač, aby nemohol vyzerať inak než reálny e-mail.

## Čo ostáva na stavbu
Presné HTML každej šablóny, vzhľad menu šablón, názvy tried v zozname povolených, dizajn tlačidiel lišty, poradie nasadenia
(1. spoločný editor + Rules/Info, 2. Blog, 3. e-mail s náhľadom).
