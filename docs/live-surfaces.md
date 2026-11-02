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
| Prayer day: Hijri date, the five prayers, the one under way marked, the next counting down, the iqama to come | `PrayerDayWidget`, systemMedium | `PrayerDayWidget`, 4 x 2, a countdown `Chronometer` |
| Quran: the page to read on, today's pages against the goal, today's revision | `QuranWidget`, systemSmall | `QuranWidget`, 2 x 2 |
| Adhkar: morning and evening, each "Said", "Open now" or "Later" | `AdhkarWidget`, systemSmall | `AdhkarWidget`, 2 x 1 |
| Next meeting today or tomorrow, with the prayer before and after it, or "Connect a calendar" | `AgendaWidget`, systemMedium | `AgendaWidget`, 4 x 2 |
| Lock Screen: next prayer | `NextPrayerWidget`: accessoryRectangular (countdown), accessoryCircular, accessoryInline ("Asr 15:21") | None (Android has no lock screen widgets on phones) |
| Lock Screen: Hijri date | `HijriWidget`: accessoryCircular (the day, the month), accessoryInline | None |
| One tap to Talk | `TalkControl`, an iOS 18 control (Control Center, Lock Screen, Action button) | `TalkWidget`, 1 x 1, and the "Talk to Awqat" Quick Settings tile |

Every widget reads only the snapshot. Each one wakes itself at its own next change (a prayer, the end of a prayer's
time, an iqama, a set of adhkar opening or closing, a meeting beginning or ending, midnight): `WidgetIntents.wakeAt` on
Android, timeline entries on iOS. All taps open the app through the links below.

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

Added for the prayer day, Quran, adhkar, agenda and Lock Screen widgets (3 Nov 2026), all optional to a reader
(`src/app/widget.ts` and `src/app/widgetDays.ts` write them):

```json
{
  "days": [{"date": "2026-11-01", "quran": "Page 8 of 604", "revise": "Juz 30", "read": "3 of 5 pages today"}],
  "place": "unset",
  "prayerDays": [{"date": "2026-11-01", "hijri": {"text": "21 Jumada al-Ula 1448", "day": 21, "month": "Jumada al-Ula"},
    "prayers": [{"name": "Asr", "time": "15:23", "at": 1793475537027, "until": 1793484000000,
      "iqama": 1793476737027, "iqamaTime": "15:43"}]}],
  "adhkar": [{"date": "2026-11-01", "morning": {"from": 1793420000000, "to": 1793445000000, "said": true},
    "evening": {"from": 1793475537027, "to": 1793500000000, "said": false}}],
  "calendar": true,
  "meetings": [{"title": "Study circle", "date": "2026-11-01", "time": "16:00", "start": 1793478000000,
    "end": 1793481600000, "before": "Asr 15:23", "after": "Maghrib 17:51"}]
}
```

- `days[].read`: today's reading, "3 of 5 pages today" with a daily goal, "3 pages today" without one.
- `place`: `"unset"` while the place is only guessed (`place.source === "default"`), else absent. Then the snapshot
  holds no `prayers` (an empty list), no `prayerDays`, no `adhkar` and no `dhikr`, and the meetings come without
  `before` and `after`: their times would be Makkah's. Every prayer, adhkar and Lock Screen widget says "Set your
  place" instead, and Siri's next prayer says the place is not set. The Quran lines and the meetings stay.
- `prayerDays`: each prayer day not over yet (Fajr to the next Fajr), the one under way first, at most 12. Five
  prayers each, past ones included, so the widget can mark the one under way. `until` is when that prayer's time is
  over (Fajr's at sunrise, Isha's at the next day's Fajr; absent on the last day). `iqama` and `iqamaTime` are absent
  for Jumu'ah. `hijri` is the Umm al-Qura date for that calendar day, absent where the device has no Hijri calendar.
  The prayer day widget shows the Hijri date of the prayer day under way (until Fajr); the Lock Screen's Hijri widget
  moves on at midnight, as the Faith screen does.
- `adhkar`: per prayer day, when each set is open (the morning Fajr to Dhuhr, the evening Asr to the middle of the
  night) and whether it is said in full. A widget shows "Said", "Open now" inside the window, or "Later". From the
  middle of the night to Fajr it shows the coming day's two sets, both "Later".
- `calendar`: whether any calendar is connected. With none, the agenda widget says "Connect a calendar".
- `meetings`: timed events (no all-day ones) still to end that start today or tomorrow, soonest first, at most 8.
  `title` is cleaned of control and direction characters and cut to 60. `before` is the prayer at or before the start,
  `after` the first prayer after it, which can fall during the meeting.

**Meeting titles are private.** They show only on home-screen widgets: Android's `AgendaWidget` is
`widgetCategory="home_screen"`, iOS's `AgendaWidget` is systemMedium only and marks the title `privacySensitive()`. No
Lock Screen accessory, Live Activity or Live Update ever reads `meetings`.

## Links

Every widget, shortcut, control and phrase opens the app with `awqat://go/<screen>`. The app follows only these
(`linkTarget` in `src/app/widget.ts`): `home`, `faith`, `quran`, `mushaf`, `revise`, `modes`, `body`, `talk`,
`adhkar`, `agenda`, and `mode:<id>`. Anything else, with a query, a slash or another scheme, does nothing. Native
checks every Live item's link against the same shape (`LiveData.isLink`, `LiveBridgePlugin.isLink`).

- `talk` opens the Talk sheet and waits for its Talk button. Any app can send a link, so a link alone never turns the
  microphone on; a talk already open stays as it is.
- `adhkar` opens the set open now, or else the one that opens next (the evening after Dhuhr, the morning after the
  middle of the night).
- `agenda` opens Agenda, where a calendar is added.

## Voice, with no paid per-call service

- **Android.** Static app shortcuts on a long press of the icon (`res/xml/shortcuts.xml`): Talk, Adhkar, Read Quran,
  each an `awqat://go/` link. A Quick Settings tile, "Talk to Awqat" (`TalkTileService`). "Hey Google, open Awqat"
  works with nothing added. Google Assistant App Actions are not used: they need a Play Console step.
- **iOS.** App Intents with an `AppShortcutsProvider` (`ios/App/App/AwqatIntents.swift`), every phrase naming the app:
  "Talk to Awqat" and "Open adhkar in Awqat" open the app on their link; "When is the next prayer in Awqat" answers in
  Siri's own reply from the App Group snapshot ("Asr is at 15:21."), without opening the app. The Talk control
  (iOS 18) opens `awqat://go/talk` with `OpenURLIntent`.

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
- Larger fonts: Android sets text in `sp`, and where five prayers or two sets share a row each sits in a box that sizes
  its text down to fit (`autoSizeTextType`), so a larger font never cuts a time. iOS uses text styles and the serif
  relative to one, capped with `minimumScaleFactor`. The widgets are dark in light and dark mode alike, as the app is.
