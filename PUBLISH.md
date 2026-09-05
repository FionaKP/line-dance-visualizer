# Publishing the visualizer

The app runs in two modes and decides between them by itself: on load it
probes `api/ping` (2.5s timeout). `server.py` answers `{"mode": "server"}`;
a static host serves the checked-in `api/ping` file (`{"mode": "static"}`)
or nothing at all — either way the app switches to **static mode** with no
console errors and no dead buttons.

## What works where

| Feature | Static (GitHub Pages) | `python3 server.py` |
|---|---|---|
| Paste-a-stepsheet parsing and playback | yes | yes |
| Bundled dance library (25 corpus sheets, `library.json`) | yes — the "Find a dance" card becomes a **Dance library** browser | hidden (live search takes its place) |
| Boots / 3D camera / cues / groove / clicks | yes | yes |
| YouTube playback (iframe embed) | yes — paste a YouTube link or video id into the Music card | yes, plus search |
| Music sync | manual: **Tap tempo** (8+ taps → exact BPM) + first-beat nudge ("Set to now", ±1s/±0.1s) + "Sync to video" | automatic: audio fetched, BPM + first beat measured, lyric cue aligned |
| Stepsheet search (CopperKnob / Linedancer proxy) | no — needs `/api/search`, `/api/sheet` | yes |
| YouTube music search | no — needs `/api/music` | yes |
| Automatic BPM / first-beat detection | no — needs `/api/audio` | yes |
| Lyric-cue alignment ("From lyrics", transcript agent) | no — needs `/api/transcript` | yes |

UI elements that need the server are hidden in static mode (the **Auto
match** and **From lyrics** buttons, the search filters row) or repurposed
(the search box filters the bundled library; the music search box takes a
pasted YouTube link), and an inline notice on the library card says why.

## The bundled library manifest

`library.json` is generated — never hand-edited — by:

```
node tools/build-library.js
```

It scans `tuning/corpus/*.txt` (plus `tuning/sheets/*.txt` if that
directory exists) and parses every sheet with the app's own `parser.js`, so
`counts`/`walls`/`level` in the manifest can never disagree with the app,
and an unparseable sheet fails the build. Stepsheet URLs come from the
corpus `INDEX.md` table. Entries are
`{title, counts, walls, level, music, url, source: "bundled", text}`; the
app loads the raw `text` through the same `parseStepsheet` path as a pasted
sheet. Re-run the script and commit the result whenever a corpus sheet is
added or changed.

## Deploying to GitHub Pages

1. In the repo settings, set **Pages → Source → GitHub Actions** (one-time).
2. Push to `main` (or run the workflow manually from the Actions tab).

`.github/workflows/pages.yml` then:

- rebuilds `library.json` with `node tools/build-library.js`,
- assembles the static file set — `index.html`, `parser.js`, `tempo.js`,
  `boot3d.js`, `library.json`, `api/ping`, and `figures.js` if present —
  and **fails the build if any `.py` file leaks into the artifact**
  (`server.py`/`sources.py` are local-only by design),
- publishes via `actions/upload-pages-artifact` + `actions/deploy-pages`.

Everything in the app uses relative URLs, so it works from a project
subpath (`https://<user>.github.io/line-dance-visualizer/`).

### Testing static mode locally

```
python3 -m http.server 8000    # any dumb static server, NOT server.py
```

Open http://localhost:8000 — you should see the offline notice, the Dance
library card listing the 25 bundled dances, and a clean console.

## Running with the full server

```
python3 server.py              # http://localhost:8123, PORT=... to change
```

This serves the same files plus the `/api/*` endpoints (stepsheet
search/fetch proxy, YouTube music search, audio fetch for BPM/first-beat
detection, caption transcripts), and the app switches every fallback above
back to its automatic path.
