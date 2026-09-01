"""Stepsheet sources: per-site search + sheet scrapers behind one registry.

Each source normalizes to:
  search(q, qs)     -> [{url, title, choreo, count, wall, level, music}]
  fetch_sheet(url)  -> {"title", "url", "text"}   (text is CopperKnob-ish
                       plain stepsheet text that parser.js understands)

`SOURCES` maps source name -> instance; `source_for_url` routes a stepsheet
URL to the source that owns it. Scrapers are polite: one upstream page (or
page + script file) per user action, 20s timeouts, no crawling.
"""

import html
import re
import urllib.parse
import urllib.request
import zlib

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}


def fetch(url, data=None):
    """GET (or POST form `data`) a page as text with a browser User-Agent."""
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def fetch_bytes(url):
    req = urllib.request.Request(url, headers=dict(HEADERS, Accept="*/*"))
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def strip_tags(s):
    s = re.sub(r"</?(?:mark|b|i|em|strong|span|a|small|nobr)\b[^>]*>", "", s)
    return html.unescape(re.sub(r"<[^>]+>", " ", s))


def clean(s):
    return " ".join(strip_tags(s).split()).replace(" ", " ").strip()


class Source:
    name = ""          # registry key / value of the ?source= param
    label = ""         # human-readable site name for the UI
    filters = ()       # which of the UI filters this site's search honors

    def matches(self, url):
        raise NotImplementedError

    def search(self, q, qs):
        raise NotImplementedError

    def fetch_sheet(self, url):
        raise NotImplementedError


# --- CopperKnob ------------------------------------------------------------

class CopperKnob(Source):
    name = "copperknob"
    label = "CopperKnob"
    filters = ("level", "wall", "count", "lang")
    BASE = "https://www.copperknob.co.uk"

    def matches(self, url):
        return re.match(r"^https://www\.copperknob\.co\.uk/stepsheets/[\w-]+/[\w-]+$",
                        url) is not None

    def search(self, q, qs):
        params = {
            "Search": q,
            "Level": qs.get("level", [""])[0],
            "Wall": qs.get("wall", [""])[0],
            "BeatFrom": qs.get("count_from", [""])[0],
            "BeatTo": qs.get("count_to", [""])[0],
            "Lang": qs.get("lang", [""])[0],
        }
        page = fetch(self.BASE + "/search?" + urllib.parse.urlencode(params))
        return self._parse_search(page)

    @staticmethod
    def _parse_search(page):
        results = []
        for chunk in page.split('<div class="listitem"')[1:]:
            chunk = chunk[:3000]
            url_m = re.search(r'href="(https://www\.copperknob\.co\.uk/stepsheets/[^"]+)"', chunk)
            title_m = re.search(r'<span class="listTitleColor1">(.*?)</span>', chunk, re.S)
            choreo_m = re.search(r'<span class="listTitleColor2">(.*?)</span>', chunk, re.S)
            info_m = re.search(r'<p class="listIcons">(.*?)</p>', chunk, re.S)
            if not url_m or not title_m:
                continue
            item = {
                "url": url_m.group(1),
                "title": clean(title_m.group(1)),
                "choreo": clean(choreo_m.group(1)) if choreo_m else "",
            }
            if info_m:
                info = clean(info_m.group(1))
                m = re.search(r"(\d+)\s*Count", info)
                if m:
                    item["count"] = int(m.group(1))
                m = re.search(r"(\d+)\s*Wall", info)
                if m:
                    item["wall"] = int(m.group(1))
                m = re.search(r"Wall\s+(.*?)\s*Music:", info)
                if m:
                    item["level"] = m.group(1).strip()
                m = re.search(r"Music:\s*(.*)$", info)
                if m:
                    item["music"] = m.group(1).strip()
            results.append(item)
        return results

    def fetch_sheet(self, url):
        return self._parse_sheet(fetch(url), url)

    @staticmethod
    def _parse_sheet(page, url):
        title = None
        tm = re.search(r"<title>(.*?)</title>", page, re.S)
        if tm:
            parts = [p.strip() for p in html.unescape(tm.group(1)).split(" - ")]
            if len(parts) >= 2 and parts[0] == "CopperKnob":
                title = parts[1]

        fields = {}
        im = re.search(r'<div class="sheetinfo">(.*?)<div class="sheet">', page, re.S)
        if im:
            info = clean(im.group(1))
            for key, label, pat in [("count", "Count", r"(\d+)"), ("wall", "Wall", r"(\d+)"),
                                    ("level", "Level", r"(.+?)"), ("choreo", "Choreo", r"(.+?)"),
                                    ("music", "Music", r"(.+?)")]:
                m = re.search(label + r"\s*:\s*" + pat + r"(?=\s*(?:Count|Wall|Level|Choreo|Music)\s*:|$)", info)
                if m and m.group(1).strip():
                    fields[key] = re.sub(r"^Choreographers?\s*:\s*", "", m.group(1).strip())

        cm = re.search(r'<div class="sheetcontent">(.*?)<div class="sheetvideos"', page, re.S)
        if not cm:
            cm = re.search(r'<div class="sheetcontent">(.*?)</div>\s*</div>', page, re.S)
        body = cm.group(1) if cm else ""
        body = re.sub(r'<span class="step">(.*?)</span>\s*<span class="desc">(.*?)</span>',
                      lambda m: strip_tags(m.group(1)).strip() + " " + strip_tags(m.group(2)).strip(),
                      body, flags=re.S)
        body = re.sub(r"<br\s*/?>", "\n", body)
        body = re.sub(r"<[^>]+>", "", body)
        body = html.unescape(body)
        lines = []
        for l in body.split("\n"):
            l = " ".join(l.split())
            # everything from the contact/update footer down is site chrome
            if re.match(r"^(contact|last update)\b", l, re.I):
                break
            # calendar/date fragments from the page sidebar
            if re.match(r"^\d{0,2}\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b", l, re.I):
                continue
            lines.append(l)
        body = "\n".join(lines)
        body = re.sub(r"\n{3,}", "\n\n", body).strip()

        text = _compose_sheet_text(title or "CopperKnob dance", fields, body)
        return {"title": title, "url": url, "text": text}


# --- Linedancer (linedancerweb.com) ----------------------------------------

class LinedancerWeb(Source):
    """linedancerweb.com — the Line Dancer Foundation's continuation of
    Linedancer Magazine. Search is a plain POST; dance pages are
    server-rendered HTML; the script itself is a one-page PDF, extracted
    with the mini PDF-text reader below and normalized to CopperKnob-ish
    text (R/L expanded to right/left so the parser can follow feet)."""

    name = "linedancerweb"
    label = "Linedancer"
    filters = ("level", "wall")
    BASE = "https://www.linedancerweb.com"

    def matches(self, url):
        return re.match(r"^https://www\.linedancerweb\.com/dance\.php\?id=\d+$",
                        url) is not None

    def search(self, q, qs):
        data = {"search": q, "searchoption": "All"}
        level = qs.get("level", [""])[0]
        if level:
            data["searchlevel"] = level
        wall = qs.get("wall", [""])[0]
        if wall:
            data["walls"] = wall
        page = fetch(self.BASE + "/search.php", data=data)
        return self._parse_search(page)

    def _parse_search(self, page):
        results = []
        for chunk in page.split('<div class="resultsholder')[1:]:
            chunk = chunk[:4000]
            id_m = re.search(r"dance\.php\?id=(\d+)", chunk)
            title_m = re.search(r'<div class="resultbold">(.*?)</div>', chunk, re.S)
            if not id_m or not title_m:
                continue
            item = {
                "url": self.BASE + "/dance.php?id=" + id_m.group(1),
                "title": clean(title_m.group(1)),
                "choreo": "",
            }
            italics = re.findall(r'<div class="resultitalic">(.*?)</div>', chunk, re.S)
            if italics:
                item["choreo"] = re.sub(r"\.\s*$", "", clean(italics[0]))
            small_m = re.search(r'<div class="resultsmall">(.*?)</div>', chunk, re.S)
            if small_m:
                info = clean(small_m.group(1))
                m = re.search(r"(\d+)\s*count", info)
                if m:
                    item["count"] = int(m.group(1))
                m = re.search(r"(\d+)\s*wall", info)
                if m:
                    item["wall"] = int(m.group(1))
            level_m = re.search(r'<span class="desktoponly111">(.*?)</span>', chunk, re.S)
            if level_m and clean(level_m.group(1)):
                item["level"] = clean(level_m.group(1))
            # song title + artist
            song_m = re.search(r'<div class="resultnormal">(.*?)</div>', chunk, re.S)
            if song_m:
                music = clean(song_m.group(1))
                if len(italics) > 1 and clean(italics[1]):
                    music += " - " + clean(italics[1])
                if music:
                    item["music"] = music
            results.append(item)
        return results

    def fetch_sheet(self, url):
        page = fetch(url)
        fields, title = self._parse_dance_page(page)
        dance_id = re.search(r"id=(\d+)", url).group(1)
        pdf = fetch_bytes(self.BASE + "/viewpdf.php?dance=" + dance_id)
        body = self._normalize_body(pdf_to_text(pdf), title)
        text = _compose_sheet_text(title or "Linedancer dance", fields, body)
        return {"title": title, "url": url, "text": text}

    @staticmethod
    def _parse_dance_page(page):
        tm = re.search(r'<b style="font-size:1\.2em;">(.*?)</b>', page, re.S)
        title = clean(tm.group(1)) if tm else None
        info = {}
        for k, v in re.findall(r'<div class="dancetitle">(.*?)</div>\s*'
                               r'<div class="dancecontent">(.*?)</div>', page, re.S):
            info[clean(k)] = clean(re.sub(r"\(<a[^>]*>view all[^<]*</a>\)", "", v))
        fields = {}
        if info.get("Count", "").isdigit():
            fields["count"] = info["Count"]
        if info.get("Walls", "").isdigit():
            fields["wall"] = info["Walls"]
        if info.get("Level"):
            fields["level"] = info["Level"]
        if info.get("Choreographed By"):
            fields["choreo"] = re.sub(r"\.\s*$", "", info["Choreographed By"])
        if info.get("Choreographed to"):
            music = re.sub(r"\.\s*$", "", info["Choreographed to"]).strip()
            if info.get("Artist"):
                music += " - " + info["Artist"]
            fields["music"] = music
        return fields, title

    # PDF page furniture that is not part of the dance
    _CHROME = re.compile(
        r"^(www\.|Website:|Email:|E-?mail\b|Remember\b|Last Updated|"
        r"Choreographed (by|to)\s*:|\d+\s*Count\b|Script approved by|"
        r"A Video Of This Dance|Music available|Linedance Foundation\b|"
        r".*linedancer-?web\.com|"
        r".*linedancefoundation\.com|.*crystalbootawards\.com|"
        r".*kingshilldanceholidays\.com)", re.I)

    def _normalize_body(self, text, title):
        lines = []
        for raw in text.split("\n"):
            l = " ".join(raw.split())
            if self._CHROME.match(l):
                continue
            if l and not re.search(r"[A-Za-z0-9]", l):
                continue  # stray punctuation from page furniture
            if title and l.lower() == title.lower():
                continue
            m = re.match(r"^Intro\s*:?[\s]*(.*)$", l, re.I)
            if m:
                cm = re.search(r"(\d+)\s*counts?", m.group(1), re.I)
                lines.append("Starts after " + cm.group(1) + " counts"
                             if cm else "Start: " + m.group(1))
                continue
            # expand foot shorthand so the parser can track feet
            l = re.sub(r"\bRF\b", "right foot", l)
            l = re.sub(r"\bLF\b", "left foot", l)
            l = re.sub(r"\bR\b", "right", l)
            l = re.sub(r"\bL\b", "left", l)
            lines.append(l)
        body = "\n".join(lines)
        return re.sub(r"\n{3,}", "\n\n", body).strip()


def _compose_sheet_text(title, fields, body):
    header = [title]
    meta_bits = []
    if fields.get("count"):
        meta_bits.append("Count: " + fields["count"])
    if fields.get("wall"):
        meta_bits.append("Wall: " + fields["wall"])
    if fields.get("level"):
        meta_bits.append("Level: " + fields["level"])
    if meta_bits:
        header.append("  ".join(meta_bits))
    if fields.get("choreo"):
        header.append("Choreo: " + fields["choreo"])
    if fields.get("music"):
        header.append("Music: " + fields["music"])
    return "\n".join(header) + "\n\n" + body


# --- Mini PDF text extractor (stdlib only) ---------------------------------
# Enough of a PDF reader for the one-page, digitally-produced stepsheet
# PDFs that linedancerweb serves: FlateDecode streams, objects inside
# object streams, ToUnicode CMaps for subsetted fonts, and text runs
# grouped into lines by their y position.

def _pdf_inflate(raw):
    try:
        return zlib.decompress(raw)
    except zlib.error:
        return None


def _pdf_objects(data):
    """Map object number -> body bytes, including /ObjStm members."""
    objs = {}
    for m in re.finditer(rb"(\d+)\s+\d+\s+obj\b(.*?)endobj", data, re.S):
        objs[int(m.group(1))] = m.group(2)
    for body in list(objs.values()):
        if b"/ObjStm" not in body:
            continue
        inner = _pdf_stream(body)
        nm = re.search(rb"/N\s+(\d+)", body)
        fm = re.search(rb"/First\s+(\d+)", body)
        if inner is None or not nm or not fm:
            continue
        first = int(fm.group(1))
        header = inner[:first].split()
        pairs = [(int(header[i]), int(header[i + 1]))
                 for i in range(0, 2 * int(nm.group(1)), 2)]
        for i, (onum, off) in enumerate(pairs):
            end = first + pairs[i + 1][1] if i + 1 < len(pairs) else len(inner)
            objs[onum] = inner[first + off:end]
    return objs


def _pdf_stream(body):
    # old writers (Acrobat PDFWriter) end the `stream` keyword with a bare \r
    sm = re.search(rb"stream(?:\r\n|\r|\n)(.*?)endstream", body, re.S)
    if not sm:
        return None
    raw = sm.group(1)
    if b"/ASCII85Decode" in body:
        try:
            import base64
            raw = re.sub(rb"\s", b"", raw)
            raw = base64.a85decode(re.sub(rb"^<~|~>?$", b"", raw))
        except ValueError:
            return None
    if b"/FlateDecode" in body:
        return _pdf_inflate(raw) or _pdf_inflate(raw.strip(b"\r\n "))
    return raw


def _pdf_tounicode(cmap_bytes):
    """bfchar/bfrange entries -> {cid: unicode string}."""
    text = cmap_bytes.decode("latin-1", "replace")
    out = {}
    for block in re.findall(r"beginbfchar(.*?)endbfchar", text, re.S):
        for src, dst in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            out[int(src, 16)] = "".join(
                chr(int(dst[i:i + 4], 16)) for i in range(0, len(dst), 4))
    for block in re.findall(r"beginbfrange(.*?)endbfrange", text, re.S):
        for lo, hi, dst in re.findall(
                r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            base = int(dst, 16)
            for cid in range(int(lo, 16), int(hi, 16) + 1):
                out[cid] = chr(base + cid - int(lo, 16))
    return out


def _pdf_fonts(objs):
    """Font resource name (b'F2') -> ToUnicode cid map, or None for
    simple single-byte fonts."""
    fonts = {}
    for body in objs.values():
        fm = re.search(rb"/Font\s*<<(.*?)>>", body, re.S)
        if not fm:
            continue
        for name, ref in re.findall(rb"/(F\d+)\s+(\d+)\s+\d+\s+R", fm.group(1)):
            font = objs.get(int(ref))
            if font is None or name in fonts:
                continue
            cmap = None
            tu = re.search(rb"/ToUnicode\s+(\d+)\s+\d+\s+R", font)
            if tu:
                stream = objs.get(int(tu.group(1)))
                raw = _pdf_stream(stream) if stream is not None else None
                if raw:
                    cmap = _pdf_tounicode(raw)
            fonts[name] = cmap
    return fonts


_PDF_ESCAPES = {b"n": "\n", b"r": "\r", b"t": "\t", b"b": "\b", b"f": "\f",
                b"(": "(", b")": ")", b"\\": "\\"}


def _pdf_bytes_to_str(data, cmap):
    if cmap:  # 2-byte CIDs through the font's ToUnicode map
        return "".join(cmap.get((data[k] << 8) | data[k + 1], "")
                       for k in range(0, len(data) - 1, 2))
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1", "replace")


def _pdf_literal(raw, cmap):
    b, i = [], 0
    while i < len(raw):
        c = raw[i:i + 1]
        if c == b"\\":
            nxt = raw[i + 1:i + 2]
            if nxt.isdigit():
                j = i + 1
                while j < min(i + 4, len(raw)) and raw[j:j + 1].isdigit():
                    j += 1
                b.append(int(raw[i + 1:j], 8) & 0xFF)
                i = j
                continue
            b.append(ord(_PDF_ESCAPES.get(nxt, nxt.decode("latin-1", "replace") or "?")))
            i += 2
            continue
        b.append(raw[i])
        i += 1
    return _pdf_bytes_to_str(bytes(b), cmap)


def _pdf_hex(hx, cmap):
    hx = re.sub(rb"\s", b"", hx).decode("ascii", "ignore")
    if len(hx) % 2:
        hx += "0"
    return _pdf_bytes_to_str(bytes.fromhex(hx), cmap)


_PDF_TOKEN = re.compile(
    rb"\((?P<lit>(?:\\.|[^()\\])*)\)|<(?P<hex>[0-9A-Fa-f\s]+)>|/(?P<name>[A-Za-z0-9]+)"
    rb"|(?P<num>-?\d+(?:\.\d+)?)|(?P<op>[A-Za-z'\"*]{1,3})")


def _pdf_runs(content, fonts):
    """Walk a content stream; yield (y, x, text) for each text run."""
    runs = []
    cur_font = None
    x = y = 0.0
    rotated = False
    stack = []
    for m in _PDF_TOKEN.finditer(content):
        if m.group("lit") is not None:
            stack.append(("str", _pdf_literal(m.group("lit"), fonts.get(cur_font))))
        elif m.group("hex") is not None:
            stack.append(("str", _pdf_hex(m.group("hex"), fonts.get(cur_font))))
        elif m.group("name") is not None:
            stack.append(("name", m.group("name")))
        elif m.group("num") is not None:
            stack.append(("num", float(m.group("num"))))
        else:
            op = m.group("op")
            if op == b"Tf" and len(stack) >= 2 and stack[-2][0] == "name":
                cur_font = stack[-2][1]
            elif op == b"Tm" and len(stack) >= 6:
                nums = [v for t, v in stack[-6:] if t == "num"]
                if len(nums) == 6:
                    x, y = nums[4], nums[5]
                    # skip rotated page-margin decorations
                    rotated = abs(nums[1]) > 0.01 or abs(nums[2]) > 0.01
            elif op in (b"Td", b"TD") and len(stack) >= 2:
                nums = [v for t, v in stack[-2:] if t == "num"]
                if len(nums) == 2:
                    x += nums[0]
                    y += nums[1]
            elif op in (b"Tj", b"'"):
                if stack and stack[-1][0] == "str" and not rotated:
                    runs.append((y, x, stack[-1][1]))
            elif op == b"TJ":
                text = "".join(v for t, v in stack if t == "str")
                if text and not rotated:
                    runs.append((y, x, text))
            stack = []
    return runs


def pdf_to_text(data):
    """Text of a digitally-produced PDF, one string, lines in page order."""
    objs = _pdf_objects(data)
    fonts = _pdf_fonts(objs)
    pages = []
    for body in objs.values():
        head = body[:400]
        if b"/ObjStm" in head or b"/XObject" in head or b"/Length1" in head:
            continue
        raw = _pdf_stream(body)
        if not raw or b"BT" not in raw or b"Tf" not in raw:
            continue
        runs = _pdf_runs(raw, fonts)
        if not runs:
            continue
        lines = {}
        for ry, rx, text in runs:
            lines.setdefault(round(ry), []).append((rx, text))
        page = []
        for ly in sorted(lines, reverse=True):
            parts = sorted(lines[ly])
            line = ""
            prev_end = None
            for rx, text in parts:
                if line and prev_end is not None and rx - prev_end > 4:
                    line += " "
                line += text
                prev_end = rx + len(text) * 4.5
            page.append(line.rstrip())
        pages.append("\n".join(page))
    return "\n".join(pages)


# --- Registry --------------------------------------------------------------

SOURCES = {s.name: s for s in (CopperKnob(), LinedancerWeb())}


def source_for_url(url):
    for src in SOURCES.values():
        if src.matches(url):
            return src
    return None
