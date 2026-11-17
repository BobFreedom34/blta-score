# BLTA / SLTA design system

Three small systems that every page of the site follows. They are written down as **CSS variables and ready-to-use classes** at the end of
`public/css/style.css` (search for `DESIGN SYSTEM`), and described here.

| # | System | File | What it settles |
|---|---|---|---|
| 1 | **Fonts** | [fonts.md](fonts.md) | one family, one size scale (12 / 14 / 16 / 18 / 20 / 28 / 38 px), weights, roles of text |
| 2 | **Colours** | [colors.md](colors.md) | three text greys, what orange and lime mean, two surfaces, one border, chips, controls, the link arrow |
| 3 | **Gaps** | [gaps.md](gaps.md) | one spacing scale (4 … 64 px), the gap between sections, titles, cards, padding, columns |

Open **[preview.html](preview.html)** to see all three on one page (it uses the real stylesheet, so it is always up to date).

## Where it is used today

- **Applied:** the home page, the footer and the bottom bar of every public page, window titles (`.modal h3`), the `button`/`input` font.
- **Not yet applied:** every other page still has its own older sizes, gaps and greys (see "Moving a page over" below). Nothing is broken there; they just do not follow the system yet.

## Using it on a new page (the short version)

1. Use the classes in your HTML — `.t-section`, `.t-body`, `.text-2`, `.chip`, `.control`, `.ds-section`, `.ds-card`, `.ds-grid--3` … (full list in each part).
2. In your own CSS, never write a raw `px`, `#hex` or `rem` for these things — use the variables: `var(--fs-sm)`, `var(--text-2)`, `var(--sp-4)`, `var(--tile-border)`.
3. Pick the nearest value on the scale. If nothing fits, the scale is probably right and the design needs adjusting — do not add a new size.
4. Check the page at 375, 768 and 1440 px: no horizontal scroll, nothing under 12 px, links and tabs at least 40 px tall.

## Moving an old page over

1. Replace font sizes with the scale: 9 / 10 / 10.5 / 11 / 11.5 → **12**, 12.5 / 13 / 13.5 → **14**, 15 / 17 → **16** (or **18** for a person's name), 19 → **20**.
2. Replace greys: `#d3d6dc`, `#aeb2ba`, `#b8bcc4`, `#a9adb6` → `var(--text-2)`; `#8d929c`, `#9aa0aa` → `var(--text-3)`.
3. Replace gaps: 88 / 68 / 44 / 40 → `var(--sec-gap)`; 14 → `var(--title-gap)`; 12 / 24 between cards → `var(--card-gap)` / `var(--block-gap)`.
4. Give every card `var(--tile-border)` and the same padding (`.ds-card`); every chip `.chip`; every tab or button `min-height: var(--control-h)`.
5. Write the changes as selectors of that page, in the same style as the "APPLIED TO THE HOME PAGE" rules, so the old rules can be deleted later.

## Rules that are decisions, not taste

- **Nothing readable under 12 px.** Smaller text fails on phones and for people with weaker eyesight.
- **One corner for every control** (`--radius-sm`, 8 px): buttons, tabs, chips, inputs. Cards and tiles use `--radius` (16 px). Only circles are round.
- **Orange = do something / selected / live. Lime = status and result.** Do not use lime to mean "selected".
- **One arrow for links to another page of the site: ↗**, drawn by CSS (`.ds-link`), never typed into the text.
- **A link says where it goes** to a screen reader even when its text is short: give it `aria-label="<section> – <text>"`.

## Known gaps

- The font **weights** are defined (`--fw-*`) but the home page still uses 800 for almost everything. The target roles are in [fonts.md](fonts.md).
- The segmented switch in "Vaša dostupnosť" has a **lime** selected segment (an explicit request), which breaks "selected = orange". Decide one way and change one line.
- Touch targets under 44 px (carousel dots, text links) are not fixed yet.
- **Contrast of white on orange is 3.2 : 1** (`#fff` on `#ff5500`): the live chip, the Registrácia button and the active tab. That passes for large bold text (3 : 1) but not for 12 px labels (4.5 : 1 needed). Options: dark text (`#0a0a0a`, 6.5 : 1) on orange chips, or a darker orange (`#e04a00` is 4.0 : 1, still short). Not changed yet; decide once for the whole site.
