# 3 · Gaps (spacing)

Every distance is a step of one scale. No 14, 22, 34, 40, 44, 68 or 88.

## The scale

| Token | px | Used for |
|---|---|---|
| `--sp-1` | 4 | tight: icon and text, a label over its line |
| `--sp-2` | 8 | small: between chips, a link under a title |
| `--sp-3` | 12 | a group title to its table, space between small elements |
| `--sp-4` | **16** | the standard: title to content, neighbouring cards, card padding |
| `--sp-5` | 24 | room: the top of the page header |
| `--sp-6` | **32** | blocks that have a title of their own; tabs over a timeline |
| `--sp-7` | **48** | between sections on a tablet and a phone |
| `--sp-8` | **64** | between sections on a computer |

## The named distances

| Token | Value | What |
|---|---|---|
| `--sec-gap` | 64 px (48 px at ≤ 900 px) | between two sections of a page. A 1 px grey line sits in the middle of it |
| `--title-gap` | 16 px | a section title to its content |
| `--card-gap` | 16 px | neighbouring cards and tiles |
| `--block-gap` | 32 px | rows of blocks that each have their own title |
| `--card-pad-y` / `--card-pad-x` | 16 px / 20 px (16 px at ≤ 480 px) | the padding of every card |

## Page rhythm

```
section
   ── 64 ──────────────── (grey line in the middle: 32 above it, 32 under it)
TITLE  ................ ↗ Všetko
   ── 16 ──
[ card ]  16  [ card ]  16  [ card ]
   ── 32 ──  (a block with its own title)
TITLE
```

## Classes

| Class | What |
|---|---|
| `.ds-section` | a section: `margin-top: var(--sec-gap)` and the grey line |
| `.ds-section-title` | the row with the title on the left and a `.ds-link` on the right; 16 px under it. The title may wrap onto two lines; the link keeps its place on the right |
| `.ds-card` | padding, the one border and the 16 px corner |
| `.ds-grid`, `.ds-grid--2/3/4` | a grid of cards, 16 px apart. 3 and 4 columns become 2 at ≤ 900 px, every grid becomes 1 column at ≤ 640 px |
| `.ds-blocks` | blocks that each have their own title: 32 px between rows, 16 px between columns |
| `.ds-gap-1` … `.ds-gap-8` | `gap` utilities from the scale |

```html
<section class="ds-section">
  <div class="ds-section-title">
    <h2 class="t-section">Rebríček hráčov</h2>
    <a class="ds-link" href="/rebricek" aria-label="Rebríček hráčov – Všetko">Všetko</a>
  </div>
  <div class="ds-grid ds-grid--3">
    <div class="ds-card black-tile">…</div>
    <div class="ds-card black-tile">…</div>
    <div class="ds-card black-tile">…</div>
  </div>
</section>
```

## Columns side by side

When blocks sit side by side and each has a title, a line and a card, make the column share its rows with the others (CSS **subgrid**), so
whatever wraps in one title, all the cards still start and end at the same height. The home page does it with:

```css
.home-sec > .home-cols > .home-col { display: grid; grid-row: span 2; grid-template-rows: subgrid; row-gap: 0; }
.home-sec > .home-cols > .home-col:has(> .home-col-sub) { grid-row: span 3; }   /* a column with a line under its title */
```

## In your own CSS

```css
.my-block   { margin-top: var(--sec-gap); }
.my-title   { margin-bottom: var(--title-gap); }
.my-cards   { display: grid; gap: var(--card-gap); }
.my-card    { padding: var(--card-pad-y) var(--card-pad-x); border: 1px solid var(--tile-border); }
```

## Old distance → new

| Old | New |
|---|---|
| 88 / 68 (section) · 44 / 34 (its line) | `--sec-gap` (the line is `calc(var(--sec-gap) / -2)`) |
| 14 (title to content) | `--title-gap` (16) |
| 12 / 16 between cards, 24 / 40 between blocks | `--card-gap` (16) / `--block-gap` (32) |
| padding 16 × 18 / 16 × 20 / 20 × 24 | `--card-pad-y` × `--card-pad-x` (16 × 20) |
