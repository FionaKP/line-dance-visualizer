# Contributing

Thanks for wanting to make the boots dance better. This project is
deliberately simple to hack on: **vanilla JS, no build step, no
dependencies**. If you can run `python3` and `node`, you're set up.

```bash
python3 server.py        # app at http://localhost:8123
node tests/run.js        # the eval harness — keep it green
```

## The one rule that matters

**Parsing changes start with a fixture.** If a stepsheet parses wrong:

1. Add the sheet (or a minimal cut) to `tests/fixtures/yourcase.txt`
2. Run `node tests/run.js --dump yourcase` to see what the parser does
3. Write `tests/expected/yourcase.json` asserting what it *should* do
   (semantic spot checks — direction signs, turns, ranges — not full dumps)
4. Fix the parser until green, commit fixture + fix together

`tests/README.md` documents the expectation format. The harness prints a
delta against the previous run, so regressions are loud.

## Where things live

- `parser.js` / `tempo.js` — pure modules (no DOM/window!), dual-loaded by
  the browser as globals and by Node tests via `require()`. Keep them pure.
- `index.html` — timeline builder, renderer, playback, music sync, UI.
- `boot3d.js` — the procedural 3D boot mesh.
- `sources.py` — stepsheet site scrapers behind a registry; adding a site
  means implementing `search` + `fetch_sheet` that normalize to
  CopperKnob-shaped text. Be polite: one upstream request per user action.
- `tuning/` — the project's lab notebook. Camera and motion work is
  *measured*: hypothesis → change → numbers (sim harness) → verdict, logged
  in `tuning/*.md`. Read the relevant log before re-tuning something; add
  to it when you do.

## Style

- Match the surrounding code: plain functions, no frameworks, comments only
  for constraints the code can't express.
- Visual changes: verify in the browser at real size, both 3D and 2D
  (toggle), light on flourish — this is a learning tool first.
- Motion changes must never break count accuracy: landings stay exactly on
  the beat. Flair goes behind the Groove toggle and must be deterministic
  (no `Math.random` — hash the beat index).

## Good first contributions

- Add a stepsheet fixture for a dance that parses imperfectly (even
  without a fix — a red fixture documenting a real gap is valuable)
- Teach `parsePhrase` a step it doesn't know (check the warnings panel
  when you load a sheet)
- Add a figure to the catalog with its phrasing variants
- A new stepsheet source in `sources.py`

## Pull requests

Keep diffs focused; `node tests/run.js` green (CI runs it on every PR);
say what you verified in the browser and how. Screenshots welcome for
anything visual.
