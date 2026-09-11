/* Cloudflare Worker: stepsheet search/fetch proxy for the line dance
 * visualizer's static deployment (GitHub Pages).
 *
 * A faithful JavaScript port of sources.py (CopperKnob + Linedancer
 * scrapers, including the mini PDF text extractor) plus the /api routing
 * from server.py. Pure vanilla JS, zero dependencies: the scraping and
 * parsing helpers are exported so node worker/test.js can run them against
 * saved pages/PDFs and compare with sources.py's reference output.
 *
 * Endpoints:
 *   GET /api/ping                -> {ok, mode:"proxy", sources, audio:false}
 *   GET /api/search?q=&source=   -> {results:[...]} (source: copperknob |
 *        &level=&wall=&count_from=&count_to=&lang=   linedancerweb | all)
 *   GET /api/sheet?url=          -> {title, url, text}
 *
 * Politeness mirrors sources.py: one upstream page (or page + PDF pair)
 * per API call, 20s timeouts, no crawling, browser User-Agent. /api/sheet
 * responses are additionally cached for 24h in the Cloudflare edge cache.
 */

const ALLOWED_ORIGINS = [
  /^https:\/\/fionakp\.github\.io$/,
  /^http:\/\/localhost(:\d+)?$/,
];

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

// --- Python-compatible primitives ------------------------------------------

// The whitespace set of Python's str.split() (unicode WS + a few controls),
// so clean()/normSpace() split exactly like `" ".join(s.split())`.
const PY_WS = "\\t\\n\\x0b\\f\\r\\x1c\\x1d\\x1e\\x1f \\x85\\xa0\\u1680" +
              "\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_WS_RUN = new RegExp("[" + PY_WS + "]+", "g");
const PY_STRIP = new RegExp("^[" + PY_WS + "]+|[" + PY_WS + "]+$", "g");
const PY_RSTRIP = new RegExp("[" + PY_WS + "]+$");
// Python's \s in *bytes* regexes is ASCII-only; we mirror byte regexes over
// latin-1 strings, so use this class wherever sources.py used \s on bytes.
const BWS = "[ \\t\\n\\r\\x0b\\f]";

function normSpace(s) {
  // " ".join(s.split())
  return s.split(PY_WS_RUN).filter(Boolean).join(" ");
}

// html.unescape port: numeric refs (with cp1252 quirks) + the HTML4 named
// set with Python's no-semicolon legacy fallback. Exotic named entities
// beyond this table pass through unchanged (a documented divergence).
const ENTITIES = {"AElig": "Æ", "Aacute": "Á", "Acirc": "Â", "Agrave": "À", "Alpha": "Α", "Aring": "Å", "Atilde": "Ã", "Auml": "Ä", "Beta": "Β", "Ccedil": "Ç", "Chi": "Χ", "Dagger": "‡", "Delta": "Δ", "ETH": "Ð", "Eacute": "É", "Ecirc": "Ê", "Egrave": "È", "Epsilon": "Ε", "Eta": "Η", "Euml": "Ë", "Gamma": "Γ", "Iacute": "Í", "Icirc": "Î", "Igrave": "Ì", "Iota": "Ι", "Iuml": "Ï", "Kappa": "Κ", "Lambda": "Λ", "Mu": "Μ", "Ntilde": "Ñ", "Nu": "Ν", "OElig": "Œ", "Oacute": "Ó", "Ocirc": "Ô", "Ograve": "Ò", "Omega": "Ω", "Omicron": "Ο", "Oslash": "Ø", "Otilde": "Õ", "Ouml": "Ö", "Phi": "Φ", "Pi": "Π", "Prime": "″", "Psi": "Ψ", "Rho": "Ρ", "Scaron": "Š", "Sigma": "Σ", "THORN": "Þ", "Tau": "Τ", "Theta": "Θ", "Uacute": "Ú", "Ucirc": "Û", "Ugrave": "Ù", "Upsilon": "Υ", "Uuml": "Ü", "Xi": "Ξ", "Yacute": "Ý", "Yuml": "Ÿ", "Zeta": "Ζ", "aacute": "á", "acirc": "â", "acute": "´", "aelig": "æ", "agrave": "à", "alefsym": "ℵ", "alpha": "α", "amp": "&", "and": "∧", "ang": "∠", "aring": "å", "asymp": "≈", "atilde": "ã", "auml": "ä", "bdquo": "„", "beta": "β", "brvbar": "¦", "bull": "•", "cap": "∩", "ccedil": "ç", "cedil": "¸", "cent": "¢", "chi": "χ", "circ": "ˆ", "clubs": "♣", "cong": "≅", "copy": "©", "crarr": "↵", "cup": "∪", "curren": "¤", "dArr": "⇓", "dagger": "†", "darr": "↓", "deg": "°", "delta": "δ", "diams": "♦", "divide": "÷", "eacute": "é", "ecirc": "ê", "egrave": "è", "empty": "∅", "emsp": " ", "ensp": " ", "epsilon": "ε", "equiv": "≡", "eta": "η", "eth": "ð", "euml": "ë", "euro": "€", "exist": "∃", "fnof": "ƒ", "forall": "∀", "frac12": "½", "frac14": "¼", "frac34": "¾", "frasl": "⁄", "gamma": "γ", "ge": "≥", "gt": ">", "hArr": "⇔", "harr": "↔", "hearts": "♥", "hellip": "…", "iacute": "í", "icirc": "î", "iexcl": "¡", "igrave": "ì", "image": "ℑ", "infin": "∞", "int": "∫", "iota": "ι", "iquest": "¿", "isin": "∈", "iuml": "ï", "kappa": "κ", "lArr": "⇐", "lambda": "λ", "lang": "〈", "laquo": "«", "larr": "←", "lceil": "⌈", "ldquo": "“", "le": "≤", "lfloor": "⌊", "lowast": "∗", "loz": "◊", "lrm": "‎", "lsaquo": "‹", "lsquo": "‘", "lt": "<", "macr": "¯", "mdash": "—", "micro": "µ", "middot": "·", "minus": "−", "mu": "μ", "nabla": "∇", "nbsp": " ", "ndash": "–", "ne": "≠", "ni": "∋", "not": "¬", "notin": "∉", "nsub": "⊄", "ntilde": "ñ", "nu": "ν", "oacute": "ó", "ocirc": "ô", "oelig": "œ", "ograve": "ò", "oline": "‾", "omega": "ω", "omicron": "ο", "oplus": "⊕", "or": "∨", "ordf": "ª", "ordm": "º", "oslash": "ø", "otilde": "õ", "otimes": "⊗", "ouml": "ö", "para": "¶", "part": "∂", "permil": "‰", "perp": "⊥", "phi": "φ", "pi": "π", "piv": "ϖ", "plusmn": "±", "pound": "£", "prime": "′", "prod": "∏", "prop": "∝", "psi": "ψ", "quot": "\"", "rArr": "⇒", "radic": "√", "rang": "〉", "raquo": "»", "rarr": "→", "rceil": "⌉", "rdquo": "”", "real": "ℜ", "reg": "®", "rfloor": "⌋", "rho": "ρ", "rlm": "‏", "rsaquo": "›", "rsquo": "’", "sbquo": "‚", "scaron": "š", "sdot": "⋅", "sect": "§", "shy": "­", "sigma": "σ", "sigmaf": "ς", "sim": "∼", "spades": "♠", "sub": "⊂", "sube": "⊆", "sum": "∑", "sup": "⊃", "sup1": "¹", "sup2": "²", "sup3": "³", "supe": "⊇", "szlig": "ß", "tau": "τ", "there4": "∴", "theta": "θ", "thetasym": "ϑ", "thinsp": " ", "thorn": "þ", "tilde": "˜", "times": "×", "trade": "™", "uArr": "⇑", "uacute": "ú", "uarr": "↑", "ucirc": "û", "ugrave": "ù", "uml": "¨", "upsih": "ϒ", "upsilon": "υ", "uuml": "ü", "weierp": "℘", "xi": "ξ", "yacute": "ý", "yen": "¥", "yuml": "ÿ", "zeta": "ζ", "zwj": "‍", "zwnj": "‌"};
const ENTITIES_NOSEMI = new Set(["AElig", "Aacute", "Acirc", "Agrave", "Aring", "Atilde", "Auml", "Ccedil", "ETH", "Eacute", "Ecirc", "Egrave", "Euml", "Iacute", "Icirc", "Igrave", "Iuml", "Ntilde", "Oacute", "Ocirc", "Ograve", "Oslash", "Otilde", "Ouml", "THORN", "Uacute", "Ucirc", "Ugrave", "Uuml", "Yacute", "aacute", "acirc", "acute", "aelig", "agrave", "amp", "aring", "atilde", "auml", "brvbar", "ccedil", "cedil", "cent", "copy", "curren", "deg", "divide", "eacute", "ecirc", "egrave", "eth", "euml", "frac12", "frac14", "frac34", "gt", "iacute", "icirc", "iexcl", "igrave", "iquest", "iuml", "laquo", "lt", "macr", "micro", "middot", "nbsp", "not", "ntilde", "oacute", "ocirc", "ograve", "ordf", "ordm", "oslash", "otilde", "ouml", "para", "plusmn", "pound", "quot", "raquo", "reg", "sect", "shy", "sup1", "sup2", "sup3", "szlig", "thorn", "times", "uacute", "ucirc", "ugrave", "uml", "uuml", "yacute", "yen", "yuml"]);

// numeric charrefs in 0x80-0x9f decode through cp1252, like html.unescape
const CP1252 = {0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„",
  0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰",
  0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘",
  0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–",
  0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›",
  0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ"};

function numericRef(num) {
  if (num === 0) return "�";
  if (num === 0x0d) return "\r";
  if (num >= 0x80 && num <= 0x9f) return CP1252[num] || String.fromCharCode(num);
  if ((num >= 0xd800 && num <= 0xdfff) || num > 0x10ffff) return "�";
  if ((num >= 0x01 && num <= 0x08) || (num >= 0x0e && num <= 0x1f) || num === 0x7f)
    return "";  // html.unescape drops these control chars
  return String.fromCodePoint(num);
}

export function htmlUnescape(s) {
  if (!s.includes("&")) return s;
  return s.replace(/&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[A-Za-z][A-Za-z0-9]{0,31};?)/g,
    (whole, body) => {
      if (body[0] === "#") {
        const hex = body[1] === "x" || body[1] === "X";
        const digits = body.replace(/^#[xX]?|;$/g, "");
        return numericRef(parseInt(digits, hex ? 16 : 10));
      }
      const semi = body.endsWith(";");
      const name = semi ? body.slice(0, -1) : body;
      if (semi && Object.prototype.hasOwnProperty.call(ENTITIES, name))
        return ENTITIES[name];
      // legacy prefix match (Python tries the longest known prefix)
      for (let n = name.length; n > 0; n--) {
        const pre = name.slice(0, n);
        if (ENTITIES_NOSEMI.has(pre))
          return ENTITIES[pre] + name.slice(n) + (semi ? ";" : "");
      }
      return whole;
    });
}

export function stripTags(s) {
  s = s.replace(/<\/?(?:mark|b|i|em|strong|span|a|small|nobr)\b[^>]*>/g, "");
  return htmlUnescape(s.replace(/<[^>]+>/g, " "));
}

export function clean(s) {
  return normSpace(stripTags(s));
}

// --- upstream fetch ---------------------------------------------------------

async function fetchText(url, data = null) {
  const init = {
    headers: { ...HEADERS },
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
  };
  if (data) {
    init.method = "POST";
    init.body = new URLSearchParams(data).toString();
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  const r = await fetch(url, init);
  if (!r.ok) throw new Error("HTTP Error " + r.status + ": " + r.statusText);
  return r.text();  // always UTF-8 with replacement, like sources.py
}

async function fetchBytes(url) {
  const r = await fetch(url, {
    headers: { ...HEADERS, Accept: "*/*" },
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
  });
  if (!r.ok) throw new Error("HTTP Error " + r.status + ": " + r.statusText);
  return new Uint8Array(await r.arrayBuffer());
}

// --- CopperKnob -------------------------------------------------------------

export const copperknob = {
  name: "copperknob",
  label: "CopperKnob",
  filters: ["level", "wall", "count", "lang"],
  BASE: "https://www.copperknob.co.uk",

  matches(url) {
    return /^https:\/\/www\.copperknob\.co\.uk\/stepsheets\/[\w-]+\/[\w-]+$/.test(url);
  },

  async search(q, qs) {
    const params = new URLSearchParams({
      Search: q,
      Level: qs.get("level") || "",
      Wall: qs.get("wall") || "",
      BeatFrom: qs.get("count_from") || "",
      BeatTo: qs.get("count_to") || "",
      Lang: qs.get("lang") || "",
    });
    return this.parseSearch(await fetchText(this.BASE + "/search?" + params));
  },

  parseSearch(page) {
    const results = [];
    for (let chunk of page.split('<div class="listitem"').slice(1)) {
      chunk = chunk.slice(0, 3000);
      const urlM = /href="(https:\/\/www\.copperknob\.co\.uk\/stepsheets\/[^"]+)"/.exec(chunk);
      const titleM = /<span class="listTitleColor1">([\s\S]*?)<\/span>/.exec(chunk);
      const choreoM = /<span class="listTitleColor2">([\s\S]*?)<\/span>/.exec(chunk);
      const infoM = /<p class="listIcons">([\s\S]*?)<\/p>/.exec(chunk);
      if (!urlM || !titleM) continue;
      const item = {
        url: urlM[1],
        title: clean(titleM[1]),
        choreo: choreoM ? clean(choreoM[1]) : "",
      };
      if (infoM) {
        const info = clean(infoM[1]);
        let m = /(\d+)\s*Count/.exec(info);
        if (m) item.count = parseInt(m[1], 10);
        m = /(\d+)\s*Wall/.exec(info);
        if (m) item.wall = parseInt(m[1], 10);
        m = /Wall\s+([\s\S]*?)\s*Music:/.exec(info);
        if (m) item.level = m[1].trim();
        m = /Music:\s*(.*)$/.exec(info);
        if (m) item.music = m[1].trim();
      }
      results.push(item);
    }
    return results;
  },

  async fetchSheet(url) {
    return this.parseSheet(await fetchText(url), url);
  },

  parseSheet(page, url) {
    let title = null;
    const tm = /<title>([\s\S]*?)<\/title>/.exec(page);
    if (tm) {
      const parts = htmlUnescape(tm[1]).split(" - ").map((p) => p.trim());
      if (parts.length >= 2 && parts[0] === "CopperKnob") title = parts[1];
    }

    const fields = {};
    const im = /<div class="sheetinfo">([\s\S]*?)<div class="sheet">/.exec(page);
    if (im) {
      const info = clean(im[1]);
      for (const [key, label, pat] of [
        ["count", "Count", "(\\d+)"], ["wall", "Wall", "(\\d+)"],
        ["level", "Level", "(.+?)"], ["choreo", "Choreo", "(.+?)"],
        ["music", "Music", "(.+?)"],
      ]) {
        const m = new RegExp(label + "\\s*:\\s*" + pat +
          "(?=\\s*(?:Count|Wall|Level|Choreo|Music)\\s*:|$)").exec(info);
        if (m && m[1].trim())
          fields[key] = m[1].trim().replace(/^Choreographers?\s*:\s*/, "");
      }
    }

    let cm = /<div class="sheetcontent">([\s\S]*?)<div class="sheetvideos"/.exec(page);
    if (!cm) cm = /<div class="sheetcontent">([\s\S]*?)<\/div>\s*<\/div>/.exec(page);
    let body = cm ? cm[1] : "";
    body = body.replace(
      /<span class="step">([\s\S]*?)<\/span>\s*<span class="desc">([\s\S]*?)<\/span>/g,
      (_, a, b) => stripTags(a).trim() + " " + stripTags(b).trim());
    body = body.replace(/<br\s*\/?>/g, "\n");
    body = body.replace(/<[^>]+>/g, "");
    body = htmlUnescape(body);
    const lines = [];
    for (let l of body.split("\n")) {
      l = normSpace(l);
      // everything from the contact/update footer down is site chrome
      if (/^(contact|last update)\b/i.test(l)) break;
      // calendar/date fragments from the page sidebar
      if (/^\d{0,2}\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/i.test(l)) continue;
      lines.push(l);
    }
    body = lines.join("\n");
    body = body.replace(/\n{3,}/g, "\n\n").replace(PY_STRIP, "");

    const text = composeSheetText(title || "CopperKnob dance", fields, body);
    return { title, url, text };
  },
};

// --- Linedancer (linedancerweb.com) -----------------------------------------

export const linedancerweb = {
  name: "linedancerweb",
  label: "Linedancer",
  filters: ["level", "wall"],
  BASE: "https://www.linedancerweb.com",

  matches(url) {
    return /^https:\/\/www\.linedancerweb\.com\/dance\.php\?id=\d+$/.test(url);
  },

  async search(q, qs) {
    const data = { search: q, searchoption: "All" };
    const level = qs.get("level") || "";
    if (level) data.searchlevel = level;
    const wall = qs.get("wall") || "";
    if (wall) data.walls = wall;
    return this.parseSearch(await fetchText(this.BASE + "/search.php", data));
  },

  parseSearch(page) {
    const results = [];
    for (let chunk of page.split('<div class="resultsholder').slice(1)) {
      chunk = chunk.slice(0, 4000);
      const idM = /dance\.php\?id=(\d+)/.exec(chunk);
      const titleM = /<div class="resultbold">([\s\S]*?)<\/div>/.exec(chunk);
      if (!idM || !titleM) continue;
      const item = {
        url: this.BASE + "/dance.php?id=" + idM[1],
        title: clean(titleM[1]),
        choreo: "",
      };
      const italics = [...chunk.matchAll(/<div class="resultitalic">([\s\S]*?)<\/div>/g)]
        .map((m) => m[1]);
      if (italics.length) item.choreo = clean(italics[0]).replace(/\.\s*$/, "");
      const smallM = /<div class="resultsmall">([\s\S]*?)<\/div>/.exec(chunk);
      if (smallM) {
        const info = clean(smallM[1]);
        let m = /(\d+)\s*count/.exec(info);
        if (m) item.count = parseInt(m[1], 10);
        m = /(\d+)\s*wall/.exec(info);
        if (m) item.wall = parseInt(m[1], 10);
      }
      const levelM = /<span class="desktoponly111">([\s\S]*?)<\/span>/.exec(chunk);
      if (levelM && clean(levelM[1])) item.level = clean(levelM[1]);
      // song title + artist
      const songM = /<div class="resultnormal">([\s\S]*?)<\/div>/.exec(chunk);
      if (songM) {
        let music = clean(songM[1]);
        if (italics.length > 1 && clean(italics[1])) music += " - " + clean(italics[1]);
        if (music) item.music = music;
      }
      results.push(item);
    }
    return results;
  },

  async fetchSheet(url) {
    const page = await fetchText(url);
    const { fields, title } = this.parseDancePage(page);
    const danceId = /id=(\d+)/.exec(url)[1];
    const pdf = await fetchBytes(this.BASE + "/viewpdf.php?dance=" + danceId);
    const body = this.normalizeBody(await pdfToText(pdf), title);
    const text = composeSheetText(title || "Linedancer dance", fields, body);
    return { title, url, text };
  },

  parseDancePage(page) {
    const tm = /<b style="font-size:1\.2em;">([\s\S]*?)<\/b>/.exec(page);
    const title = tm ? clean(tm[1]) : null;
    const info = {};
    for (const m of page.matchAll(
      /<div class="dancetitle">([\s\S]*?)<\/div>\s*<div class="dancecontent">([\s\S]*?)<\/div>/g)) {
      info[clean(m[1])] = clean(m[2].replace(/\(<a[^>]*>view all[^<]*<\/a>\)/g, ""));
    }
    const fields = {};
    if (/^\d+$/.test(info["Count"] || "")) fields.count = info["Count"];
    if (/^\d+$/.test(info["Walls"] || "")) fields.wall = info["Walls"];
    if (info["Level"]) fields.level = info["Level"];
    if (info["Choreographed By"])
      fields.choreo = info["Choreographed By"].replace(/\.\s*$/, "");
    if (info["Choreographed to"]) {
      let music = info["Choreographed to"].replace(/\.\s*$/, "").trim();
      if (info["Artist"]) music += " - " + info["Artist"];
      fields.music = music;
    }
    return { fields, title };
  },

  // PDF page furniture that is not part of the dance
  _CHROME: new RegExp(
    "^(www\\.|Website:|Email:|E-?mail\\b|Remember\\b|Last Updated|" +
    "Choreographed (by|to)\\s*:|\\d+\\s*Count\\b|Script approved by|" +
    "A Video Of This Dance|Music available|Linedance Foundation\\b|" +
    ".*linedancer-?web\\.com|" +
    ".*linedancefoundation\\.com|.*crystalbootawards\\.com|" +
    ".*kingshilldanceholidays\\.com)", "i"),

  normalizeBody(text, title) {
    const lines = [];
    for (const raw of text.split("\n")) {
      let l = normSpace(raw);
      if (this._CHROME.test(l)) continue;
      if (l && !/[A-Za-z0-9]/.test(l)) continue; // stray punctuation from page furniture
      if (title && l.toLowerCase() === title.toLowerCase()) continue;
      const m = /^Intro\s*:?[\s]*([\s\S]*)$/i.exec(l);
      if (m) {
        const cm = /(\d+)\s*counts?/i.exec(m[1]);
        lines.push(cm ? "Starts after " + cm[1] + " counts" : "Start: " + m[1]);
        continue;
      }
      // expand foot shorthand so the parser can track feet
      // (lookarounds mimic Python's unicode-aware \b word boundaries)
      l = l.replace(/(?<![\p{L}\p{N}_])RF(?![\p{L}\p{N}_])/gu, "right foot");
      l = l.replace(/(?<![\p{L}\p{N}_])LF(?![\p{L}\p{N}_])/gu, "left foot");
      l = l.replace(/(?<![\p{L}\p{N}_])R(?![\p{L}\p{N}_])/gu, "right");
      l = l.replace(/(?<![\p{L}\p{N}_])L(?![\p{L}\p{N}_])/gu, "left");
      lines.push(l);
    }
    const body = lines.join("\n");
    return body.replace(/\n{3,}/g, "\n\n").replace(PY_STRIP, "");
  },
};

export function composeSheetText(title, fields, body) {
  const header = [title];
  const metaBits = [];
  if (fields.count) metaBits.push("Count: " + fields.count);
  if (fields.wall) metaBits.push("Wall: " + fields.wall);
  if (fields.level) metaBits.push("Level: " + fields.level);
  if (metaBits.length) header.push(metaBits.join("  "));
  if (fields.choreo) header.push("Choreo: " + fields.choreo);
  if (fields.music) header.push("Music: " + fields.music);
  return header.join("\n") + "\n\n" + body;
}

// --- Mini PDF text extractor (port of sources.py's) --------------------------
// Bytes are handled as latin-1 strings (code unit == byte value) so the
// original byte-level regexes port one-to-one; real byte work (inflate)
// round-trips through Uint8Array. FlateDecode uses the platform's
// DecompressionStream("deflate"); unlike Python's zlib.decompress it
// rejects trailing bytes after the stream end (PDF streams routinely have
// a newline before `endstream`), so we collect output chunks and accept a
// "trailing junk" error after data was produced, falling back to
// "deflate-raw" with the 2-byte zlib header stripped for odd headers.

function fromBytes(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000)
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return s;
}

function toBytes(s) {
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
  return u8;
}

// Python's round(): banker's rounding on halves
function pyRound(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

async function tryDecompress(format, u8) {
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  writer.write(u8).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks = [];
  let sawError = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } catch (e) {
    sawError = e;
  }
  if (sawError) {
    // zlib.decompress ignores bytes after the end of the stream; only an
    // error after complete output (trailing junk) is safe to swallow
    if (!chunks.length || !/junk|trailing/i.test(String(sawError && sawError.message)))
      return null;
  }
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function pdfInflate(u8) {
  const zlibHeaderOk = u8.length > 2 && (u8[0] & 0x0f) === 8 &&
    ((u8[0] << 8) | u8[1]) % 31 === 0;
  let out = await tryDecompress("deflate", u8).catch(() => null);
  if (out === null && zlibHeaderOk)
    out = await tryDecompress("deflate-raw", u8.subarray(2)).catch(() => null);
  return out === null ? null : fromBytes(out);
}

function a85decode(s) {
  // base64.a85decode equivalent; input already stripped of whitespace/<~ ~>
  const out = [];
  let group = [], zcount = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (ch === "z" && group.length === 0) { out.push(0, 0, 0, 0); zcount++; continue; }
    if (c < 33 || c > 117) throw new Error("bad ascii85 char");
    group.push(c - 33);
    if (group.length === 5) {
      let n = 0;
      for (const g of group) n = n * 85 + g;
      if (n > 0xffffffff) throw new Error("ascii85 overflow");
      out.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
      group = [];
    }
  }
  if (group.length === 1) throw new Error("ascii85 trailing char");
  if (group.length) {
    const pad = 5 - group.length;
    const padded = group.concat(Array(pad).fill(84)); // 'u' - 33
    let n = 0;
    for (const g of padded) n = n * 85 + g;
    if (n > 0xffffffff) throw new Error("ascii85 overflow");
    const bytes = [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    out.push(...bytes.slice(0, 4 - pad));
  }
  return out.map((b) => String.fromCharCode(b)).join("");
}

async function pdfStream(body) {
  // old writers (Acrobat PDFWriter) end the `stream` keyword with a bare \r
  const sm = /stream(?:\r\n|\r|\n)([\s\S]*?)endstream/.exec(body);
  if (!sm) return null;
  let raw = sm[1];
  if (body.includes("/ASCII85Decode")) {
    try {
      raw = raw.replace(new RegExp(BWS, "g"), "");
      raw = a85decode(raw.replace(/^<~|~>?$/g, ""));
    } catch (e) {
      return null;
    }
  }
  if (body.includes("/FlateDecode")) {
    const a = await pdfInflate(toBytes(raw));
    if (a !== null && a.length) return a;
    const b = await pdfInflate(toBytes(raw.replace(/^[\r\n ]+|[\r\n ]+$/g, "")));
    return b !== null ? b : a;
  }
  return raw;
}

async function pdfObjects(data) {
  // Map object number -> body (latin-1 string), including /ObjStm members
  const objs = new Map();
  const objRe = new RegExp("(\\d+)" + BWS + "+\\d+" + BWS + "+obj\\b([\\s\\S]*?)endobj", "g");
  for (const m of data.matchAll(objRe)) {
    objs.set(parseInt(m[1], 10), m[2]);
  }
  for (const body of [...objs.values()]) {
    if (!body.includes("/ObjStm")) continue;
    const inner = await pdfStream(body);
    const nm = new RegExp("/N" + BWS + "+(\\d+)").exec(body);
    const fm = new RegExp("/First" + BWS + "+(\\d+)").exec(body);
    if (inner === null || !nm || !fm) continue;
    const first = parseInt(fm[1], 10);
    const header = inner.slice(0, first).split(/[ \t\n\r\x0b\f]+/).filter(Boolean);
    const n = parseInt(nm[1], 10);
    const pairs = [];
    for (let i = 0; i < 2 * n; i += 2)
      pairs.push([parseInt(header[i], 10), parseInt(header[i + 1], 10)]);
    for (let i = 0; i < pairs.length; i++) {
      const [onum, off] = pairs[i];
      const end = i + 1 < pairs.length ? first + pairs[i + 1][1] : inner.length;
      objs.set(onum, inner.slice(first + off, end));
    }
  }
  return objs;
}

function pdfToUnicode(cmapStr) {
  // bfchar/bfrange entries -> Map(cid -> unicode string). cmapStr is the
  // latin-1 view of the CMap stream (Python decodes latin-1 here too).
  const out = new Map();
  const SWS = "[\\s\\x1c-\\x1f\\x85]"; // Python str-level \s over latin-1 text
  const pair = new RegExp("<([0-9A-Fa-f]+)>" + SWS + "*<([0-9A-Fa-f]+)>", "g");
  const triple = new RegExp(
    "<([0-9A-Fa-f]+)>" + SWS + "*<([0-9A-Fa-f]+)>" + SWS + "*<([0-9A-Fa-f]+)>", "g");
  for (const block of cmapStr.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(pair)) {
      const dst = m[2];
      let str = "";
      for (let i = 0; i < dst.length; i += 4)
        str += String.fromCharCode(parseInt(dst.slice(i, i + 4), 16));
      out.set(parseInt(m[1], 16), str);
    }
  }
  for (const block of cmapStr.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(triple)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16), base = parseInt(m[3], 16);
      for (let cid = lo; cid <= hi; cid++)
        out.set(cid, String.fromCharCode(base + cid - lo));
    }
  }
  return out;
}

async function pdfFonts(objs) {
  // font resource name ("F2") -> ToUnicode cid map, or null for simple fonts
  const fonts = new Map();
  for (const body of objs.values()) {
    const fm = new RegExp("/Font" + BWS + "*<<([\\s\\S]*?)>>").exec(body);
    if (!fm) continue;
    const refRe = new RegExp("/(F\\d+)" + BWS + "+(\\d+)" + BWS + "+\\d+" + BWS + "+R", "g");
    for (const rm of fm[1].matchAll(refRe)) {
      const name = rm[1];
      const font = objs.get(parseInt(rm[2], 10));
      if (font === undefined || fonts.has(name)) continue;
      let cmap = null;
      const tu = new RegExp("/ToUnicode" + BWS + "+(\\d+)" + BWS + "+\\d+" + BWS + "+R").exec(font);
      if (tu) {
        const stream = objs.get(parseInt(tu[1], 10));
        const raw = stream !== undefined ? await pdfStream(stream) : null;
        if (raw) cmap = pdfToUnicode(raw);
      }
      fonts.set(name, cmap);
    }
  }
  return fonts;
}

const PDF_ESCAPES = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f",
                      "(": "(", ")": ")", "\\": "\\" };

const UTF8_STRICT = new TextDecoder("utf-8", { fatal: true });

function pdfBytesToStr(byteStr, cmap) {
  if (cmap) { // 2-byte CIDs through the font's ToUnicode map
    let out = "";
    for (let k = 0; k < byteStr.length - 1; k += 2) {
      const cid = (byteStr.charCodeAt(k) << 8) | byteStr.charCodeAt(k + 1);
      out += cmap.get(cid) || "";
    }
    return out;
  }
  try {
    return UTF8_STRICT.decode(toBytes(byteStr));
  } catch (e) {
    return byteStr; // latin-1 view is already codepoint == byte
  }
}

function pdfLiteral(raw, cmap) {
  let b = "", i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c === "\\") {
      const nxt = raw[i + 1] || "";
      if (/^[0-9]$/.test(nxt)) {
        let j = i + 1;
        while (j < Math.min(i + 4, raw.length) && /[0-9]/.test(raw[j])) j++;
        b += String.fromCharCode(parseInt(raw.slice(i + 1, j), 8) & 0xff);
        i = j;
        continue;
      }
      const mapped = PDF_ESCAPES[nxt] !== undefined ? PDF_ESCAPES[nxt] : (nxt || "?");
      b += String.fromCharCode(mapped.charCodeAt(0) & 0xff);
      i += 2;
      continue;
    }
    b += c;
    i += 1;
  }
  return pdfBytesToStr(b, cmap);
}

function pdfHex(hx, cmap) {
  hx = hx.replace(new RegExp(BWS, "g"), "");
  if (hx.length % 2) hx += "0";
  let b = "";
  for (let i = 0; i < hx.length; i += 2)
    b += String.fromCharCode(parseInt(hx.slice(i, i + 2), 16));
  return pdfBytesToStr(b, cmap);
}

const PDF_TOKEN = new RegExp(
  "\\((?<lit>(?:\\\\[^\\n]|[^()\\\\])*)\\)|<(?<hex>[0-9A-Fa-f \\t\\n\\r\\x0b\\f]+)>" +
  "|/(?<name>[A-Za-z0-9]+)|(?<num>-?\\d+(?:\\.\\d+)?)|(?<op>[A-Za-z'\"*]{1,3})", "g");

function pdfRuns(content, fonts) {
  // walk a content stream; collect (y, x, text) for each text run
  const runs = [];
  let curFont = null;
  let x = 0.0, y = 0.0;
  let rotated = false;
  let stack = [];
  for (const m of content.matchAll(PDF_TOKEN)) {
    const g = m.groups;
    if (g.lit !== undefined) {
      stack.push(["str", pdfLiteral(g.lit, fonts.get(curFont) || null)]);
    } else if (g.hex !== undefined) {
      stack.push(["str", pdfHex(g.hex, fonts.get(curFont) || null)]);
    } else if (g.name !== undefined) {
      stack.push(["name", g.name]);
    } else if (g.num !== undefined) {
      stack.push(["num", parseFloat(g.num)]);
    } else {
      const op = g.op;
      if (op === "Tf" && stack.length >= 2 && stack[stack.length - 2][0] === "name") {
        curFont = stack[stack.length - 2][1];
      } else if (op === "Tm" && stack.length >= 6) {
        const nums = stack.slice(-6).filter(([t]) => t === "num").map(([, v]) => v);
        if (nums.length === 6) {
          x = nums[4];
          y = nums[5];
          // skip rotated page-margin decorations
          rotated = Math.abs(nums[1]) > 0.01 || Math.abs(nums[2]) > 0.01;
        }
      } else if ((op === "Td" || op === "TD") && stack.length >= 2) {
        const nums = stack.slice(-2).filter(([t]) => t === "num").map(([, v]) => v);
        if (nums.length === 2) {
          x += nums[0];
          y += nums[1];
        }
      } else if (op === "Tj" || op === "'") {
        if (stack.length && stack[stack.length - 1][0] === "str" && !rotated)
          runs.push([y, x, stack[stack.length - 1][1]]);
      } else if (op === "TJ") {
        const text = stack.filter(([t]) => t === "str").map(([, v]) => v).join("");
        if (text && !rotated) runs.push([y, x, text]);
      }
      stack = [];
    }
  }
  return runs;
}

export async function pdfToText(bytes) {
  // text of a digitally-produced PDF, one string, lines in page order
  const data = fromBytes(bytes);
  const objs = await pdfObjects(data);
  const fonts = await pdfFonts(objs);
  const pages = [];
  for (const body of objs.values()) {
    const head = body.slice(0, 400);
    if (head.includes("/ObjStm") || head.includes("/XObject") || head.includes("/Length1"))
      continue;
    const raw = await pdfStream(body);
    if (!raw || !raw.includes("BT") || !raw.includes("Tf")) continue;
    const runs = pdfRuns(raw, fonts);
    if (!runs.length) continue;
    const lines = new Map();
    for (const [ry, rx, text] of runs) {
      const key = pyRound(ry);
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push([rx, text]);
    }
    const page = [];
    const keys = [...lines.keys()].sort((a, b) => b - a);
    for (const ly of keys) {
      const parts = lines.get(ly).slice().sort(
        (a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
      let line = "";
      let prevEnd = null;
      for (const [rx, text] of parts) {
        if (line && prevEnd !== null && rx - prevEnd > 4) line += " ";
        line += text;
        prevEnd = rx + [...text].length * 4.5;
      }
      page.push(line.replace(PY_RSTRIP, ""));
    }
    pages.push(page.join("\n"));
  }
  return pages.join("\n");
}

// --- Registry ----------------------------------------------------------------

export const SOURCES = { copperknob, linedancerweb };

export function sourceForUrl(url) {
  for (const src of Object.values(SOURCES)) {
    if (src.matches(url)) return src;
  }
  return null;
}

// --- HTTP layer (mirrors server.py's /api routing) ---------------------------

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  if (origin && ALLOWED_ORIGINS.some((re) => re.test(origin)))
    return { "Access-Control-Allow-Origin": origin, "Vary": "Origin" };
  return { "Vary": "Origin" };
}

function jsonResponse(obj, status, cors, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors, ...extra },
  });
}

async function handleSearch(url, cors) {
  const qs = url.searchParams;
  const q = qs.get("q") || "";
  const which = qs.get("source") || "copperknob";
  const names = which === "all" ? Object.keys(SOURCES) : [which];
  if (names.some((n) => !(n in SOURCES))) {
    return jsonResponse({ error: "Unknown source '" + which + "'. Sources: " +
      Object.keys(SOURCES).join(", ") + ", all." }, 400, cors);
  }
  const perSource = [], errors = [];
  for (const n of names) {
    try {
      const got = await SOURCES[n].search(q, qs);
      for (const r of got) r.source = n;
      perSource.push(got);
    } catch (e) {
      errors.push(SOURCES[n].label + ": " + (e && e.message ? e.message : e));
    }
  }
  if (!perSource.length && errors.length)
    return jsonResponse({ error: errors.join("; ") }, 502, cors);
  // merge round-robin so no site monopolizes the top of the list
  const results = [];
  const longest = perSource.length ? Math.max(...perSource.map((g) => g.length)) : 0;
  for (let i = 0; i < longest; i++) {
    for (const got of perSource) {
      if (i < got.length) results.push(got[i]);
    }
  }
  const out = { results };
  if (errors.length) out.errors = errors;
  return jsonResponse(out, 200, cors);
}

async function handleSheet(request, url, cors, ctx) {
  const sheetUrl = url.searchParams.get("url") || "";
  const src = sourceForUrl(sheetUrl);
  if (src === null) {
    return jsonResponse({ error: "Unsupported stepsheet URL. Supported sites: " +
      Object.values(SOURCES).map((s) => s.label).join(", ") + "." }, 400, cors);
  }
  // stepsheets are effectively immutable: serve from the edge cache when we
  // can, so repeat loads never re-hit the source site
  const cacheKey = new Request(url.origin + "/api/sheet?url=" + encodeURIComponent(sheetUrl));
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const resp = new Response(hit.body, hit);
      for (const [k, v] of Object.entries(cors)) resp.headers.set(k, v);
      return resp;
    }
  }
  const sheet = await src.fetchSheet(sheetUrl);
  const resp = jsonResponse(sheet, 200, cors, { "Cache-Control": "public, max-age=86400" });
  if (cache && ctx) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        ...cors,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      } });
    }
    if (request.method !== "GET")
      return jsonResponse({ error: "GET only." }, 405, cors);

    try {
      if (url.pathname === "/api/ping") {
        return jsonResponse({ ok: true, mode: "proxy",
          sources: Object.keys(SOURCES), audio: false }, 200, cors);
      }
      if (url.pathname === "/api/search") return await handleSearch(url, cors);
      if (url.pathname === "/api/sheet") return await handleSheet(request, url, cors, ctx);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      return jsonResponse({ error: "Upstream request failed: " + msg }, 502, cors);
    }
    return jsonResponse({ error: "Not found. Endpoints: /api/ping, /api/search, /api/sheet." },
      404, cors);
  },
};
