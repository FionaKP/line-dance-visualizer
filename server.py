"""Local server for the line dance visualizer.

Serves the static app and proxies CopperKnob search/stepsheet requests,
since copperknob.co.uk rejects requests without a browser User-Agent and
the page itself cannot fetch cross-origin.

Run:  python server.py  (then open http://localhost:8123)
"""

import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 8123
BASE = "https://www.copperknob.co.uk"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def strip_tags(s):
    s = re.sub(r"</?(?:mark|b|i|em|strong|span|a|small)\b[^>]*>", "", s)
    return html.unescape(re.sub(r"<[^>]+>", " ", s))


def clean(s):
    return " ".join(strip_tags(s).split()).replace(" ", " ").strip()


def parse_search_results(page):
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


def parse_sheet_page(page, url):
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

    header = [title or "CopperKnob dance"]
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
    text = "\n".join(header) + "\n\n" + body

    return {"title": title, "url": url, "text": text}


def walk_json(node, key):
    """Yield every value of `key` anywhere in a nested JSON structure."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == key:
                yield v
            else:
                yield from walk_json(v, key)
    elif isinstance(node, list):
        for item in node:
            yield from walk_json(item, key)


def parse_music_results(page):
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", page, re.S)
    if not m:
        return []
    try:
        data = json.loads(m.group(1))
    except json.JSONDecodeError:
        return []
    results = []
    for vr in walk_json(data, "videoRenderer"):
        try:
            title = "".join(r["text"] for r in vr["title"]["runs"])
            channel = "".join(r["text"] for r in vr.get("ownerText", {}).get("runs", []))
            length = vr.get("lengthText", {}).get("simpleText", "")
            results.append({"videoId": vr["videoId"], "title": title,
                            "channel": channel, "length": length})
        except (KeyError, TypeError):
            continue
        if len(results) >= 8:
            break
    return results


ANDROID_CLIENT = {
    "clientName": "ANDROID", "clientVersion": "20.10.38", "androidSdkVersion": 30,
    "userAgent": "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
}


def fetch_transcript(video_id):
    # the web watch page hides caption URLs behind proof-of-origin tokens;
    # the Android innertube client still hands them out directly
    body = json.dumps({"context": {"client": ANDROID_CLIENT}, "videoId": video_id}).encode()
    req = urllib.request.Request(
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false", data=body,
        headers={"Content-Type": "application/json", "User-Agent": ANDROID_CLIENT["userAgent"]})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.load(r)
    tracks = (data.get("captions", {}).get("playerCaptionsTracklistRenderer", {})
              .get("captionTracks", []))
    if not tracks:
        return {"error": "No captions available for this video."}
    track = next((t for t in tracks if t.get("languageCode", "").startswith("en")), tracks[0])
    req = urllib.request.Request(track["baseUrl"],
                                 headers={"User-Agent": ANDROID_CLIENT["userAgent"]})
    with urllib.request.urlopen(req, timeout=20) as r:
        xml = r.read().decode("utf-8", "replace")
    segs = []
    for sm in re.finditer(r'<p t="(\d+)"(?: d="(\d+)")?[^>]*>(.*?)</p>', xml, re.S):
        text = html.unescape(re.sub(r"<[^>]+>", " ", sm.group(3)))
        text = " ".join(text.split())
        if text and text not in ("[Music]", "[Applause]"):
            segs.append({"t": round(int(sm.group(1)) / 1000, 2),
                         "d": round(int(sm.group(2) or 0) / 1000, 2), "text": text})
    if not segs:
        return {"error": "Captions exist but came back empty."}
    return {"segments": segs, "language": track.get("languageCode", "")}


class Handler(SimpleHTTPRequestHandler):
    def send_json(self, obj, status=200):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        try:
            if parsed.path == "/api/search":
                params = {
                    "Search": qs.get("q", [""])[0],
                    "Level": qs.get("level", [""])[0],
                    "Wall": qs.get("wall", [""])[0],
                    "BeatFrom": qs.get("count_from", [""])[0],
                    "BeatTo": qs.get("count_to", [""])[0],
                    "Lang": qs.get("lang", [""])[0],
                }
                page = fetch(BASE + "/search?" + urllib.parse.urlencode(params))
                self.send_json({"results": parse_search_results(page)})
                return

            if parsed.path == "/api/music":
                q = qs.get("q", [""])[0]
                page = fetch("https://www.youtube.com/results?search_query=" +
                             urllib.parse.quote(q))
                self.send_json({"results": parse_music_results(page)})
                return

            if parsed.path == "/api/transcript":
                vid = qs.get("v", [""])[0]
                if not re.match(r"^[\w-]{11}$", vid):
                    self.send_json({"error": "Invalid video id."}, 400)
                    return
                self.send_json(fetch_transcript(vid))
                return

            if parsed.path == "/api/sheet":
                url = qs.get("url", [""])[0]
                if not re.match(r"^https://www\.copperknob\.co\.uk/stepsheets/[\w-]+/[\w-]+$", url):
                    self.send_json({"error": "Only copperknob.co.uk stepsheet URLs are allowed."}, 400)
                    return
                self.send_json(parse_sheet_page(fetch(url), url))
                return
        except urllib.error.URLError as e:
            self.send_json({"error": "CopperKnob request failed: " + str(e)}, 502)
            return

        super().do_GET()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    print("Serving on http://localhost:%d" % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
