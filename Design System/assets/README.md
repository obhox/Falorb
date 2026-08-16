# Assets

**There is no logo file in this design system.** None was supplied with the brief, and a brand mark must
never be reconstructed from memory or invented on a company's behalf. Wherever a logo would go, render the
wordmark in type:

```html
<span style="font-family:var(--font-sans);font-weight:600;letter-spacing:-.05em;color:var(--ink-0)">Falorb</span>
```

The dashboard and marketing kits pair it with a placeholder mark — a 22px white rounded square (6px radius)
holding a graphite "F" at 13px/600. That square is scaffolding, not a logo. Replace it as soon as real files
exist.

**Icons** are not stored here either: the system uses Lucide from CDN
(`https://unpkg.com/lucide@0.454.0/dist/umd/lucide.min.js`) through `components/core/Icon.jsx`. See the
ICONOGRAPHY section of `readme.md` for the substitution note. If Falorb has its own glyph set, add the SVGs
under `assets/icons/` and change `Icon.jsx` to resolve from there.

**Fonts** are CDN-linked in `tokens/fonts.css` (Instrument Sans, JetBrains Mono). Self-host by dropping
binaries in `assets/fonts/` and replacing that `@import` with `@font-face` rules.

**Imagery**: the brand uses none by design — charts and tables are the imagery. No stock photography or
illustration is shipped or expected.

## Needed from the brand owner

1. Logo / wordmark files (SVG preferred, plus a square mark if one exists).
2. Licensed font binaries, if the real faces differ from the substitutes.
3. The product's own icon set, if it has one.
