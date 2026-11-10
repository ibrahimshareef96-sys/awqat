# AGENTS.md: working on Awqat with a coding agent

This file is for AI coding agents (Claude Code, Codex, Cursor, Kimi and the like) and for the people driving them.
Read it before changing anything. README.md says what Awqat is; this says how to change it without breaking what it
promises.

## Ground rules (never broken)

1. **No Quran text typed, generated or bundled.** Not in code, tests, fixtures, comments, mockups or commit messages.
   The mushaf draws from verified page fonts; recitation downloads the Tanzil text on the user's word; a dhikr that
   is an ayah opens its page. Tests use everyday Arabic you write yourself, never ayat. Never show what the speech
   model wrote.
2. **Nothing leaves the phone unless the user set it up.** No analytics, no new network call without a reason in the
   pull request, a line in the README's Privacy section, and (for the page) a look at the Content-Security-Policy in
   `index.html`, which stays as tight as it is.
3. **No personal data.** Fictional names, `example.com`, round amounts. No real places beyond Makkah as the default.
4. **Licences first.** No font, image, audio, dataset or model without a licence that allows it; add it to
   THIRD_PARTY_NOTICES.md. Text with no stated licence is fetched at run time, never committed.
5. **No streaks, scores or guilt.** Numbers are the user's own records, shown separately, never one score; no pushes
   built on a streak.
6. **Motion is optional.** Honour `prefers-reduced-motion` (and `accessibilityReduceMotion` on iOS). Anything that
   moves starts from where it is now and can be interrupted.

## Commands

```bash
npm ci                         # install (onnxruntime-node and sharp are empty stubs, see stubs/)
npm run typecheck              # tsc --noEmit
npm test                       # vitest, on the Asia/Dubai clock so the expected prayer times hold
npm run build                  # typecheck, then vite build into dist/
npx cap sync                   # copy dist/ into android/ and ios/
cd android && ./gradlew assembleDebug testDebugUnitTest   # Android build and Java tests
```

A change is done when typecheck and every test pass, and the build succeeds. Native changes also need the Android
build, and the iOS app and widgets extension built for a simulator in Xcode or with `xcodebuild`.

## How the code is laid out

| Where | What |
|---|---|
| `src/main.ts` | Start-up, the render loop, and every tap: `data-action`, `data-go` and the other `data-*` attributes are routed here |
| `src/app/state.ts` | The one state object, `save()`, and `hooks` (render, overlay, sheets) that actions call |
| `src/app/*Actions.ts` | What a tap does: change state immutably, save, call `hooks.render()` |
| `src/ui/*View.ts` | Screens and sheets as HTML strings. Every value through `esc()`. No inline styles (the policy forbids them): widths come from `data-w`, painting in place uses the CSSOM |
| `src/prayer`, `src/quran`, `src/faith`, `src/recite`, `src/review`, `src/agenda`, `src/body`, `src/food`, `src/money`, `src/learn`, `src/books` | Pure logic per area, each with tests in `test/` |
| `src/recite/` | Recitation: see docs/recitation.md |
| `src/talk/`, `src/sync/`, `src/feeds/` | The optional backend: see docs/backend.md |
| `android/app/src/main/java/app/awqat/` | Widgets, Live Updates, the bridges the page calls |
| `ios/App/PersonalOSWidgets/` | WidgetKit widgets, Live Activities, App Intents |
| `docs/` | `backend.md`, `live-surfaces.md` (widgets and the lock screen contract), `recitation.md`, `adhan.md` |
| `scripts/` | Generators for data and brand pictures (Python): run them, never hand-edit their output |
| `brand/` | The mark, icon, banner and social picture, drawn by `scripts/brand.py`: see brand/README.md |

## The house style

- Plain TypeScript, no framework. Small pure functions; new objects, never mutation of state.
- Comments are short plain sentences that say why, in the voice of the ones around them.
- Words on screen: plain English, short, no em or en dashes, no exclamation marks, no jargon. Say what happened and
  what to do next.
- Data read back from storage or the network is checked by a `check*` or `parse*` function first: damaged data never
  crashes the app and never reaches the screen unescaped.
- Accessibility: real buttons, labels on every field, `aria-pressed` on toggles, 44 px touch targets, Arabic marked
  `lang="ar" dir="rtl"`.
- Tests come with every change, and come first for pure logic.

## Adding a feature, step by step

1. Write the pure logic in its area folder, with tests in `test/` (fictional data).
2. Add its state to `src/app/state.ts`, and an action module in `src/app/` that changes state and saves.
3. Draw it in a view in `src/ui/`, with `data-action` names; route them in `src/main.ts` `act()`.
4. If it saves something new, add its key in `src/store.ts` and a `check*` reader; if it should sync, see
   `src/sync/collections.ts`.
5. If it shows on a widget or the lock screen, extend the snapshot in `src/app/widget.ts` and follow
   docs/live-surfaces.md on both platforms.
6. Update README.md (what it does), THIRD_PARTY_NOTICES.md (anything of others'), and docs/ where a contract changed.

## Publishing your own build

Change the app id `app.awqat` and the App Group `group.app.awqat` everywhere CONTRIBUTING.md lists, set your own
Apple team, and sign Android with your own keystore (never committed). Quran Foundation's developer terms apply to
anyone distributing a build that shows the mushaf.
