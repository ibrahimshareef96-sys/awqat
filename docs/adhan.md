# Adding an adhan

No adhan recording ships with Awqat. A recording is a performance, and the muezzin's and the recordist's rights have
to allow redistribution, so the app plays the phone's own notification sound at each prayer reminder until you add
recordings you have the right to ship.

## What to add

| File | Where | Notes |
|---|---|---|
| `adhan.mp3` | `android/app/src/main/res/raw/` | The whole adhan. Android plays it through its own notification channel. |
| `adhan_fajr.mp3` | `android/app/src/main/res/raw/` | Fajr's, with "as-salatu khayrun min an-nawm". |
| `adhan.caf` | `public/sounds/` | At most 29.5 seconds: iOS plays no more than 30 seconds of a notification sound. |
| `adhan_fajr.caf` | `public/sounds/` | The same for Fajr. |

Make the iOS copies on a Mac: cut the recording to 29.5 seconds (with ffmpeg, from Homebrew), then convert it with
`afconvert`, which comes with macOS:

```bash
ffmpeg -i adhan.wav -t 29.5 adhan-29s.wav
```

```bash
afconvert -f caff -d ima4 adhan-29s.wav public/sounds/adhan.caf
```

Then put `VITE_ADHAN=1` in `.env.local` and build again. The Adhan switch appears in Settings, and each prayer
reminder plays the recording (Fajr its own). `android/app/src/main/res/raw/keep.xml` already keeps the two Android
files through release shrinking.

Do not commit recordings to a public fork unless their licence allows it. A licence on an upload covers only the
rights its uploader holds; a field recording of a mosque does not show that the muezzin licensed the performance.
