# RetroSpectro

A structured team **retrospective** built on the ClusterFun presenter/client model. The
shared screen (presenter) drives a real meeting; each participant drives input from their
phone (client). Unlike the party games in this repo, RetroSpectro is a **work tool** — it's
typically shown over a screen-share or on a meeting-room monitor, so the visual design
prioritizes professionalism, readability at a distance, and information density.

## Game flow (unchanged by the skin)

The presenter walks through these states (`RetroSpectroGameState` + shared states):

1. **Gathering** — room code + join instructions, live roster, start button.
2. **Instructions** — the 3-step explainer (Brainstorm / Categorize / Talk).
3. **WaitingForAnswers** — countdown timer with add-time controls; incoming ideas appear as
   anonymous colored chips (text is hidden until sorting).
4. **Sorting** — drag-and-drop ideas into named groups; **+ / −** weight a card (grows it and
   reorders groups by weight on "Done").
5. **Discussing** — one group at a time (biggest first), each idea shown as a positive/negative
   card with its author; **Notes** and **Tasks** fields per group; prev/next nav; a **Show
   summary** overlay renders a plain-text export of the whole retro.
6. **GameOver** — scoreboard. **Paused** — waiting for rejoin.

The client (phone) is a thin controller: wait → submit an idea as 👍 Positive / 👎 Negative →
categorizing wait → discussion nudge (highlighted when one of your ideas is on screen).

### Group auto-naming (sorting)

When ideas are dragged together during **Sorting**, a group that still has an auto-generated name
(empty, or `"Group A"`, `"Group B"`, …) is renamed to the meaningful words its ideas share. On
each drop, the newcomer's text is compared against the ideas already in the group; if they share a
**contiguous run of one or more words** where at least one word isn't a common utility word
("a", "of", "the", …), the group takes that shared phrase as its name (longest wins, edge
utility-words trimmed). Once a group has a real name, later drops leave it unchanged.

_Example:_ a group holding "Buggy soda fountain" + "incorrect drinks" is auto-named; dropping
"Fix the soda fountain" renames it to **"soda fountain"**; dropping "I like the soda fountain"
after that changes nothing.

The rule lives in pure, unit-tested helpers in [`models/groupNaming.ts`](models/groupNaming.ts)
(`sharedSignificantPhrase`, `pickGroupNameFromSharedWords`, `isAutoGroupName`) and is wired into
`RetroSpectroAnswerCollection.handleDrop` in `models/PresenterModel.ts`. See
[`models/groupNaming.spec.ts`](models/groupNaming.spec.ts).

## Design system — "Light corporate"

Chosen because the game is shown in business meetings via screen-share / projector, where a
light, high-contrast, low-chrome look reads best. All tokens are CSS custom properties defined
on the root containers (`.gamepresenter` in `views/presenter/Presenter.module.css`,
`.gameclient` in `views/client/Client.module.css`) and kept **identical across both** so the
two surfaces feel like one product.

| Token            | Value     | Use                                                   |
| ---------------- | --------- | ----------------------------------------------------- |
| `--bg`           | `#f4f5f7` | Page background                                       |
| `--surface`      | `#ffffff` | Cards, panels, header                                 |
| `--surface-2`    | `#f7f8fa` | Insets, secondary fills                               |
| `--border`       | `#e3e6eb` | Hairline borders                                      |
| `--text`         | `#1a1d24` | Primary text (near-black, cool)                       |
| `--text-dim`     | `#5b6472` | Secondary text                                        |
| `--accent`       | `#6366f1` | **Indigo** — buttons, active states, focus, room code |
| `--accent-hover` | `#4f46e5` | Primary button hover                                  |
| `--pos`          | `#15803d` | **Positive** ("went well") — muted green              |
| `--neg`          | `#b91c1c` | **Negative** ("needs work") — muted red               |

Positive/negative use soft tinted fills (`--pos-soft` / `--neg-soft`) with matching borders on
the presenter (many cards on a light field), and solid fills on the client's two big submit
buttons (single strong action per tap).

### Type

- **Space Grotesk** for all UI (already loaded globally via `public/index.html`). Professional,
  slightly geometric — not playful.
- **Space Mono** for numerals and codes: the countdown timer, the room code, and the summary
  export. Monospace makes changing numbers easy to read at a glance.
- System-sans fallbacks so the game still renders if the web fonts fail.

### Density & layout

The brief was "smart, professional, not too spaced out — show as much as practical while
staying readable." Concretely:

- A fixed **84px header** (presenter) / **120px header** (client) holds identity + the room code
  so it's always visible; the rest of the screen is a single scrolling content area.
- Generous whitespace and oversized fonts from the original were tightened; sizes are authored
  for the fixed virtual canvases (**1920×1080** presenter, **1080×1920** client — see
  `UINormalizer`), not scaled percentages.
- The two dense screens — **Sorting** and **Discussion** — use fixed-height scroll regions
  (`.sortList`, `.discussionGroup`) so many cards stay on one screen instead of pushing content
  off it. Discussion is a two-column grid (cards + notes/tasks) to keep the transcript and the
  capture fields visible together.

### Interaction & a11y

- Buttons come in three weights: **primary** (indigo, `presenterButton` / `letsGo`), **secondary**
  (neutral outline, `discussionButton` / `doneSortingButton`), **ghost** (quiet, `ghostButton`).
- `:focus-visible` shows a 2px indigo ring on every control.
- `prefers-reduced-motion` disables transitions.
- Custom scrollbars are restyled to a neutral gray to fit the light theme.

## What the skin did **not** touch

Styling and markup only. Game logic, routing, socket/room wiring, drag-and-drop behavior
(`react-dnd` sources/targets in `AnswerCard` / `AnswerCollection` / `AnswerSortingBox` /
`AnswerCollectionSpacer`), the vote-to-grow mechanic, the summary export, model state, and all
event handlers are unchanged. The `Positive`/`Negative` **string** semantics from the model are
preserved — the skin only maps them to CSS classes. The logo image (`assets/images/icon.png`)
is intentionally left as-is (slated for a separate redesign).

## Files

```
views/presenter/
  Presenter.tsx            Header + all stage pages (Gathering, Instructions, Waiting, Sorting, GameOver, Paused)
  Presenter.module.css     The design system + every presenter class (shared by the components below)
  DiscussionPage.tsx       Discussion stage (cards + notes/tasks + nav + summary overlay)
  AnswerCard.tsx           A single draggable idea (pos/neg tint, vote-to-grow)
  AnswerCollection.tsx     A group of ideas with an editable name
  AnswerSortingBox.tsx     The sorting drop container
  AnswerCollectionSpacer.tsx  Drop target between groups
views/client/
  Client.tsx               Phone controller for all client states
  Client.module.css        Matching light-corporate skin for the phone
```

When adding a new stage or control, pull colors/spacing from the CSS variables above rather than
hard-coding hex values, and keep positive = `--pos`, negative = `--neg`.
