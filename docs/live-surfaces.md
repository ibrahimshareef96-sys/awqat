# Live surfaces: widgets, Live Activities, the Dynamic Island, Android Live Updates

Set 31 Oct 2026, from Apple's ActivityKit and WidgetKit documentation and Android's Live Updates guide.

The web view cannot draw any of these. TypeScript decides what should be up; native code draws it. Native code holds no
prayer logic beyond picking the next time from a list it was given.

## What you get

| Surface | iOS | Android |
|---|---|---|
| Next prayer, home and lock screen | WidgetKit with `Text(timerInterval:)`, a timeline entry at each prayer | The existing `TodayWidget` with a countdown `Chronometer` |
| Page to read on, today's revision | Same widget, medium size | Already in `TodayWidget` |
| Dhikr tap counter on the home screen | Interactive widget, `AppIntent` button, iOS 17 | New `DhikrWidget`, a broadcast `PendingIntent` button |
| Prayer or iqama countdown, live | Live Activity and Dynamic Island, started while the app is open | Promoted ongoing notification, only from the adhan to the iqama (Google reserves Live Updates for what is under way or about to start) |
| Dhikr counter, live | Live Activity, `LiveActivityIntent` + button in the expanded island and on the lock screen | Promoted ongoing notification with a "+1" action |
| Study or workout timer | Live Activity counting up | Promoted ongoing notification with a chronometer chip |

Hard limits, from Apple and Google, not ours to change:

- With no push server, an iOS Live Activity can only be started while the app is in the foreground. Its timer runs by itself after that. It ends after 8 hours.
- The compact and minimal island only open the app. Buttons work in the expanded island (long press) and on the lock screen.
- Whether a sideloaded app's Live Update reaches Samsung's Now Bar is unknown: there is no public way in. Build it correctly and look on a Samsung phone.

## The App Group (iOS)

`group.app.awqat`, on the app target and the widget extension. One `UserDefaults(suiteName:)`:

- `snapshot`: the JSON string below.
- `pendingTaps`: JSON array of `{"key": string, "n": number}`, appended to by a widget or Live Activity button.

On Android the same two values live in the existing widget `SharedPreferences`.

## The snapshot (`WidgetBridge.update({snapshot})`, on both platforms)

Today's fields stay exactly as they are (`v`, `tz`, `prayers`, `days`). Added, all optional, so an old widget still reads it:

```json
{
  "v": 1, "tz": "Asia/Dubai",
  "prayers": [{"name": "Asr", "time": "15:23", "at": 1793475537027, "iqama": 1793476737027}],
  "days": [{"date": "2026-11-01", "quran": "Page 8 of 604", "revise": "Juz 30"}],
  "dhikr": {"key": "dhuhr|2026-11-01|tasbih", "name": "Tasbih, tahmid and takbir", "n": 12, "of": 100},
  "steps": "6,200 of 8,000 steps"
}
```

- `prayers[].iqama`: milliseconds, or absent when there is none (Jumu'ah).
- `dhikr`: the counted step open right now, or absent. A widget with no `dhikr` shows "Nothing to count now" and a tap opens the app.
- `steps`: a ready line, or absent.
- `live`: `false` when the user has turned live surfaces off in Settings; absent otherwise. Native posts nothing live on its own while it is false.
- Links back are `awqat://go/<screen>`; native never builds any other link.

## The live bridge (`LiveBridge`, a new Capacitor plugin on both platforms)

```ts
interface LiveItem {
  id: "next" | "dhikr" | "timer";        // at most one of each is up
  title: string;                          // "Asr", "Tasbih, tahmid and takbir", "Tafsir"
  detail: string;                         // "Iqama", "12 of 100", "Studying"
  endsAt?: number;                        // ms: count down to this
  startedAt?: number;                     // ms: count up from this
  count?: number;                         // with `of`: the dhikr's count
  of?: number;
  key?: string;                           // dhikr only: what a tap counts towards
  link: string;                           // awqat://go/<screen>
}
LiveBridge.available(): Promise<{ live: boolean }>   // false: older OS, or the user has turned them off
LiveBridge.show(item: LiveItem): Promise<void>       // starts it, or updates the one up with this id
LiveBridge.end({ id }): Promise<void>                // ends it now; ending one that is not up does nothing
LiveBridge.drain(): Promise<{ taps: { key: string; n: number }[] }>   // pending taps, and clears them
```

`show` is idempotent and is called often: native must not restart an activity (which would make the island flash) when one
with that id is already up. It updates it, and only if its content changed. `dhikr` taps while the app is closed add to
`pendingTaps` and bump the count on screen locally; at `of` the activity ends itself. The app drains them when it comes
to the front. `key` is opaque to native.

## Rules

- `prefers-reduced-motion`'s native twin: honour `accessibilityReduceMotion` for any animation you add. Use system timers only.
- Colours: dark base, ivory text (`#ece6d8` on `#0e0e13`), champagne `#e2cc9a` as the one accent. No gradients.
- Nothing of the Quran on any surface. Du'a names only, never du'a text.
- All text on these surfaces comes from the snapshot or the item, never typed in native code, apart from fixed labels such as "Nothing to count now".
