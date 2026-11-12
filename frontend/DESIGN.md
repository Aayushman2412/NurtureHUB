# EduPoshan interface guide

The contract for every screen. Tokens live in `src/styles/theme.css`, shared
components in `src/components/ui/`. If a screen needs something this guide does
not cover, extend the guide and the shared component first, then use it.

## 1. What this is

EduPoshan is a working tool for a public-health programme, used every day:

| Who | Where | Job |
|---|---|---|
| Health worker (ASHA, AWW, ANM) | Phone, 360–430 px, at a family's home, Hindi or Marathi | See who to visit today, record weight and length correctly, know what is wrong with a baby |
| Batch monitor | Phone or laptop | Follow up the workers who are falling behind |
| Programme staff | District-office laptop, 1366–1440 px | Watch progress, find faltering babies, run tests, export data |

Nobody is here to be persuaded. Every screen is a record or a task.

## 2. Direction: the register

Model the interface on a well-kept health register, not on a product website.

- **Ruled, not floating.** Information sits on flat white surfaces separated by
  1 px rules. No drop shadows at rest, no gradients, no glass, no glow.
- **Colour means status.** Red, amber and green are reserved for clinical and
  task status (urgent, due or caution, normal or done). The brand colour is a
  petrol teal used only for actions, links, selection and focus. It never
  decorates.
- **A status rule on the left edge.** A row or panel that needs attention
  carries a 3 px left border in its status colour, with the status also written
  in words. Colour is never the only signal.
- **Figures you can trust.** Counts, measurements, dates and record IDs use
  tabular figures. Record IDs (`MR-…`, `CR-…`) are set in the mono face.
- **Plain words.** Sentence case, no taglines, no exclamation marks, no
  greeting banners. A page title says what the page is.

## 3. Tokens

Use the semantic utilities first: `bg-background`, `bg-surface`,
`bg-surface-sunken`, `border-border`, `border-border-strong`,
`border-border-control`, `text-ink`, `text-ink-muted`, `text-ink-faint`,
`bg-primary`, `text-primary-ink`. Reach for a raw ramp only for status.

| Ramp | Use | Never |
|---|---|---|
| `brand-*` (petrol teal) | Primary button, links, active nav, selected state, focus ring, info notes | Section backgrounds, icons-for-decoration, status |
| `gray-*` | Surfaces, borders, text | — |
| `error-*` | Urgent, overdue, failed, destructive action | Brand accents |
| `amber-*` | Due soon, caution, pending, unsynced | Decoration, "celebration" |
| `success-*` | Normal growth, done, passed, synced | Secondary buttons |

Tailwind's default palettes (`blue-500`, `rose-400` and so on) are switched off.
Chart colours live in `src/utils/brandColors.ts`.

**Type.** One family: IBM Plex Sans, with IBM Plex Sans Devanagari for Hindi
and Marathi, and IBM Plex Mono for record IDs and code-like values
(`font-mono`). Weights: 400 body, 500 labels, 600 headings and buttons. 700 is
for a single figure that must dominate a tile. Nothing is set in 800 or 900.
Page title 24 px, section title 18 px, body 14 px (16 px in the field app),
captions never below 13 px.

**Shape.** Controls 4 px (`rounded-md`), panels and dialogs 6 px (`rounded-lg`),
tags 2 px (`rounded-sm`). `rounded-full` is only for avatars, status dots,
count bubbles, toggles, progress tracks and spinners.

**Elevation.** None at rest. Menus, popovers, dialogs and toasts use
`shadow-(--shadow-overlay)`.

**Motion.** 120–150 ms colour and border transitions. Dialogs and drawers may
fade or slide for at most 150 ms. Nothing animates when a page loads. No
confetti, no hover lift, no scale.

**Density.** Admin tables: 13–14 px text, 40 px rows, sentence-case headers.
Field app: 16 px text, 48 px touch targets, one column.

## 4. Building blocks

- **Page** = `PageHeader` (title, optional one-line description, actions on the
  right) followed by sections 24 px apart. Content is left-aligned. Text
  columns stop at about 70 characters.
- **Panel** (`Card`) = white surface, 1 px border, 6 px radius. Do not nest a
  panel in a panel; inside a panel use a rule (`border-t`) or a sunken block.
  `accent="danger" | "warning" | "success" | "brand"` adds the left status rule.
- **List row** = the default for anything repeated (visits, mothers, learners
  on a phone). Rows share one bordered container and are separated by rules.
- **Figures** (`StatCard`) = label above, figure below, no icon tile. Several
  figures share one bordered strip.
- **Button**: `primary` (filled brand), `secondary` (white, bordered, the
  default for anything that is not the main action), `ghost`, `danger`. One
  primary button per view.
- **Badge** = small rectangular tag with a status word. **Chip** = filter
  toggle, rectangular.
- **Table** = ruled, sticky header, numbers right-aligned with tabular figures.
- **Forms** = label above the control, hint under the label, error under the
  control in `error-600` with the control's border in `error-500`.
- **Icons** (lucide, 16–20 px) mark actions, navigation and status. No icon in
  a tinted square, no icon that only decorates a heading.
- **Empty, loading, error**: say what is missing and what to do next; skeleton
  blocks pulse, they do not shimmer.

## 5. Not allowed

| Pattern | Replace with |
|---|---|
| `bg-gradient-*`, `bg-linear-*`, `from-*` / `via-*` / `to-*`, blurred colour blobs | A flat surface token |
| `backdrop-blur-*`, translucent bars | Solid `bg-surface` |
| `shadow-*` on panels, rows, buttons; `shadow-glow` | A 1 px border |
| `hover:-translate-*`, `hover:scale-*`, `hover:shadow-*` | `hover:bg-surface-sunken` or `hover:border-border-strong` |
| `rounded-2xl`, `rounded-3xl`, `rounded-[…]` above 8 px | `rounded-lg` |
| `rounded-full` on badges, chips, buttons, tabs, inputs | `rounded-sm` or `rounded-md` |
| `animate-fade-in`, `animate-slide-in-right`, mount animations, confetti | Nothing |
| `font-extrabold`, `font-black` | `font-semibold` |
| Uppercase letter-spaced "eyebrow" labels above titles | Remove, or a plain `text-xs font-medium text-ink-muted` label |
| Icon inside a tinted rounded square | The bare icon, or no icon |
| Sparkles, rocket, party, trophy icons used as decoration | Remove |
| Welcome banners, hero blocks, centred marketing copy, feature cards | `PageHeader` and the actual content |
| Brand-tinted fills used to make a section look lively | `bg-surface` |
| Dashed borders on ordinary content | Solid border (dashed is for drop zones and "add" slots) |
| Coloured text as the only status signal | Status word plus the left rule or a `Badge` |

## 6. Words

- Sentence case everywhere, including buttons, table headers and menu items.
- Name things by what the worker or officer calls them. Say "Visits due
  today", not "Your journey".
- No exclamation marks. No "Welcome back". No adjectives that sell.
- Errors say what happened and what to do next.
- All visible text goes through `react-i18next`; English and Hindi are kept in
  step (`src/i18n/locales/{en,hi}`).

## 7. Checking a screen

1. `npx tsc -b` and `npm run lint` pass.
2. Look at it at 390×844 and 1440×900, in light and dark.
3. Tab through it: focus is always visible; every control has a name.
4. Nothing from section 5 remains: `python scripts/check_design.py`.
