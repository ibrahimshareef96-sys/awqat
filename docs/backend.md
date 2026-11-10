# The optional backend

Awqat works fully on the phone. Five features need a server you run yourself: Talk (the voice assistant), sync of
books and records between your devices, the "reading now" shelf, the Work and Inbox feeds, and an estimate of a meal
from its photo. Without a server they
are hidden or stay quiet, and nothing asks you to sign in.

The original author runs these on a Cloudflare Worker that is not part of this repository. This page is the contract
the app expects, so you can write your own. The client code is the source of truth: each route below names the file
that calls it.

## Address and sign-in

The server's address is typed in Settings, or built in with `VITE_WORKER_URL` in `.env.local`. It must be an `https`
origin (`src/voice.ts`, `cleanWorkerUrl`).

Every route below except sign-in takes `Authorization: Bearer <session>`. A session is the token the server gives at
sign-in (`SESSION_SHAPE` in `src/talk/worker.ts`); the app keeps it in a file in its own folder that is left out of
device backups (`src/talk/session.ts`), and sends it nowhere else.

| Route | Called from | What it does |
|---|---|---|
| `POST /talk/native/signin` `{ passphrase }` | `src/talk/worker.ts` | Returns `{ ok: true, token }`. |
| `POST /talk/native/signout` | `src/talk/worker.ts` | Ends the session. |
| `POST /talk/native/start` | `src/talk/worker.ts` | Reserves a talk: `{ ok, callId, conversationToken, variables, abandonWithin }`, where `conversationToken` is an ElevenLabs WebRTC token for your own ElevenLabs agent. |
| `POST /talk/native/connected`, `POST /talk/native/abandon` `{ callId }` | `src/talk/worker.ts` | Marks how a talk went. |
| `GET /talk` | `src/voice.ts` | The voice page, for a browser. |

## Sync

| Route | Called from | What it does |
|---|---|---|
| `POST /app/books` | `src/books/sync.ts` | Books: sends the changes since a cursor, returns other devices' changes and a new cursor. |
| `POST /app/records` | `src/sync/records.ts` | The other records (prayer log, Quran, adhkar, modes, learning, body, food, money, weekly reviews), the same way. Each is a `kind` and an `id` with its data; a server that keeps any kind it is sent needs no change when the app syncs a new one. |
| `PUT /app/library` `{ reading }` | `src/books/shelf.ts` | The books in hand, for a "reading now" shelf on another screen. |

The wire formats, and how conflicts resolve (record by record, the newer stamp wins, except where a collection can
join two versions, such as a prayer day; a removal is sent as a removal), are in those files and their tests
(`test/bookSync.test.ts`, `test/records.test.ts`).

## Feeds

| Route | Called from | What it does |
|---|---|---|
| `GET /app/feed/money`, `/app/feed/work`, `/app/feed/mail` | `src/feeds/feeds.ts` | The latest copy of each feed, which something else (the author uses a scheduled job on a Mac) puts there. |

The app shows only the fields `src/feeds/feeds.ts` checks, cleans every string it shows, and never sends anything
back. What the Work feed has `due` with a `date` (and, if it likes, a `time` as `"HH:MM"` on the user's clock) also
shows on that day in Agenda and in the Weekly Review's look ahead, read only. A mail can try to steer the model that sorted it, so its lines are marked as the model's reading, and links,
addresses, phone numbers and codes are stripped.

## Food

| Route | Called from | What it does |
|---|---|---|
| `POST /app/food/estimate` `{ image }` | `src/food/estimate.ts` | Looks at one photo of a meal and answers `{ ok, name, kcal, protein, carbs, fat }`, or `{ ok, unsure: true }`. Called only when the user taps Estimate on that photo. The full contract and a prompt are in [food.md](food.md). |

## What a server must never do

- Ask for anything but a passphrase to sign in, or keep the passphrase.
- Send the app HTML, scripts or redirects: the app refuses redirects and treats every reply as data.
- Keep more than it needs: the app sends a talk's context (prayers, adhkar, calendar, books, the week's intentions, and
  money or health only when those switches are on in Settings) at the start of a talk, for that talk.
