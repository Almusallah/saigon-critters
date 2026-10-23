# 🐾 Saigon Critters

**Spot 'em all. Help 'em all.**

A Pokémon-Go-style game for Ho Chi Minh City. You photograph the animals you meet around the city and collect them in a Critter-Dex. The game also does something useful: street dogs and cats get a condition score and a status, so shelters and volunteers can see which ones need help, and only verified shelters can close a rescue case.

It ships as a **web app (PWA)** and an **Android APK** from the same code, with one small Node server.

## What's in it

| | |
|---|---|
| 🗺️ **Map** | Every critter is a bubble on a map of Saigon. Filters: All · 🆘 Needs help · 💗 Adopt me · ✨ Rare · Dogs · Cats · Mine. Urgent cases ripple red. |
| 📸 **Catch** | Snap → pick species → quick check → *throw a treat* → card reveal with XP. |
| 📒 **Deck** | 26 species in 4 rarities: Common (dog, cat, chicken, gecko…), Uncommon (squirrel, koi, frog…), Rare (turtle, tokay, buffalo…) and 🌟 **Super rare** (macaque, otter, water monitor, owl). |
| 🩹 **Welfare check** | Dogs & cats get a status (🚨 Urgent · 🩹 Needs help · 😺 Street & fine · 🏠 Has a home) plus a 1–5 condition score, averaged across everyone's checks. |
| 🆘 **Rescue board** | Open cases, urgent first, then worst condition. Directions, **🙋 I'm on it** and **✅ Helped**. A player's "Helped" waits under **🕓 To confirm** until a verified shelter confirms it. |
| 💗 **Adopt** | Post your own cat or dog for adoption (age, vaccinated, sterilized, phone/Zalo). Owner locations are blurred to ~300 m. |
| ☁️ **Accounts** | Optional. Sign up with a username and password; deck, XP, badges and quests follow you to any phone. A **recovery code** shown at sign-up resets a forgotten password, so no email or SMS is needed. |
| 🏥 **Shelters** | Shelters apply in the app; an admin approves them at `/admin`. Verified shelters get a ✅, and their "Helped" closes cases for everyone. |
| 🎮 **Game** | XP, levels (*Hẻm Rookie → Legend of the Hẻm*), 8 badges, 3 daily quests. Helping earns more XP than collecting, and each reward is paid once per animal. |
| 🌿 **Wildlife** | Wild species show a "don't feed / don't touch" tip and the free ENV wildlife-crime hotline **1800-1522**. |

## Quick start (local)

```bash
npm install
npm run dev          # app only, data stays in the browser: http://localhost:5173
npm run build && npm start   # app + community server: http://localhost:8787
```

With the server running locally, data goes in `data/` (JSON files and photos), and the admin key for `/admin` is generated into `data/admin-key.txt`.

## How data works

```
 Phone (APK or browser)                        Community server (Render)
 ┌───────────────────────────┐   HTTPS JSON   ┌──────────────────────────┐     ┌──────────────┐
 │ IndexedDB: sightings+photos│ ─────────────▶ │ Node server (one process)│ ──▶ │ MongoDB      │ accounts, sightings
 │ localStorage: player,      │ ◀───────────── │  /api/…  /admin  /photos │     └──────────────┘
 │   settings, session token  │  push / pull   │                          │ ──▶ ┌──────────────┐
 └───────────────────────────┘   every 60 s   └──────────────────────────┘     │ Backblaze B2 │ photos
                                                                                 └──────────────┘
```

- **Offline first.** Every action is saved on the phone first, then uploaded. Offline changes wait and go up on the next sync. Each sync downloads only what changed; every 20 minutes a full sync also notices sightings that were removed.
- **The server keeps nothing in memory.** In production MongoDB is the only source of truth, and every write is version-checked and retried on conflict. Two server instances can run at once, as they do for a minute during every Render deploy, without overwriting each other.
- **Self-healing.** If the server ever loses sightings, the phones that posted them upload them again, photos included.
- **Sightings merge per field.** Status, "I'm on it" and "Helped" are shared, and anyone can change them. Photo, nickname, note, location and adoption details only change for the person who posted them. Each request can add or change only its sender's own condition score.
- **Who's who.** Account holders send a session token. Anonymous players are proved by a device key: the first upload from a player ID registers a hash of its key, and every later upload must match it. Keys are per community (servers report a stable `serverId`), so a server someone tries out can't use a phone's key on another server, and two addresses for the same server share one key.
- **Abuse limits.** Login, recovery, sign-up and admin attempts, uploads and photos are rate-limited per client IP (generous, because Vietnamese mobile carriers put many phones behind one IP). A retried sign-up must prove it comes from the same phone. Recovery codes work once, even when two requests race.
- **Verified is decided by the server.** It marks "I'm on it" and "Helped" as verified only when they come from an approved shelter's account, and clients can't set it themselves.
- **Progress can't double count.** Each phone reports its own lifetime totals in its own slot, and the account's XP is the sum of the slots. Resending the same numbers changes nothing, so flaky connections can't inflate anything.
- **Changing phones.** Sign in on the new phone and your deck, XP, badges, quests and reward history come back. Anything you did anonymously on that phone (sightings, scores, "on it"/"helped") moves to the account, and so does an upload that was still in flight during sign-in.
- **Forgotten password.** Use the recovery code to set a new one; that also signs out every other phone. If someone lost the code too, an admin can issue a new one at `/admin` after checking who they are.

## Deploying (Render + MongoDB + Backblaze)

`render.yaml` is a Render blueprint for one Node web service in **Singapore**, the closest Render region to HCMC. Render wipes a service's disk on every deploy, so nothing important is kept there:

1. **MongoDB:** your existing Atlas cluster works; the app uses its own database, `saigon_critters`. Set `MONGODB_URI`.
2. **Backblaze B2:** create a private bucket and an application key limited to it. Set `PHOTOS_S3_ENDPOINT` (e.g. `https://s3.us-west-004.backblazeb2.com`), `PHOTOS_S3_REGION` (e.g. `us-west-004`), `PHOTOS_S3_BUCKET`, `PHOTOS_S3_KEY_ID` and `PHOTOS_S3_SECRET`. Photos are served through the server, so the bucket stays private. Any S3-compatible store works (R2, S3). Without a bucket, photos go into MongoDB.
3. **ADMIN_KEY:** Render generates it; read it in the dashboard and use it at `https://<your-service>.onrender.com/admin`.
4. Push the project to GitHub and create the service from the blueprint (Render → New → Blueprint).
5. **After the first deploy, check rate limiting.** Open `/api/admin/ip` with the `X-Admin-Key` header. `clientIp` should be your own public IP. If every visitor shows the same address, raise `TRUST_PROXY` (the number of proxies that append to `X-Forwarded-For`).

Use the **Starter** plan: free instances sleep after 15 minutes and make the app stall on its first sync. You can run more than one instance.

**Safety rails:**
- On Render the server refuses to start without `MONGODB_URI`, rather than silently writing to a disk that gets wiped.
- A misconfigured photo bucket fails the deploy at boot (Render keeps the old version running).
- Photos stored before you add a bucket keep loading from MongoDB.

## Testing the server

`server/test/prodtest.mjs` runs the real server against an in-memory MongoDB and a local S3 emulator. Over 40 checks cover:

- two instances writing at once
- restarts
- accounts, recovery and cross-phone progress
- shelter verification
- spoofing attempts, rate limits and boot-time failures

```bash
npm install --no-save mongodb-memory-server@10 s3rver@3   # test-only
npm run test:server
```

## Android APK

Prebuilt: `saigon-critters-debug.apk`. Copy it to a phone, open it, and allow "install unknown apps".

To connect the APK to your server, either set it in **Profile → Settings → Community server**, or build it in:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
VITE_SERVER_URL=https://saigon-critters.onrender.com npm run apk
# → android/app/build/outputs/apk/debug/app-debug.apk
```

The APK uses the system camera (no camera permission needed), the Android photo picker for the gallery, and GPS for location. It stays clear of the status and gesture bars on Android 15, and the back button closes sheets and panels. **For the Play Store** you need a release build signed with your own keystore: open `android/` in Android Studio → *Build → Generate Signed App Bundle*.

## Project layout

```
src/
  main.js      app shell, tabs, actions, account/shelter sheets
  account.js   sign up / in / out, recovery, progress sync, shelter apply
  store.js     IndexedDB storage + community sync (per-field merge)
  catch.js     snap → species → welfare → throw → reveal
  views.js     Deck, Rescue board, Adopt, Profile, onboarding, forms
  cards.js     critter detail sheet + shared markup
  map.js       Leaflet map, pins, filters (tile servers fall back automatically)
  game.js      XP, levels, badges, daily quests
  species.js   the Critter-Dex (species, rarities, statuses)
  seed.js      demo critters around HCMC (offline mode only)
server/
  server.js    API, accounts, shelters, admin, static hosting
  storage.js   JSON files (local) · MongoDB (+ S3/B2 photos) in production
  admin.html   shelter approval + player recovery page
render.yaml    Render blueprint
android/       Capacitor Android project
```

## Known limits

- There's no anti-cheat. XP is reported by the phone, which is fine for a game with no leaderboard. Add server-side checks before adding one.
- If you play offline on two phones on the same day, daily-quest progress counts the better phone, not the sum (XP and stats do add up correctly).
- Species are picked by hand, with no image recognition.
- Map tiles come from OpenStreetMap community servers (HOT / OSM France, with fallbacks). For heavy traffic, use a commercial tile provider.
- The APK allows plain-HTTP servers so you can test against a laptop on the same Wi-Fi. Use HTTPS in production (Render does).
