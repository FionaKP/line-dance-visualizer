# Line Dance Visualizer

Paste a line dance stepsheet — or search for one — and watch it danced by a
pair of 3D cowboy boots on a wooden floor, count by count, synced to the
actual song.

Built for learning: every step is parsed from real CopperKnob-style
stepsheet text, landings hit exactly on the beat, and the camera moves like
a steadicam operator so travel and turns read naturally instead of jarring.

## Features

- **Stepsheet → animation**: a parser turns stepsheet text (counts, "&"
  syncopation, turns, vines, shuffles, rocks, touches, hooks, kicks,
  stomps, swivels...) into timed foot events. Tested against a corpus of
  real published dances.
- **3D boots**: procedurally rendered cowboy boots (left = red, right =
  brown leather) that physically angle for heel digs, toe points, hooks and
  kicks — with a flat top-down 2D mode one toggle away.
- **Danced, not robotic**: per-move easing (glides, drags, rock rebounds,
  stomp slams), a deterministic "groove" for human micro-variation, and a
  seamless loop — the boots keep dancing across the end of the dance.
- **A camera with intent**: lags while you travel so motion reads, holds
  dead-still when you're planted, pans through turns like a camera operator
  (rate-limited, eased, measured in a simulation harness).
- **Music sync**: search the song on YouTube, auto-detect BPM and count 1
  from the actual audio (low-passed onset autocorrelation), or tap tempo /
  lyric-cue alignment. The dance then follows the video playhead.
- **Multi-site search**: CopperKnob and Linedancer (via a stepsheet-PDF
  text extractor), behind a pluggable source registry.

## Run it

No build step, no dependencies:

```bash
python3 server.py
```

then open http://localhost:8123. The server is only needed for stepsheet
search and audio analysis — the app itself is static files.

## Project layout

| Path | What it is |
|---|---|
| `index.html` | UI, timeline builder, SVG renderer, playback, music sync |
| `parser.js` | stepsheet text → timed events (browser global + Node module) |
| `tempo.js` | BPM + first-beat detection from a waveform |
| `boot3d.js` | procedural 3D boot mesh renderer |
| `server.py` / `sources.py` | static server + per-site stepsheet scrapers |
| `tests/` | eval harness: fixture stepsheets + semantic expectations |
| `tuning/` | perspective/motion tuning logs, sim harness, dance corpus |

## Development

- After any change to `parser.js` or `tempo.js`: `node tests/run.js` and
  keep it green. Fixing a parsing bug starts with a fixture reproducing it
  (`tests/README.md` has the workflow).
- Visual/camera tuning is logged in `tuning/*.md` — hypothesis, change,
  measured numbers, verdict — so every iteration builds on the last.
- Motion fidelity is calibrated against footage of real dancers; the
  reference corpus of dances lives in `tuning/corpus/`.

## Contributing

Contributions are very welcome — this is a no-build, no-dependency
codebase that's easy to hack on, and there's a well-worn workflow for the
most valuable contribution of all: making more real stepsheets parse
correctly. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

- Figure catalog (grapevine, jazz square, K step, Lindy...) powering a
  "learn the steps" reference page with loopable demos
- Public site (GitHub Pages static mode + a small search proxy)
- Tags and restarts
