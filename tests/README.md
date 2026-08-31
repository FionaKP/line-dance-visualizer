# Parser + tempo eval harness

```
node tests/run.js               # full scorecard, appends to history.jsonl
node tests/run.js --dump NAME   # print parsed events for a fixture
```

The runner checks two things:

- **Parser** (`parser.js`): every `fixtures/NAME.txt` stepsheet is parsed and
  compared against `expected/NAME.json`. Expectations are hand-written
  semantic spot checks (this beat moves forward, this beat turns 180°), not
  full dumps — so unrelated parser improvements don't break them.
- **Tempo** (`tempo.js`): synthesized kick tracks at known BPMs (with intro
  silence, noise, off-beat eighths) are fed to `gridFromWave`; detected BPM
  must be within 0.75 and the first beat within 60 ms of the click grid.

Each run appends totals to `history.jsonl` (gitignored) and prints the delta
vs the previous run — a change that makes fewer checks pass is loud.

## Workflow for improving the parser

1. Found a stepsheet that parses wrong? Add it (or a minimal cut of it) to
   `fixtures/`, use `--dump` to see what the parser does, and write an
   `expected/` file asserting what it *should* do.
2. Run `node tests/run.js` — the new checks fail.
3. Fix the parser. All checks green, delta positive. Commit fixture + fix
   together.

Keep expectations minimal: assert direction signs and ranges (`dyMin`,
`dxMax`) over exact magnitudes where the exact value is a tuning choice.

## Known gaps (candidates for the next fixtures + fixes)

- A dance whose **title** starts with "Tag"/"Restart" (e.g. "Tag Trouble")
  is eaten by the tag/restart line filter and lost.
- **Jazz box** is not in the step vocabulary (see `unsupported` fixture).
- **Sway** is not in the step vocabulary.
- **Tags and restarts** are skipped with a warning rather than modeled.
- Tempo detection has no coverage yet for tempo drift, half-time feels with
  strong backbeat, or real-audio regression clips (would need small audio
  fixtures checked into the repo).
