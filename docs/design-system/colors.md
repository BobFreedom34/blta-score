# 2 · Colours and components

The site is dark. Colour carries meaning, so each colour has one job.

## Text

Three tiers, no more.

| Token | Value | Class | For |
|---|---|---|---|
| `--text-1` | `#ffffff` | `.text-1` | titles, names, numbers, anything that is the point |
| `--text-2` | `#c3c7cf` | `.text-2` | text that supports a title: descriptions, secondary lines, dates next to a name |
| `--text-3` | `#8b8f98` | `.text-3` | what only labels something: small captions, table heads, corner arrows |

Contrast on the dark cards: `--text-2` 8.2 : 1, `--text-3` 5.7 : 1 (WCAG AA needs 4.5 : 1).

Merged into these three (moving a page over): `#d3d6dc`, `#aeb2ba`, `#b8bcc4`, `#a9adb6` → `--text-2`; `#8d929c`, `#9aa0aa` → `--text-3`.
The nav link grey `#d8d8d8` and the article text (`--text-2`) are intentionally separate.

## Accents: what orange and lime mean

| Token | Colour | Means | Examples |
|---|---|---|---|
| `--action` (= `--orange`) | `#ff5500` | do something · selected · live | buttons, the active tab, links, "Prebieha", the Registrácia button |
| `--status` (= `--green`) | `#b2fa06` | status and result | planned date chips, the winner and the leader, "▲" movement, the LIGA tag |

Rules: **selected is orange, never lime.** A link is orange. A running match is orange (it needs action: watch it). A finished match is grey.
Red (`#ff7a6e`, `#ff3b3b`) is only for a fall in the ranking and for "overdue".

## Surfaces and the one border

| Surface | Class | Looks like | For |
|---|---|---|---|
| **Black tile** ("čierna dlaždica") | `.black-tile` | black, a faint lighter corner at the bottom right | lists and data: results, ranking, awards, blog cards |
| **Grey tile** ("sivá dlaždica") | `.grey-tile` | grey gradient | numbers and facts: stat tiles, "most improved", info boxes |

Every tile and card has the same border: `border: 1px solid var(--tile-border)` (white at 18 %). The corner is `--radius` (16 px).
Hover on a tile that is a link: the border turns orange (`a.home-mv:hover`, `a.home-mine-cell:hover`).

Cards have **no glow**: no `box-shadow` in a colour. The old orange frame + orange glow of the dark cards (`.card-dark`, `.statistics-card`, `.h2h-card`, `.player-bio-card`) is replaced by the grey border on the player page.
The **labels** of facts ("Kategória", "Raketa" …) are `--text-3`, not orange: orange means action.

## Chips

24 px high, 8 px corners, 12 px UPPERCASE, 12 px of side padding. The colour says what it is.

```html
<span class="chip chip--live">Prebieha</span>      <!-- running: orange -->
<span class="chip chip--date">Št 19.11. 10:00</span> <!-- planned: lime outline -->
<span class="chip chip--done">Ukončená</span>      <!-- finished: grey -->
<span class="chip chip--button">Zahrať</span>      <!-- works like a button: 28 px -->
<span class="chip chip--league">Liga</span>      <!-- a league / series: green veil -->
<span class="chip chip--tournament">Turnaj</span> <!-- a tournament: orange veil -->
```

Tokens: `--chip-h` 24 px, `--chip-btn-h` 28 px.

## Controls

A tab or a button is at least **40 px** tall (`--control-h`), corners 8 px (`--radius-sm`).

```html
<button class="tab control">Elite</button>
```

Round (`999px`) corners are only for circles and dots — the footer's city pills were the last exception and are now 8 px too.

## Links

- A link to another page of the site is short and ends with **↗**: `.ds-link` ("Všetko", "Všetci", "Rebríček", "Rezervovať").
- The arrow is drawn by CSS (`::before`, `content: '\2197\FE0E'`). Montserrat has no ↗, so a typed arrow came out tiny in a fallback font. **Never type the arrow into the text.**
- On a tile that is a link the same arrow sits grey in its top-right corner.
- Give a short link an accessible name: `aria-label="Posledné výsledky – Všetko"` (the home page does this in `secTitle()` in `public/js/match-rows.js`).

```html
<div class="ds-section-title">
  <h2 class="t-section">Posledné výsledky</h2>
  <a class="ds-link" href="/zapasy" aria-label="Posledné výsledky – Všetko">Všetko</a>
</div>
```

## Decisions still open

- The selected segment of the switch in "Vaša dostupnosť" is **lime** (requested explicitly). By the rule above it should be orange. Change one line in `style.css`:
  `:is(#my-post-card, .modal) .mode-switch button.active { background: var(--action); color: #fff; }`.
