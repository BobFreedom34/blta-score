# 1 · Fonts

**One family: Montserrat** (self-hosted, `public/fonts/`). Buttons, inputs, selects and textareas inherit it
(`button, input, select, textarea { font-family: inherit }`), otherwise the browser draws them in Arial at 13.33 px.

## The scale

Seven sizes. Nothing a visitor has to read is smaller than 12 px.

| Token | px | Class | Use |
|---|---|---|---|
| `--fs-xs` | **12** | `.t-label`, `.t-small` | labels (UPPERCASE), table heads, chips, dates, small print, menu |
| `--fs-sm` | **14** | `.t-body` | secondary text, descriptions, tabs, links, footer text |
| `--fs-md` | **16** | `.t-text`, `.t-name` | body text, names, points, group titles, the intro |
| `--fs-name` | **18** | `.t-name-lg` | a person's name that is the point of its card (players of the month), a season subtitle |
| `--fs-lg` | **20** | `.t-section` | the title of a section, the title of a window |
| `--fs-xl` | **28** | `.t-number` | a big number (stat tiles) |
| `--fs-hero` | **38** | `.t-hero` | the H1 (26 px on a phone: `clamp(26px, 3.4vw, 38px)`) |

Not on the scale, by design: the **logo word** ("LIGA" 10 px, "BLTA" 22 px) and the **carousel arrows** (they are artwork, not text).

## Weights

| Token | Value | Role |
|---|---|---|
| `--fw-regular` / `--fw-medium` | 400 / 500 | body text, descriptions |
| `--fw-semi` | 600 | small print, notes |
| `--fw-bold` | 700 | labels, links, tabs |
| `--fw-heavy` | 800 | names, titles, numbers |
| `--fw-black` | 900 | the H1 |

> The home page does not use these roles yet: 54 elements are 14 px / 800 and 34 are 16 px / 800, so almost everything is "heavy".
> New pages should use the roles above (400–500 for reading text, 700 for labels and links, 800 only for names, titles and numbers).

## Letter-spacing and case

- An UPPERCASE label has `letter-spacing: var(--track-label)` (0.06 em): `.t-label`, `.t-section`.
- Titles of sections are uppercase (`.t-section`); the H1 is written in Title Case (`.t-hero`: "Bratislavská Liga Tenisových Amatérov").
- Text under 20 px is never uppercase unless it is a label.

## Classes

```html
<h1 class="t-hero">BLTA – Bratislavská Liga Tenisových Amatérov</h1>
<h2 class="t-section">Posledné výsledky</h2>
<div class="t-label text-3">Hráč mesiaca · Október</div>
<div class="t-name-lg">Michal Bori</div>
<p class="t-body text-2">Amatérska tenisová liga pre rekreačných hráčov v Bratislave.</p>
<div class="t-number">181</div>
```

## In your own CSS

```css
.my-title { font-size: var(--fs-lg); font-weight: var(--fw-heavy); letter-spacing: var(--track-label); text-transform: uppercase; }
.my-note  { font-size: var(--fs-xs); font-weight: var(--fw-semi); color: var(--text-3); }
```

## Old size → new size (moving a page over)

| Old | New |
|---|---|
| 8, 9, 9.5, 10, 10.5, 11, 11.5 | 12 |
| 12.5, 13, 13.5 | 14 |
| 15, 17 | 16 (18 for a person's name) |
| 19 | 20 |
| 22, 24, 26 | 20 or 28, whichever the role is (not the logo) |
| browser default `h3` 18.72 | 20 (`.modal h3` already is) |

The only exceptions on a page are decorative micro things (a dot, a sup/sub, a visually hidden label).
