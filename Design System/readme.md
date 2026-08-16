# Falorb Design System

Falorb is self-hosted, first-party web analytics. One binary, one Postgres database, a 1.94 KB tracker, and
a dashboard that spans every property you own. The product's promise sets the whole visual brief: **open one
page and see all properties at a glance, then drill into a single human and read their entire history across
your portfolio.** Everything in this system is arranged to make dense figures legible and drill-downs feel
continuous.

## Sources given

- `uploads/original-623ea862f46ecbaac750984f8f919f78.webp` — a dark analytics dashboard used **for
  inspiration only** (not Falorb's product). What was taken from it: near-black canvas, floating rounded
  panels inset from the window edge, hatch-textured bars with a single solid highlight column, a glass
  hover card over the chart, oversized tabular figures, generous whitespace at high data density.
- Written brief: "Data-intensive, clean, very detailed and well spaced, prefers monotone if possible…
  modern and glassy and fluid."

No codebase, Figma file, logo files, font binaries, or slide template were provided. Everything below was
authored from the brief and is therefore a **proposal**, not a recreation. See CAVEATS at the bottom.

## Products represented

| Surface | UI kit | What it covers |
| --- | --- | --- |
| Dashboard app | `ui_kits/dashboard/` | All-properties overview → property detail → people list → person profile → settings |
| Marketing site | `ui_kits/site/` | Nav, hero, product shot, feature grid, install block, pricing, footer |

---

## Content fundamentals

**Voice.** Plain, technical, unhurried. Falorb talks like a competent operator explaining a tool to another
operator — specific numbers instead of adjectives, and never a superlative where a figure will do.

- Write "1.94 KB gzipped, no cookies", not "incredibly lightweight".
- Write "p95 query under 200ms at 8.4M retained events on two vCPUs", not "blazing fast".

**Person.** Second person for the reader's things, first-person plural only for the team's own commitments.
"Every property on one page." "Your data stays yours." "We run the instance in your region." Never "I".
Never "our powerful platform".

**Casing.** Sentence case for headings, buttons, tabs, and menu items — "Add property", "Show all",
"Person-level detail". The only uppercase in the system is the 11px tracked micro-label above a figure
(`UNIQUE VISITORS`). Domains, paths, event names, and IDs keep their literal casing in mono type.

**Numbers.** Always formatted before they reach a component: thousands separators, one decimal on
percentages, units split from the figure (`1.94` + `KB`). Deltas always carry a sign (`+8.7%`, `-6.3%`).
Durations are human (`1m 48s`, `41m ago`, `Yesterday`), never raw seconds.

**Empty and error states name the cause and the remedy.** Not "No data available" but "No sessions match
these filters — try widening the range to 30 days, or drop the country filter."

**Length.** Feature descriptions are one or two sentences. Field hints are one clause and explain a
consequence, not a definition: "Events are dropped at the edge, before the ingest queue."

**No emoji.** None, anywhere — not in UI, not in marketing copy, not in changelog entries. No exclamation
marks. No "🎉 You're all set!" moments; a confirmation is "Copied" for 1.4 seconds and then it's gone.

**Words Falorb uses:** property, person, session, event, ingest, retention, self-hosted, snippet, portfolio,
drill into. **Words it avoids:** users (say people), analytics platform (say analytics), leverage, unlock,
seamless, powerful, effortless, revolutionary.

---

## Visual foundations

**Monotone by rule.** One neutral ramp (`--ink-1000` → `--ink-0`, 16 steps) carries roughly 90% of every
screen. One accent, glacier cyan (`--glacier-400` #7DD3FC), marks exactly three things: the selected
element, the series in focus, and the focus ring. Green and red exist only as `--signal-up` / `--signal-down`
on deltas and status — never as decoration. There is no secondary brand colour and no gradient palette.

**Backgrounds.** Flat near-black (`--ink-1000`) at the shell, one step up (`--ink-900`) for floating panels,
another (`--ink-850`) for cards. No photography, no illustration, no repeating pattern, no noise or grain.
The single sanctioned "atmosphere" is one very low-opacity glacier radial glow behind the marketing product
shot (10% alpha, top-centre) — nowhere in the app. The only texture in the system is `--hatch`: a 135°
1px-on-6px white-5% stripe used to fill *inactive* chart volume, so the solid highlighted bar reads
instantly.

**Type.** Instrument Sans for everything that is words; JetBrains Mono for everything that is a value.
Display sizes are tracked in (−2.8%), body is −0.6%, figures −3%. Mono runs with `"tnum" 1,"zero" 1` so
columns of numbers align and 0 never reads as O. Micro-labels are 11px uppercase at +6% tracking, always
sitting above the figure they describe. Body copy holds at 14px/1.45 and never exceeds 66ch.

**Spacing.** 4px base with 2px half-steps, because table and control interiors need 6px and 10px. Panels sit
12px apart inside a 12px shell inset — Falorb panels *float*; they never touch the window edge. Panel
interior is 20px, card interior 16px. Data rows are exactly 38px, or 30px dense. Density comes from row
height, never from shrinking type below 11px.

**Corners.** Radius encodes scale: 4/6/8 for chips and inner blocks, 10 for controls, 14 for cards, 18 for
panels, 22 for the shell. A pill (999) is reserved for Tags, switches, and status dots.

**Cards.** Flat one-step-lighter fill, 1px `rgba(255,255,255,.06)` border, `--shadow-2`, and an inset 1px
top highlight. Never a coloured left border, never a gradient fill, never a drop shadow with hue. Hover
lightens the fill by one alpha step and strengthens the border; it does not lift or scale.

**Shadows.** Two layers, always: a soft dark spread downward plus `inset 0 1px 0 rgba(255,255,255,.06)` to
catch a top edge. Four levels — 1 hairline, 2 cards, 3 panels and popovers, 4 modals. Inner shadow is used
once, as the inset well behind inputs (`--surface-inset`, darker than its surface, which is how Falorb says
"you type here").

**Transparency and blur.** Glass is a recipe, never blur alone: `rgba(255,255,255,.045)` fill +
`1px rgba(255,255,255,.09)` border + `blur(20px) saturate(140%)`. It is used *only* for things floating over
data — chart hover cards, dropdown menus, modals, the sticky marketing nav, and the SegmentedControl thumb.
Static content is never glass, because blur over a flat background just costs paint time.

**Protection.** Text over a chart or texture gets `--scrim-bottom` (a bottom-up 92%→0 wash) or sits inside a
glass capsule. Falorb prefers the capsule in the app (it reads as a distinct object) and the scrim on the
marketing site.

**Animation.** Fluid settle, never bounce — no overshoot anywhere in the system. Four durations: 90ms hover
tint, 160ms control state and tooltip fade, 240ms panel and tab underline, 420ms chart draw-in and
drill-down. Curves: `--ease-out` for tints, `--ease-emphasis` (.16,1,.3,1) for anything that travels
(segmented thumb, modal rise, bar heights), `--ease-in-out` for reversible things. Lists reveal with a 32ms
per-row stagger. Tooltips fade only — no slide, no scale. All of it collapses to 0ms under
`prefers-reduced-motion`.

**Hover states.** Lighten, don't darken: surfaces go up one alpha step (`--w-4` → `--w-12`), muted text goes
to primary, icons inherit. Ghost controls materialise a background on hover instead of changing colour.
Interactive rows tint their share-fill glacier at 16%.

**Press states.** `translateY(0.5px) scale(0.994)` plus the next alpha step. No colour inversion, no ripple.

**Focus.** `0 0 0 3px rgba(125,211,252,.22)` plus a glacier border. Visible on keyboard focus only.

**Selection.** `--surface-selected` (glacier at 10%) with a hairline glacier border — used for the active
sidebar row, the selected table row, and the checked state of controls.

**Borders.** Hairlines only, always alpha-white so they work over any surface: 6% subtle, 8% default, 16%
strong, 5% for grid lines inside charts and tables. No 2px borders anywhere.

**Layout rules.** The dashboard is a fixed 224px sidebar plus a flexible main panel, both floating in a 12px
inset. Page headers are 52px and hold title + meta on the left, controls on the right. Tabs sit directly
under the header on a hairline. Content max-width 1440px; prose max 66ch. Tables scroll under a sticky 30px
header. Numeric columns are right-aligned and mono; the first column is the entity.

**Imagery.** There is none, by design — no stock photography, no illustration. The product's own charts and
tables are the imagery. If a real photograph is ever needed (team page, conference talk), it should be cool,
low-contrast, and desaturated so it sits inside the graphite palette.

---

## Iconography

**Lucide, 1.5px stroke, 16px default** (14px in dense tables, 15px in nav, 13px inside small buttons).
Rendered through the `Icon` component, which hydrates `<i data-lucide="…">` via the Lucide UMD script:

```html
<script src="https://unpkg.com/lucide@0.454.0/dist/umd/lucide.min.js"></script>
```

```jsx
<Icon name="globe" size={16} />
```

- **Substitution flag.** No icon set was supplied with the brief. Lucide was chosen as the closest match to
  the reference's thin, rounded, uniform-stroke glyphs. If Falorb has its own set, drop the SVGs into
  `assets/icons/` and swap the `Icon` implementation — nothing else needs to change.
- Icons are always `currentColor` and inherit the control's text colour; they never carry the accent on
  their own except inside a feature tile or a check mark.
- **No emoji, ever.** No unicode pictographs as icons either. The only non-Lucide glyphs in the system are
  typographic: `×` in a Tag's remove affordance, `✓` in a Select's chosen row, `·` as a meta separator,
  `↓`/`→` in sort and "show all" affordances, and `$` in a command prompt.
- No PNG icons. No icon font beyond the Lucide sprite. No hand-drawn one-off SVGs — the only inline SVG
  paths in the codebase are the chevron, checkmark, and delta arrow baked into three primitives, plus the
  data-driven chart paths in `Sparkline`.
- Country and property identity use text (`DE`, `docs.falorb.io`), not flag emoji or favicons.

**No logo was provided**, so no mark was drawn. Wherever a logo would sit, the system renders the wordmark
"Falorb" in Instrument Sans 600 at −5% tracking, optionally paired with a white 22px rounded square holding
a graphite "F" as a placeholder avatar-mark. `assets/` documents this. Real logo files are needed.

---

## Index

Root files:

- `styles.css` — the single entry point consumers link. `@import` lines only.
- `tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `radius.css`, `elevation.css`,
  `motion.css`, `semantic.css`, `base.css` (element resets, link colours, scrollbars, selection).
- `thumbnail.html` — homepage tile.
- `SKILL.md` — Agent Skills wrapper so this folder can be dropped into Claude Code.
- `guidelines/` — 20 foundation specimen cards (Colors, Type, Spacing, Brand groups).
- `assets/README.md` — asset inventory and the missing-logo note.

### Components

`components/core/` — **Button**, **IconButton**, **Icon**, **Badge**, **Tag**, **Card**, **GlassPanel**
`components/forms/` — **Input**, **Select**, **Checkbox**, **Switch**
`components/navigation/` — **Tabs**, **SegmentedControl**, **SidebarNav**
`components/feedback/` — **Dialog**, **Tooltip**, **EmptyState**
`components/data/` — **StatTile**, **DeltaPill**, **Sparkline**, **BarSeries**, **MetricBar**, **DataTable**
`components/charts/` — **ChartFrame**, **Legend**, **LineChart**, **StackedBars**, **DonutChart**, **FunnelChart**,
**SankeyDiagram**, **HeatmapGrid**, **RetentionMatrix**

Each has `<Name>.jsx`, `<Name>.d.ts` (props contract), and `<Name>.prompt.md` (what/when + usage). Every
directory carries one `@dsCard` showcase HTML.

**Charts.** `components/data/` holds the small in-line data primitives (a figure, a pill, a sparkline, a row,
a table). `components/charts/` holds full charts, which always sit inside a `ChartFrame` so titles, controls
and legends are identical everywhere. Chart rules: at most three series; series 1 is glacier (the one in
focus) and the rest come from the graphite ramp; hatch marks inactive volume; intensity in heatmaps and
cohort grids is glacier *alpha*, never a second hue; hover lifts one element and dims the others rather than
recolouring anything.

**Intentional additions** — no source defined a component inventory, so this is an authored standard set
sized to a data product. Two entries deserve a note: `GlassPanel` exists so the glass recipe is applied
consistently rather than re-typed, and `Icon` exists as the single wrapper over the substituted Lucide set.

### UI kits

- `ui_kits/dashboard/` — `index.html`, `AppShell.jsx`, `OverviewScreen.jsx`, `PropertyScreen.jsx`,
  `PeopleScreen.jsx`, `PersonScreen.jsx`, `ViewsScreen.jsx`, `SettingsScreen.jsx`, `data.js`,
  `charts-data.js`. Click a property row to drill in (Summary / Trends / Paths / Retention tabs), a person
  row to open a profile, "Custom views" to build a view out of widgets.
- `ui_kits/site/` — `index.html`, `SiteHero.jsx`, `SiteSections.jsx`.

---

## CAVEATS

1. **Fonts are substitutes.** No binaries were supplied. Instrument Sans and JetBrains Mono are linked from
   Google Fonts in `tokens/fonts.css`. If Falorb has licensed faces, send them and they'll be self-hosted
   with real `@font-face` rules.
2. **Icons are substitutes.** Lucide via CDN, flagged above.
3. **No logo exists in this system.** The wordmark is plain type. Real files needed.
4. **The whole visual language is a proposal.** With no codebase or Figma to copy, the palette, type, and
   layout were derived from the brief and the inspiration screenshot. The UI kits are therefore designs, not
   recreations.
5. **No slide template** was created, since none was provided.
