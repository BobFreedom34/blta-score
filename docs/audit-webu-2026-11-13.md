# Audit webu BLTA / SLTA – 13. 11. 2026

Preskúmané: **blta.sk** (hlavná stránka, liga Bratislava), **slta.sk** (národná stránka) a zdrojový kód aplikácie. Metódy: merania cez `curl` a Chrome na živom webe, kontrola hlavičiek, HTML, `npm audit`, prehliadka kódu. Nič som nemenil, ide o zoznam zistení a odporúčaní.

Poznámka: blta.sk aj slta.sk obsluhuje **jedna a tá istá aplikácia** (Node na Renderi za Cloudflare). `score.blta.sk` už neexistuje.

## 1. Zhrnutie

| Oblasť | Stav | Hlavné slovo |
|---|---|---|
| Rýchlosť servera | dobrá | odozva 110 – 280 ms, Brotli, HTTP/3 |
| Rýchlosť frontendu | stredná | veľké nezminifikované CSS/JS, bez dlhej cache, jeden API výstup má 1,9 MB |
| Zabezpečenie | dobrý základ, 2 vážne diery | heslo super admina sa dá brute-forcovať, zraniteľné závislosti |
| SEO | dobré, 2 chyby | rozbitý `og:image` na blta.sk, `twitter:card` |
| Kód a prevádzka | dobré | 117 testov, CI, denné zálohy |

**Najdôležitejších 5 vecí:**
1. Heslo super admina nemá žiadne obmedzenie pokusov (§3.1).
2. `og:image` na blta.sk vracia 404, zdieľanie odkazu nezobrazí obrázok (§4.1).
3. `/api/matches` vracia 1,9 MB a úvodná stránka ho volá viackrát (§2.1).
4. `npm audit`: 9 zraniteľností (2 vysoké), oprava je dostupná (§3.3).
5. CSS/JS sa pri každej návšteve overujú a nie sú v cache dlhodobo (§2.2).

## 2. Rýchlosť

### Čo funguje dobre
- Odpoveď servera (TTFB) 110 – 280 ms, zvyšok z Cloudflare (Viedeň), HTTP/3, Brotli.
- Úvodná stránka: 22 KB HTML (po kompresii), načítanie DOM za 0,75 s, plná load 1,7 s, žiadne posuny rozloženia (CLS 0).
- Obrázky nahrané adminmi majú cache 30 dní.
- Appka nezaspáva (Render Starter, bez studených štartov).

### Zistenia

| # | Zistenie | Závažnosť | Odporúčanie |
|---|---|---|---|
| 2.1 | `GET /api/matches` bez filtra vracia **1,95 MB** (79 KB komprimované) a trvá **0,8 s**. Úvodná stránka ho volá dvakrát (pre „zápasy tohto týždňa“ a ďalšie zoznamy). Zoznam rastie s každým zápasom. | **vysoká** | Zaviesť povinný `limit` a stránkovanie, vrátiť len potrebné polia, na serveri cachovať odpoveď na 30 – 60 s. |
| 2.2 | CSS a JS majú `Cache-Control: public, max-age=0`: prehliadač ich pri každej návšteve overuje (304), alebo sťahuje znova. `cf-cache-status: DYNAMIC`, Cloudflare ich nekešuje. | **vysoká** | Pridať verziu do URL (`style.css?v=hash`) a dať `max-age=31536000, immutable`; v Cloudflare pravidlo na cache statiky. |
| 2.3 | `style.css` má **482 KB** surového textu (7 000 riadkov, 104 KB po Brotli), `common.js` 4 700 riadkov (73 KB), `i18n.js` 55 KB. Všetko sa načíta na každej stránke, bez minifikácie. | stredná | Minifikácia (esbuild, 1 príkaz v `buildCommand`), rozdelenie CSS na spoločné + stránkové, načítanie `i18n` len pre aktívny jazyk. Čakaný zisk 40 – 60 %. |
| 2.3b | 9 skriptov na úvodnej stránke je bez `defer`; blokujú vykresľovanie. | stredná | Pridať `defer` (poradie sa zachová). |
| 2.4 | Vlajky z externého `flagcdn.com` (900 – 1200 px SVG pre 15 px ikonu). | nízka | Mať ich lokálne alebo použiť emoji / malé SVG. |
| 2.5 | Fonty (Montserrat, 108 KB) bez `preload`. | nízka | `<link rel="preload" as="font" crossorigin>` pre latin variant. |
| 2.6 | Karusel obrázkov 1 200 – 1 500 px zobrazený v šírke ~1 030 px; prvý obrázok má `loading=auto`. | nízka | Prvý `fetchpriority=high`, ostatné lazy (už sú), WebP/AVIF. |
| 2.7 | `/api/players` 58 KB nekomprimované, `/api/rankings` 5,5 KB. | nízka | Z hlavičiek ETag využiť 304, pridať krátku cache. |

### Poznámka o lagoch v Chrome
Lag, ktorý si hlásil, spôsobilo softvérové vykresľovanie v Chrome (WebGL hlásil „Microsoft Basic Render Driver“). Po zapnutí grafickej akcelerácie sa to opravilo. Aplikácia nebola príčinou.

## 3. Zabezpečenie

### Čo je dobré
- HTTPS všade, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
- Cookies sú podpísané, `httpOnly`, `sameSite=lax`, `secure` v produkcii.
- SQL cez pripravené dotazy (žiadna skladaná SQL s vstupom používateľa), žiadne `eval`.
- PIN hráčov je hashovaný (scrypt) a po 5 chybách sa účet zamkne.
- Nahrávanie súborov má limity veľkosti a filter typov. Admin stránky sú v `robots.txt` zakázané.
- `.env` a databáza nie sú v gite, záloha DB na Google Drive.
- WordPress-ové ciele (`wp-login.php`, `xmlrpc.php`) vracajú 404.

### Zistenia

| # | Zistenie | Závažnosť | Odporúčanie |
|---|---|---|---|
| 3.1 | **Prihlásenie super admina (`POST /api/admin/login` bez e-mailu) nemá žiadne obmedzenie pokusov** a heslo sa porovnáva obyčajným `!==`. Limit 8 pokusov je len pri adminoch miest. Kto uhádne heslo, ovláda všetko. | **kritická** | Rovnaký limit aj pre super admina, porovnávanie cez `crypto.timingSafeEqual`, dlhé heslo (20+ znakov), ideálne druhý faktor alebo prihlásenie povoliť len z vybraných IP (Cloudflare Access). |
| 3.2 | Limity pokusov (admin mesta, kontakt, registrácia, kliky sponzorov) používajú `req.ip`, resp. prvý záznam `X-Forwarded-For`. Bez `app.set('trust proxy')` je `req.ip` adresa proxy (všetci návštevníci majú rovnakú, takže jeden útočník vie zamknúť prihlásenie všetkým adminom miest) a `X-Forwarded-For` si útočník vie sám nastaviť (limit sa obíde). | vysoká | `app.set('trust proxy', 1)` a používať `CF-Connecting-IP`. |
| 3.3 | `npm audit`: **9 zraniteľností (2 vysoké)**: `multer` (DoS pri nahrávaní), `body-parser`, `nodemailer` (spracovanie adries), `qs`, `archiver`. Oprava je dostupná (`npm audit fix`, `archiver@8`). | vysoká | Spustiť `npm audit fix`, otestovať, nasadiť. Zapnúť Dependabot. |
| 3.4 | Prihlásenie hráča: kým si hráč nenastaví PIN, stačí **telefónne číslo**, a porovnáva sa len **posledných 6 číslic** (zámerne voľne). Účet bez PIN sa dá prevziať uhádnutím (10⁶ možností) alebo z nájdeného čísla. Odpoveď „číslo nie je v systéme“ navyše prezrádza, či účet existuje. | vysoká | Povinné nastavenie PIN-u pri prvom prihlásení (už je „pinSetupRequired“, dotiahnuť), porovnanie celého čísla, jednotná odpoveď pri neznámom čísle, limit pokusov podľa IP. |
| 3.5 | `POST /api/player/register`, `/forgot-pin`, `/request-admin-reset` nemajú limit. Dá sa zahltiť e-mailmi („bombing“) a vytvárať falošné účty. | stredná | Limit podľa IP a podľa čísla/e-mailu, jednoduchý CAPTCHA/honeypot (kontaktný formulár ho už má). |
| 3.6 | CSP obsahuje len `object-src`, `base-uri`, `frame-ancestors`. Nechráni pred vložením skriptu (XSS). V kóde je 397 použití `innerHTML`, väčšinou s `escapeHtml`, ale riziko je plošné. | stredná | Postupne zaviesť `script-src 'self'` (po vyčistení inline skriptov), začať v režime „report-only“. |
| 3.7 | `cors()` povolené pre všetky pôvody, Socket.IO `origin: '*'`. Dáta sú verejné a nepoužívajú sa cookies, takže riziko je nízke, ale zbytočne široké. | nízka | Obmedziť na vlastné domény. |
| 3.8 | `express.json()` s predvoleným limitom 100 KB, v poriadku. Chýba globálny rate limit na `/api`. | nízka | Všeobecný limit (napr. 300 požiadaviek za minútu na IP) cez Cloudflare pravidlo alebo `express-rate-limit`. |
| 3.9 | E-mail majiteľa (`NOTIFY_EMAIL`) je napísaný priamo v `render.yaml`. | nízka | Presunúť do premenných prostredia, ak sa repozitár niekedy sprístupní. |
| 3.10 | Nahrávané obrázky sa overujú podľa deklarovaného typu (MIME) klienta. | nízka | Overiť aj „magic bytes“ (prvé bajty súboru) a znova zakódovať obrázok. |

## 4. SEO

### Čo je dobré
- Jeden `<h1>` na stránke, `lang="sk"`, unikátne `<title>` a `description`, `canonical`, `hreflang` (sk/en/x-default), `robots` s `max-image-preview`.
- `sitemap.xml` (94 KB) s jazykovými alternatívami, `robots.txt` blokuje admin a API.
- Štruktúrované dáta (JSON-LD `SportsOrganization` + `WebSite`), OG a Twitter značky.
- Každý obrázok má `alt`. Správne 404 (stavový kód 404), HTTP → HTTPS a `www` → bez `www` presmerovania.

### Zistenia

| # | Zistenie | Závažnosť | Odporúčanie |
|---|---|---|---|
| 4.1 | **`og:image` na blta.sk vracia 404** (`/media/1793458544128-…jpg` sa na serveri nenašiel). Zdieľanie odkazu na WhatsApp, Facebook či Slack nezobrazí obrázok. (Na slta.sk funguje.) | **vysoká** | V Backende > Média znova nahrať obrázok a prepísať odkaz v Backende > SEO. Pridať kontrolu „existuje súbor“ pri ukladaní SEO. |
| 4.2 | `twitter:card` je `summary`, hoci obrázok je veľký. | stredná | `summary_large_image`. |
| 4.3 | `favicon.ico` vracia 404 (robot ho žiada vždy), `apple-touch-icon.png` tiež 404. | nízka | Pridať `/favicon.ico` a `/apple-touch-icon.png` (180×180). |
| 4.4 | Structured data sú len na úvodnej stránke. Turnaje, zápasy a ligy by mohli mať `SportsEvent` (dátum, miesto) pre bohaté výsledky v Googli. | stredná | Pridať `SportsEvent` na stránku turnaja a sezóny, `BreadcrumbList`. |
| 4.5 | Na starej adrese `score.blta.sk` ostali odkazy v `og:` meta na dvoch statických stránkach (`index.html`, `matches.html`) v zdrojoch. Na živom webe ich server prepisuje, ale súbory sú zastarané. | nízka | Prepísať na `blta.sk`. |
| 4.6 | Obsah stránok sa kreslí v JS. Hlavičky a SEO sú v HTML (server ich vkladá), ale zoznamy (zápasy, tabuľky) sa načítajú až po skripte. Google ich zvyčajne vyrenderuje, no ukazovateľ je pomalší. | stredná | Pre najdôležitejšie stránky (tabuľky, harmonogram) vložiť základný obsah do HTML na serveri. |
| 4.7 | Nová stránka `/funkcie` je v sitemape aj v SEO (OK). Obsah môže byť lepšie rozdelený na samostatné „vstupné“ stránky pre kľúčové slová (napr. „tenisová liga Bratislava“). | nízka | Pridať obsahové stránky (O lige, Ako sa prihlásiť, FAQ ako samostatná stránka). |

## 5. Prístupnosť a použiteľnosť

- Hook `impeccable` hlási nízky kontrast na statických súboroch; pri našich hlavných farbách (`#c4c4cc` na sivej, zelená na tmavej) je kontrast nad AA, ale audit v prehliadači s reálnymi farbami odporúčam (`/impeccable audit`).
- Odporúčam otestovať klávesnicu (Tab) a čítačku obrazovky, najmä pri oknách (modaly) a zvončeku, a pridať viditeľný `focus` štýl na všetky tlačidlá.
- Oznámenia „toast“ a notifikácie majú mať `aria-live`.
- Tlačidlá-ikony musia mať `aria-label` (väčšina ho má).

## 6. Kód a prevádzka

| # | Zistenie | Odporúčanie |
|---|---|---|
| 6.1 | 117 automatických kontrol, GitHub Actions. Posledné dni boli červené, lebo testy kontrolujú zdrojový kód a zmeny dizajnu ich rozbili. Opravy sú v commite `9521cbd`, treba ich nasadiť. | Po „deploy“ skontrolovať, že Actions sú zelené. |
| 6.2 | Veľké súbory: `style.css` 7 000, `common.js` 4 700, `db.js` 2 000, `routes/seasons.js` 1 700 riadkov. | Postupne rozdeľovať (CSS po stránkach, `common.js` na moduly). |
| 6.3 | Súbory majú zmiešané konce riadkov (LF/CRLF) medzi pracovnou kópiou a repozitárom. | Pridať `.gitattributes` (`* text=auto eol=lf`). |
| 6.4 | Databáza SQLite na jednom disku (1 GB) a jedna inštancia. Pri raste (viac miest) bude kritická, výpadok disku = výpadok služby. | Denná záloha už beží; otestovať obnovu zo zálohy a pridať monitoring (UptimeRobot/Better Stack na `/healthz`). |
| 6.5 | Žiadny prehľad chýb (Sentry) a metrík. | Pridať Sentry (free) alebo aspoň logovanie chýb s upozornením e-mailom. |
| 6.6 | `README.md` je zastaraný (spomína score.blta.sk, WordPress iframe). | Aktualizovať. |

## 7. Plán opráv podľa priority

**Ihneď (1 – 2 hodiny):**
1. Obmedzenie pokusov + `timingSafeEqual` pre super admina (§3.1) a `trust proxy` + `CF-Connecting-IP` (§3.2).
2. Opraviť `og:image` na blta.sk (§4.1) a `twitter:card` (§4.2).
3. `npm audit fix` a nasadiť s testami (§3.3).
4. Nasadiť opravené testy (§6.1).

**Tento týždeň:**
5. Stránkovanie a cache pre `/api/matches` (§2.1).
6. Verzie súborov v URL a dlhá cache, `defer` na skriptoch (§2.2, §2.3b).
7. Limity na registráciu a obnovu PIN-u, jednotná odpoveď pri neznámom čísle (§3.4, §3.5).
8. `favicon.ico`, `apple-touch-icon` (§4.3).

**Tento mesiac:**
9. Minifikácia a delenie CSS/JS, WebP obrázky (§2.3, §2.6).
10. Štruktúrované dáta `SportsEvent`, základný obsah v HTML pre tabuľky (§4.4, §4.6).
11. CSP `script-src` v režime report-only (§3.6).
12. Monitoring, Sentry, test obnovy zálohy (§6.4, §6.5).
13. Prístupnostný audit s klávesnicou a čítačkou (§5).

## 8. Čo som nemeral
- Skutočné Core Web Vitals od používateľov (bez Search Console / CrUX dát). Odporúčam pozrieť Search Console > Core Web Vitals a PageSpeed Insights pre `blta.sk`.
- Zaťažovací test, penetračný test prihlásených častí (Backend) a obnovu zálohy.
- E-mailové doručenie (SPF/DKIM/DMARC pre `score@blta.sk`), odporúčam skontrolovať v DNS.
