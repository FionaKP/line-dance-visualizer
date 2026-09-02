#!/usr/bin/env node
"use strict";
/*
 * Build the bundled dance library manifest (library.json at the repo root)
 * from the stepsheet corpus, so the app has a browsable dance list when it
 * runs without server.py (e.g. on GitHub Pages).
 *
 *   node tools/build-library.js
 *
 * Sources, in order:
 *   - tuning/corpus/*.txt        the tuning corpus (25 real sheets)
 *   - tuning/sheets/*.txt        optional extras (style-round sheets etc.)
 *
 * Each entry is { title, counts, walls, level, music, url, source: "bundled",
 * text } where text is the raw CopperKnob-style sheet, loaded in the app
 * through the exact same parseStepsheet path as a pasted sheet. counts /
 * walls / level come from actually parsing the sheet, so the manifest can
 * never disagree with what the app will do with it; a sheet that fails to
 * parse fails the build. Stepsheet URLs are picked up from the corpus
 * INDEX.md table when present.
 *
 * Zero dependencies (requires only the repo's own parser.js).
 */

const fs = require("fs");
const path = require("path");
const { parseStepsheet } = require("../parser.js");

const root = path.join(__dirname, "..");
const SHEET_DIRS = ["tuning/corpus", "tuning/sheets"];

// slug -> stepsheet URL, from markdown index tables: "| [slug](https://...) |"
function loadUrls() {
  const urls = {};
  for (const dir of SHEET_DIRS) {
    const idx = path.join(root, dir, "INDEX.md");
    if (!fs.existsSync(idx)) continue;
    const md = fs.readFileSync(idx, "utf8");
    for (const m of md.matchAll(/\|\s*\[([^\]]+)\]\((https?:[^)\s]+)\)/g)) {
      urls[m[1]] = m[2];
    }
  }
  return urls;
}

function main() {
  const urls = loadUrls();
  const entries = [];
  const failures = [];
  for (const dir of SHEET_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter(x => x.endsWith(".txt")).sort()) {
      const text = fs.readFileSync(path.join(abs, f), "utf8");
      const parsed = parseStepsheet(text);
      if (!parsed.ok) {
        failures.push(f + ": " + (parsed.warnings || []).join("; "));
        continue;
      }
      const slug = f.replace(/\.txt$/, "");
      // the parser falls back to "Pasted dance" for titles it can't read
      // (e.g. a bare "10:35" first line); the sheet's first line wins then
      let title = parsed.title;
      if (!title || title === "Pasted dance") {
        title = (text.split("\n").find(l => l.trim()) || slug).trim();
      }
      entries.push({
        title,
        counts: parsed.wallBeats,
        walls: parsed.walls,
        level: parsed.meta.level || "",
        music: parsed.meta.music || "",
        url: urls[slug] || null,
        source: "bundled",
        text
      });
    }
  }
  if (failures.length) {
    console.error("library build FAILED — unparseable sheets:");
    for (const f of failures) console.error("  " + f);
    process.exit(1);
  }
  entries.sort((a, b) => a.title.localeCompare(b.title));
  const out = path.join(root, "library.json");
  fs.writeFileSync(out, JSON.stringify({ generated: "tools/build-library.js",
                                         dances: entries }, null, 1) + "\n");
  console.log("library.json: " + entries.length + " dances (" +
              (fs.statSync(out).size / 1024).toFixed(0) + " KB)");
}

main();
