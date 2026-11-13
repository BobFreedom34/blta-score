# Funkcie aplikácie – pohľad používateľa

Zdroj textov pre stránku `/funkcie`. Stránku generuje `node scripts/build-funkcie.js`. Texty sú písané pre hráčov, divákov a organizátorov: čo aplikácia dokáže, nie ako je urobená.

## 1. Živé skóre a zápasy

| Funkcia | Popis |
|---|---|
| Skóre naživo | Zapni si zápas a skóruj ho veľkými tlačidlami priamo z kurtu. Každý bod sa okamžite zobrazí všetkým, ktorí zápas sledujú, bez obnovovania stránky. |
| Všetky formáty zápasov | Jeden set, na dva či tri víťazné sety, so super tajbrejkom namiesto rozhodujúceho setu, set do 4 alebo do 6 gemov s tajbrejkom. Aplikácia sama stráži pravidlá: gemy, sety aj tajbrejky. |
| Späť, pauza a časovač | Pomýlil si sa? Jedným klepnutím vrátiš posledný bod. Zápas môžeš zastaviť a neskôr pokračovať a celý čas ti beží prehľadný časovač. |
| Nedokončený zápas | Skreč, kontumácia, dážď alebo večerná tma? Zápas môžeš ukončiť tak, ako stojí, alebo ho dohrať inokedy a výsledok ostane správne zapísaný. |
| Výsledok dodatočne | Zápas si odohral bez telefónu? Výsledok po zápase jednoducho zadáš ručne, aj set po sete. |
| Rozhodca na kurte | Rozhodca dostane pri zápase svoj kód a môže skórovať zápas bez vlastného účtu v aplikácii. |
| Chat pri zápase | Pod každým zápasom je diskusia, kde sa hráči aj diváci môžu pozdraviť, dohodnúť sa alebo komentovať. Môžeš si zapnúť upozornenie, že zápas začal. |
| Fotky a video | K zápasu pridáš fotky a odkaz na stream alebo záznam, takže všetko o zápase nájdeš na jednom mieste. |
| Zdieľanie jedným klepnutím | Pošli zápas kamarátom cez WhatsApp alebo odkaz. Zobrazí sa pekný náhľad s výsledkom a každý ho môže sledovať naživo. |
| Vzájomná bilancia | Pri každom súperovi vidíš, ako ste spolu hrali doteraz: výhry, prehry a posledné zápasy. |
| Zmena ratingu po zápase | Hneď po zápase vidíš, ako sa ti zmenila úroveň aj body v rebríčku. |
| Zápas týždňa | Najzaujímavejší zápas týždňa sa zobrazí priamo na úvodnej stránke. |
| Štvorhra | Hraj štvorhry v páre. Aplikácia vedie vlastný rebríček a rating párov. |

## 2. Nájdi súpera a dohodni zápas

| Funkcia | Popis |
|---|---|
| Hľadám súpera | Zverejni, kedy máš čas a na akej úrovni chceš hrať. Ostatní hráči sa ti ozvú a ty si vyberieš, s kým sa zahráš. |
| Prihlás sa na cudzí termín | Vidíš, kto práve hľadá partnera, a jedným klepnutím sa prihlásiš. Autor ponuky ťa potvrdí alebo odmietne. |
| Dohodnutie termínu | Navrhni súperovi termín, on ho potvrdí alebo pošle iný. Tak sa dohodnete bez dlhého písania správ. |
| Nový zápas za pár sekúnd | Vyber súpera, formát, kategóriu a miesto, a zápas je naplánovaný. Odkaz hneď pošleš ďalej. |
| Súkromné správy | Napíš hráčovi priamo z jeho profilu. Konverzáciu môže prijať alebo odmietnuť, takže ťa nikto nezaplaví nechcenými správami. |
| Upozornenia na dôležité veci | Dostaneš oznam, keď ti súper navrhne termín, odpovie alebo zápas začne. |

## 3. Tvoj profil a štatistiky

| Funkcia | Popis |
|---|---|
| Vlastný profil | Fotka, kategória, raketa, forhend, bekhend, obľúbené sezóny a narodeniny. Na jednej stránke sa predstavíš ostatným hráčom. |
| Štatistiky zápasov | Odohrané zápasy, výhry a prehry, úspešnosť, sety, gemy, tajbrejky aj comebacky. Prepínaj medzi oficiálnymi ligovými zápasmi a všetkými zápasmi. |
| Úroveň courtIQ | Automatická hodnota tvojej úrovne na škále od 1,0 do 7,0. Počíta sa z výsledkov, ktoré skutočne odohráš, a zohľadňuje súpera aj to, ako tesný zápas bol. Vidíš aj jej vývoj v grafe. |
| Odznaky | Za zaujímavé úspechy dostávaš odznaky, napríklad prvá výhra, séria víťazstiev alebo zápas v špeciálny deň. Sú to malé ocenenia, ktoré motivujú. |
| Hráč mesiaca | Každý mesiac vyhlásime najlepšieho hráča aj hráča s najväčším pokrokom. Zobrazia sa na úvodnej stránke. |
| Moja sezóna | Na úvodnej stránke máš prehľad: ďalší zápas, forma, miesto v skupine, úroveň a koľko zápasov ti ešte ostáva. |
| Rivali | Aplikácia ukáže hráčov, s ktorými sa stretávaš najčastejšie, a vzájomnú bilanciu. |
| História zápasov | Všetky tvoje zápasy so skóre, súpermi a fotkami na jednom mieste. |

## 4. Rebríčky a tabuľky

| Funkcia | Popis |
|---|---|
| Celkový rebríček | Jedno bodové poradie všetkých hráčov ligy. Body za zápasy sa pripisujú automaticky. |
| Rebríčky kategórií | Samostatné poradia pre Elite, Next Gen a Novice, aby si súťažil s hráčmi tvojej úrovne. |
| Rebríček turnajov | Body z turnajov majú vlastné poradie. Víťazstvá z turnajov sa tak nestratia medzi ligovými zápasmi. |
| Pohyb v rebríčku | Vidíš, o koľko miest si sa posunul. Každý pondelok dostaneš oznam s číslom týždňa, napríklad „V 47. týždni si sa posunul o 3 miesta hore“. |
| Obhajoba bodov | Body v celkovom rebríčku platia 52 týždňov. Body zo zápasov odpadávajú postupne podľa dátumu zápasu a body z turnaja naraz po 52 týždňoch. Každý pondelok to aplikácia urobí sama a až potom vyhodnotí, kto sa posunul. Kto hrá pravidelne, o miesto neprichádza. |
| Bonus za umiestnenie automaticky | Keď sa skončí play-off alebo turnaj, víťaz, finalista a semifinalisti dostanú bonusové body podľa propozícií sami, bez ručného zadávania. Každé pripísanie je vidieť v zázname zmien bodov. |
| Rebríčky Race | Rebríčky Elite, Next Gen a Novice začínajú každý rok od nuly a ukazujú, kto bodoval v aktuálnom roku. |
| Rebríček tento týždeň | Prehľad lídra a najväčších pohybov za posledný týždeň. |
| Tabuľky skupín | Počas sezóny sa pri každej skupine priebežne ukazuje poradie hráčov a body. |
| Konečné poradie | Po skončení turnaja alebo sezóny vidíš výsledné umiestnenia všetkých hráčov. |
| Rebríčky miest | Porovnaj hráčov z rôznych miest Slovenska vedľa seba. |

## 5. Ligy a sezóny

| Funkcia | Popis |
|---|---|
| Ligy vo viacerých mestách | Každé mesto má vlastnú ligu so svojou stránkou, hráčmi, tabuľkami a kontaktom. Nájdeš ju na mape Slovenska. |
| Sezóny s fázami | Základná časť, potom play-off. Na stránke sezóny vidíš priebeh série, hráčov a odohrané zápasy. |
| Skupiny podľa úrovne | Hráči hrajú v skupinách pre svoju kategóriu. Môžu sa meniť a odstúpiť a tabuľka sa sama prepočíta. |
| Žreb do skupín naživo | Organizátor vytvorí prázdne skupiny a hráčov do nich rozdelí žreb pred kamerou. Skupiny vyjdú rovnako veľké a nasadení hráči idú „hadom“ (pri 4 skupinách A = 1 a 8, B = 2 a 7, C = 3 a 6, D = 4 a 5). Na stránke sezóny je tlačidlo na prehratie záznamu žrebu. |
| Zmena hráča po žrebe | Hráč odstúpi alebo ho nahradí iný? Aplikácia upozorní, že rozpis skupiny treba aktualizovať, a doplní len chýbajúce zápasy. Odohraté zápasy ostanú. |
| Harmonogram | Prehľadný kalendár ligy a turnajov na celý rok, aby si vedel, kedy sa čo hrá. |
| Rozpis zápasov | Pre každé kolo vidíš, kto s kým hrá a kedy. |
| Víťazi | Archív víťazov, finalistov a semifinalistov všetkých sérií, s fotkami z odovzdávania cien. |
| Pravidlá a propozície | Všetky pravidlá ligy a turnajov na jednom mieste: kategórie, bodovanie, termíny a štartovné. |
| Prihlásenie do sezóny | Zaregistruješ sa online na vybranú sériu a platbu vyriešiš cez odkaz organizátora. |

## 6. Turnaje

| Funkcia | Popis |
|---|---|
| Registrácia online | Prihlás sa na turnaj, vyber si kategóriu a vidíš, koľko miest je ešte voľných. Ak sa turnaj zaplní, aplikácia to ukáže. |
| Žreb, ktorý sa spraví sám | Nasadenie najlepších hráčov, náhodný žreb, švajčiarsky systém alebo skupiny, a potom vyraďovací pavúk. Organizátor si vyberie systém a zvyšok je na aplikácii. |
| Žreb naživo pred kamerou | Žrebovanie ako prezentácia, ktorú môžeš ukázať aj na YouTube. Odpočítavanie od 5, nasadení hráči idú na svoje miesta a ostatných určí náhoda pred očami divákov: svetlo behá po menách, spomalí a zastaví sa na vyžrebovanom hráčovi, ktorý preletí do skupiny alebo do pavúka. Pred začiatkom je na obrazovke zámok žrebu a na konci jeho kľúč, z ktorého sa výsledok dá zopakovať a overiť. Záznam žrebu môže ktokoľvek prehrať. Žreb naživo funguje pri turnajoch aj pri skupinách ligy. |
| Pavúk a útecha | Vyraďovací strom s výsledkami v reálnom čase. Hráči, ktorí vypadnú, môžu pokračovať v útešnej vetve. |
| Rozpis na viac kurtov | Aplikácia rozdelí zápasy medzi kurty a časy. Každý kurt môže mať vlastný názov, napríklad „Kurt 1“ alebo „Centrálny“. |
| Čo sa hrá na ktorom kurte | Divák vidí, ktorý zápas práve beží na ktorom kurte, a môže si pozrieť aj stream kurtu. |
| Štartovné a platby | Odkaz na platbu aj výška štartovného sú priamo pri turnaji. Organizátor vidí, kto zaplatil. |
| Zdieľanie víťazov | Po skončení turnaja jedným klepnutím zdieľaš víťazov ako príspevok v komunite. |
| Galéria | Fotky z turnaja na jednom mieste. |

## 7. Komunity a kluby

| Funkcia | Popis |
|---|---|
| Vlastná stránka komunity | Klub alebo partia má svoju stránku s logom, titulnou fotkou a odkazom na pozvánku. |
| Novinky a príspevky | Zdieľaj správy, fotky a výsledky. Ostatní reagujú, komentujú a označujú sa pomocou @mena. |
| Označovanie hráčov | Napíš @ a meno a hráč dostane upozornenie priamo v zvončeku aj na mobile. |
| Členovia a pozvánky | Pozvi hráčov odkazom alebo priamo z aplikácie. Ty rozhoduješ, kto sa pripojí, a môžeš žiadosti schváliť jedným klikom. |
| Vlastné turnaje a sezóny | Komunita si môže zorganizovať vlastný turnaj alebo ligu s rovnakými možnosťami ako veľké súťaže. |
| Rebríček komunity | Každá komunita má vlastné poradie s bodmi z jej turnajov a zápasov. |
| Súkromné aj verejné komunity | Nastav, kto komunitu vidí a ako sa dá pripojiť. |
| Spoločné upozornenia | Všetci členovia dostanú oznam, keď pribudne dôležitá novinka. |

## 8. Rezervácie kurtov

| Funkcia | Popis |
|---|---|
| Voľné kurty na týždeň dopredu | Vidíš, ktoré hodiny sú voľné na najbližších 7 dní. |
| Rezervácia jedným klikom | Vyber čas a kurt a je to tvoje. Rezerváciu môžeš kedykoľvek zrušiť. |
| Voľné čoskoro | Zoznam najbližších voľných termínov, ak sa chceš ísť zahrať ešte dnes. |
| Tenisové kurty | Prehľad kurtov a miest na hranie s fotkami, adresou a odkazmi. |
| Moje rezervácie | Prehľad všetkých termínov, ktoré máš rezervované. |

## 9. Správy a notifikácie

| Funkcia | Popis |
|---|---|
| Zvonček | Všetko dôležité na jednom mieste: nové odznaky, správy, návrhy termínov, pohyby v rebríčku, zmienky a novinky z komunity. Jedným klikom označíš všetko ako prečítané. |
| Upozornenia v mobile | Aj keď nemáš aplikáciu otvorenú, dostaneš upozornenie na dôležité veci: začiatok zápasu, správu alebo návrh termínu. |
| Súkromné správy | Rozprávaj sa s hráčmi priamo v aplikácii. |
| Upozornenia podľa zápasu | Pre vybraný zápas si zapneš oznam, keď začne. |
| Pripomienky | Aplikácia ti pripomenie napríklad blížiaci sa špeciálny deň pre tvoj odznak. |

## 10. Prenos a zdieľanie

| Funkcia | Popis |
|---|---|
| Skóre priamo do streamu | Organizátor si môže pridať prehľadné skóre ako grafiku k vysielaniu zápasu z kurtu. |
| Skóre na tvojom webe | Zápas, tabuľky, rebríčky alebo pavúk môžeš zobraziť na vlastnej webovej stránke. |
| Veľká obrazovka na turnaji | Rozpis všetkých kurtov a zápasov na jednej obrazovke pre televízor alebo projektor. |
| Odkaz na všetko | Každý zápas, turnaj aj pozvánka má vlastný odkaz, ktorý ľahko pošleš ďalej. |
| Náhľady v chatoch | Keď pošleš odkaz do WhatsAppu či na sociálne siete, zobrazí sa pekný náhľad s názvom a výsledkom. |

## 11. Appka v mobile

| Funkcia | Popis |
|---|---|
| Pridaj na plochu | Aplikáciu si pridáš na úvodnú obrazovku telefónu a otvára sa ako bežná appka, bez sťahovania z obchodu. |
| Slovensky aj anglicky | Celá aplikácia funguje v dvoch jazykoch a prepneš ich jedným klepnutím. |
| Vždy aktuálne | Nikdy nevidíš zastarané údaje. Skóre, rebríčky aj rozpis sa menia v reálnom čase. |
| Rýchle prihlásenie | Prihlásiš sa telefónnym číslom a svojím kódom. Bez hesiel, ktoré by si musel pamätať. |
| Funguje všade | Na telefóne, tablete aj počítači, s rovnakým prehľadným dizajnom. |
