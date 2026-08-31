# line-dance-visualizer

Single-page app that animates a line dancer's feet from a CopperKnob
stepsheet. No build step, no dependencies.

- `index.html` — UI, timeline/keyframe builder, SVG renderer, playback,
  YouTube music sync. All vanilla JS.
- `parser.js` — stepsheet text → timed events (`parseStepsheet`). Loaded by
  the page as a global script; also `require()`-able from Node for tests.
- `tempo.js` — `gridFromWave`: BPM + first-beat detection from a low-passed
  waveform. Same dual browser/Node loading.
- `server.py` — static file server + CopperKnob search/stepsheet proxy +
  YouTube audio fetch. Run with `python3 server.py`, port 8123.

## Rules

- After ANY change to `parser.js` or `tempo.js`, run `node tests/run.js`
  and keep it green. When fixing a parsing bug, add a fixture reproducing it
  first (see `tests/README.md` for the workflow and expectation format).
- Parser and tempo code must stay pure (no DOM/window use) so Node tests
  keep working.
- Floor coordinates: floor units (SCALE px/unit), +y = toward 12:00, dx/dy
  in step events are relative to the *other* foot in the dancer's frame,
  mirrored for the left foot.
