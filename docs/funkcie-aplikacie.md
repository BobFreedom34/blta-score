# BLTA Score – prehľad všetkých funkcií aplikácie

Aplikácia: **score.blta.sk / slta.sk** (Node.js + Express, SQLite, Socket.IO, bez build kroku).
Dokument zoskupuje funkcie do kategórií podľa toho, čo vidí hráč / divák, čo robí organizátor a čo je v Backende.
Stav k 12. 11. 2026.

---

## 1. Živé skórovanie a zápasy

| Funkcia | Popis |
|---|---|
| Plánovanie zápasu | Vytvorenie zápasu: hráči, kategória (Elite / Next Gen / Novice / Friendly), formát, miesto, termín |
| Formáty zápasu | Best of 1/3/5 setov, so super tiebreakom v rozhodujúcom sete, formáty do 4 gemov (útecha), **jeden set do 6 gemov s tajbrejkom pri 5:5** a ďalšie |
| Živé skórovanie | Veľké tlačidlá +1 / −1, späť (undo), pauza / pokračovanie, časovač zápasu |
| Pravidlá tenisu | Gemy, sety, tajbrejk, match-tiebreak – jediný zdroj pravdy v `matchEngine.js` |
| Ukončenie zápasu | Normálne, „ukončiť tak ako je“, skreč / kontumácia, neodohraný, „dohrať neskôr“ |
| Manuálny výsledok | Zadanie výsledku po zápase bez živého skórovania |
| Oprava po skončení | Admin môže opraviť skončený zápas, reštartovať ho alebo zmazať |
| Návrh termínu | Hráč navrhne termín, súper ho potvrdí / odmietne / navrhne iný (counter-propose) |
| Rozhodca | Zdieľaný 5-miestny kód → ovládanie živého skórovania ľubovoľného zápasu bez účtu hráča |
| Chat v zápase | Správy pod zápasom, upozornenie „oznám mi, keď sa zápas začne“ |
| Fotky zo zápasu | Nahrávanie a mazanie fotiek k zápasu |
| Video zápasu | Odkaz na YouTube / stream, prepojenie na zápas |
| Zdieľanie zápasu | Odkaz s náhodným tokenom (nehádateľný), WhatsApp, náhľadový obrázok (OG preview.png) |
| H2H | Vzájomná bilancia dvoch hráčov |
| Zmeny ratingu | Po zápase ukáže zmenu CourtIQ ratingu a bodov |
| Zápas týždňa | Vybraný zápas na úvodnej stránke |
| Štvorhra | Páry, rebríček a ratingy štvorhier |

## 2. Hráči a profil

| Funkcia | Popis |
|---|---|
| Zoznam hráčov | Vyhľadávanie, filtre, skrytí hráči |
| Profil hráča | Fotka, bio (kategória, národnosť, raketa, forehand/backhand, sezóny, narodeniny), história zápasov, štatistiky |
| Registrácia a prihlásenie | Telefónne číslo + PIN, nastavenie / reset PIN-u, žiadosť o reset od admina, e-mailový kód |
| Odznaky (badges) | Automaticky pridelené ocenenia (napr. počet výhier, dátum zápasu), ikona, definované v Backende |
| CourtIQ | Vlastný Glicko-2 rating z odohraných zápasov (s váhou rozdielu skóre), história a graf |
| Hráč mesiaca | Najlepší hráč a najväčší pokrok CourtIQ za posledný mesiac |
| Hľadám súpera | Ponuka voľného termínu, ostatní sa pripoja, autor schváli / zamietne |
| Zvonček (notifikácie) | Odznaky, zmienky (@), komunita, zápasy, návrhy termínov |
| Push notifikácie | Web push (PWA) na zápasy, správy, zmienky, novinky komunity |
| Súkromné správy | Konverzácie 1 na 1: žiadosť, prijať / odmietnuť, neprečítané |

## 3. Rebríčky a tabuľky

| Funkcia | Popis |
|---|---|
| Rebríčky BLTA | Celkový + závod Elite / Next Gen / Novice + Turnaje; body: výhra 2:0 = 3, 2:1 = 2, prehra 1:2 = 1, 0:2 = 0 × úroveň (Elite 10, Next Gen 7, Novice 4) |
| Zápis bodov (ledger) | Každé pridelenie sa eviduje → oprava / zmazanie zápasu vráti presne to, čo pridal |
| História a audit | Vývoj bodov hráča, kontrola ledgeru oproti pravidlám, ručná úprava (Points log) |
| SLTA rebríčky | Samostatné rebríčky pre slta.sk |
| Tabuľky sezóny | Skupiny / liga s bodovaním BLTA, WIN2, WIN1 |
| Záverečné poradie | Výsledné umiestnenia po turnaji |
| Hráči → rebríček komunity | Vlastný rebríček komunity / klubu s ručnými a automatickými bodmi |

## 4. Ligy, mestá a sezóny

| Funkcia | Popis |
|---|---|
| Mestá / ligy | Mestské ligy, vlastná stránka, kontakt, mapa Slovenska |
| Admini miest | Správcovia obmedzení na svoje mesto |
| Sezóny | Hlavná stránka sezóny: zápasy, skupiny, pavúk, hráči, galéria |
| Skupiny | Vytvorenie skupín, presun hráčov, import, odstúpenie a vrátenie hráča |
| Harmonogram | Spoločná šablóna riadku pre zápasy (jeden vzhľad pre sezóny aj klubové turnaje) |
| Plán zápasov | Automatické generovanie rozvrhu, ručné úpravy, nastavenia plánu |
| Odmeny / víťazi | Stránka víťazov, edície, bloky, miesta, fotky |
| Propozície | Pravidlá a podmienky ligy / turnaja |

## 5. Turnaje

| Funkcia | Popis |
|---|---|
| Registrácia na turnaj | Prihlásenie hráča, kapacity, kategórie, platba, pripomienky, export CSV |
| Žreb | Nasadenie (seeds), ručný i automatický žreb, švajčiarsky systém (Swiss), skupiny + návrh skupín |
| Pavúk (bracket) | Vyraďovací strom, zadávanie výsledkov, útecha (consolation), vlastné pavúky |
| Štvorhra na turnaji | Tvorba párov |
| Rozvrh turnaja | Kurty, časy, vlastné **názvy kurtov** (napr. Kurt 6, Kurt 1), streamy na kurty |
| Formáty zápasov v turnaji | Výber formátu pre kolá, skupiny, útechu |
| Body do rebríčka | Nastavenie bodov za umiestnenia / koeficienty pre komunity |
| Zdieľanie víťazov | Tlačidlo na stránke turnaja → príspevok víťazov v novinkách komunity |
| Záložky turnaja | Zápasy / Skupiny / Pavúk / Tabuľky, spodná lišta na mobile |

## 6. Komunity a kluby

| Funkcia | Popis |
|---|---|
| Komunita / klub | Vlastná stránka, logo, cover, PWA manifest a ikona, pozvánka (odkaz `/pozvanka/...`) |
| Členovia | Žiadosť / pozvanie, schvaľovanie, odmietnutie, odstránenie, role |
| Novinky (príspevky) | Text + obrázok, komentáre, reakcie, **@označenie hráča** (zvonček + push), úprava a mazanie |
| Udalosti | Turnaje a sezóny komunity, kopírovanie turnaja, vlastné názvy kurtov |
| Rebríček komunity | Vlastné body, ručné úpravy |
| Moderácia | Schvaľovanie príspevkov a členov, centrálny inbox schválení |
| Feed | Súhrn príspevkov zo všetkých mojich komunít |
| Pozvánky | Vyhľadanie kandidátov, pozvanie hráčov, hromadné pridanie |
| Admin posty | Super admin zdieľa ako „Admin“ |

## 7. Rezervácie kurtov

| Funkcia | Popis |
|---|---|
| Rezervácie | Voľné sloty kurtov, rezervácia / zrušenie hráčom |
| „Voľné čoskoro“ | Zoznam najbližších voľných slotov |
| Správa kurtov | Kurty, hromadné vytvorenie / úprava / zmazanie slotov, priradenie hráča |
| Nastavenia | Pravidlá rezervácií |

## 8. Miesta a kurty

| Funkcia | Popis |
|---|---|
| Miesta (venues) | Zoznam, detail, fotky, poradie |
| Stránky kurtov | `/courts`, `/court` – kurt, jeho plán a živý prenos |
| Cesty k kurtom | SEO cesty `court-paths` |

## 9. Obsah a web

| Funkcia | Popis |
|---|---|
| Úvodná stránka | Carousel, zápas týždňa, hráč mesiaca, sponzori |
| Carousel | Obrázky (desktop + mobil), poradie, zapnutie / vypnutie |
| Blog / články | Editor, obrázky, zoznam a detail |
| O lige / O nás | Texty po záložkách, per mesto |
| FAQ | Otázky a odpovede, zoradenie |
| Pravidlá | Pravidlá s kópiou, presunom, resetom |
| Sponzori | Logá, odkazy, počítanie klikov |
| Médiá | Knižnica médií |
| Pätička a hlavička | Úprava menu, položiek a pätičky |
| Kontakt | Kontaktné údaje, formulár „žiadosť o ligu“ |
| Jazyky | Slovenčina a angličtina (i18n) |
| Zoznam zmien | Verejný changelog |

## 10. Prenos, vysielanie a embed

| Funkcia | Popis |
|---|---|
| Overlay | `/overlay/:slug/:court` – skóre pre streamy (OBS) |
| Embed | `<iframe>` pre blta.sk: zápas, live zoznam, compact, rebríčky, pavúk |
| Obrazovky | `screen`, `schedule-screen` – veľké obrazovky na turnaji |
| Live prenos | Odkaz na stream kurtu, názvy kurtov v prenose |

## 11. Backend (admin)

| Záložka | Čo robí |
|---|---|
| Overview | Prehľad a rýchle akcie |
| Menu | Položky hlavičky |
| Badges | Definície odznakov |
| Players | Hráči: správa, PIN, telefón, fotky, skrytie |
| Brackets | Vlastné pavúky |
| Venues | Miesta |
| Cities | Mestá a ligy, admini miest |
| Seasons | Sezóny a ich nastavenia |
| Tournaments | Turnaje (oranžová karta, záložky Základné info, Formát, Žreb, Rozvrh…) |
| Communities | Komunity, moderácia |
| Reservations | Rezervácie kurtov |
| Blog | Články |
| SEO | Meta údaje, sitemapy, court paths (každá nová verejná stránka sa tu musí objaviť) |
| Carousel | Úvodný carousel |
| Rules | Pravidlá |
| Points log | Audit bodov |
| Login History | História prihlásení |
| Ďalšie | Sponzori, médiá, FAQ, pätička, O nás, tracking (analytika) |

## 12. Systém a technika

| Funkcia | Popis |
|---|---|
| Live aktualizácie | Socket.IO: zápas a zoznamy sa menia v reálnom čase |
| PWA | Manifest, ikony, service worker, inštalácia na mobil |
| Push | Web push (VAPID), per-hráč nastavenia |
| E-maily | Oznam o skončenom zápase, reset kódu (SMTP) |
| Záloha | Denná záloha SQLite na Google Drive |
| Súhlas (cookies) | Banner a tracking skripty podľa súhlasu |
| SEO | `robots.txt`, `sitemap.xml`, meta údaje z Backendu |
| Deploy | `git push origin main` → Render, SQLite na trvalom disku |
| Import | Synchronizácia hráčov a výsledkov z blta.sk (`/sync-player-bios`, `/sync-match-league`) |

---

### Poznámky
- Zoznam vychádza z API trás (`src/routes`), stránok v `public/` a modulov v `src/`. Niektoré názvy sú zjednodušené.
- Nie každá položka bola overená priamo v prevádzke (napr. zdieľanie víťazov na reálnej komunite).
