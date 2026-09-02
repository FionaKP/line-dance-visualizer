"""Local server for the line dance visualizer.

Serves the static app and proxies stepsheet search/fetch requests through
the per-site scrapers in sources.py (the sites reject requests without a
browser User-Agent and the page itself cannot fetch cross-origin).

Run:  python server.py  (then open http://localhost:8123)
Set PORT to run on a different port, e.g.  PORT=8125 python server.py
"""

import html
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from sources import SOURCES, fetch, source_for_url

PORT = int(os.environ.get("PORT", "8123"))


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


def innertube_player(video_id):
    body = json.dumps({"context": {"client": ANDROID_CLIENT}, "videoId": video_id}).encode()
    req = urllib.request.Request(
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false", data=body,
        headers={"Content-Type": "application/json", "User-Agent": ANDROID_CLIENT["userAgent"]})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def _pick_audio_format(video_id):
    data = innertube_player(video_id)
    fmts = data.get("streamingData", {}).get("adaptiveFormats", [])
    audio = [f for f in fmts if f.get("mimeType", "").startswith("audio/") and "url" in f]
    if not audio:
        return None
    mp4 = [f for f in audio if "mp4" in f.get("mimeType", "")]
    return min(mp4 or audio, key=lambda f: f.get("bitrate", 1 << 30))


def fetch_audio(video_id):
    """Return (bytes, mime) for the start of a video's smallest audio stream.

    Un-tokened stream URLs allow only ~300KB total, so grab the first ~280KB
    in small ranged chunks. At the low bitrates we pick, that is more than a
    minute of audio, enough for tempo and start detection.
    """
    best = _pick_audio_format(video_id)
    if not best:
        return None, "No audio stream available for this video."
    length = int(best.get("contentLength", 0))
    mime = best.get("mimeType", "audio/mp4").split(";")[0]
    if not length:
        return None, "Audio stream is missing a length."
    target = min(length, 280_000)
    blob = bytearray()
    while len(blob) < target:
        end = min(len(blob) + 99_999, target - 1)
        req = urllib.request.Request(best["url"], headers={
            "User-Agent": ANDROID_CLIENT["userAgent"],
            "Range": "bytes=%d-%d" % (len(blob), end)})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
        except urllib.error.HTTPError as e:
            if blob:
                break  # analyze what we have
            return None, "Audio download failed: HTTP %d" % e.code
        if not data:
            break
        blob.extend(data)
    return (bytes(blob), mime), None


def fetch_transcript(video_id):
    # the web watch page hides caption URLs behind proof-of-origin tokens;
    # the Android innertube client still hands them out directly
    data = innertube_player(video_id)
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
            if parsed.path == "/api/ping":
                # feature probe: the page asks this on load to decide between
                # full server mode and static mode. Answered here it shadows
                # the checked-in api/ping file, whose {"mode": "static"} is
                # what a static host (GitHub Pages) serves instead.
                self.send_json({"ok": True, "mode": "server"})
                return

            if parsed.path == "/api/search":
                q = qs.get("q", [""])[0]
                which = qs.get("source", ["copperknob"])[0]
                names = list(SOURCES) if which == "all" else [which]
                if any(n not in SOURCES for n in names):
                    self.send_json({"error": "Unknown source '%s'. Sources: %s, all."
                                    % (which, ", ".join(SOURCES))}, 400)
                    return
                per_source, errors = [], []
                for n in names:
                    try:
                        got = SOURCES[n].search(q, qs)
                        for r in got:
                            r["source"] = n
                        per_source.append(got)
                    except (urllib.error.URLError, OSError) as e:
                        errors.append(SOURCES[n].label + ": " + str(e))
                if not per_source and errors:
                    self.send_json({"error": "; ".join(errors)}, 502)
                    return
                # merge round-robin so no site monopolizes the top of the list
                results = []
                for i in range(max(len(g) for g in per_source) if per_source else 0):
                    for got in per_source:
                        if i < len(got):
                            results.append(got[i])
                out = {"results": results}
                if errors:
                    out["errors"] = errors
                self.send_json(out)
                return

            if parsed.path == "/api/music":
                q = qs.get("q", [""])[0]
                page = fetch("https://www.youtube.com/results?search_query=" +
                             urllib.parse.quote(q))
                self.send_json({"results": parse_music_results(page)})
                return

            if parsed.path == "/api/audio":
                vid = qs.get("v", [""])[0]
                if not re.match(r"^[\w-]{11}$", vid):
                    self.send_json({"error": "Invalid video id."}, 400)
                    return
                result, err = fetch_audio(vid)
                if err:
                    self.send_json({"error": err}, 502)
                    return
                blob, mime = result
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(len(blob)))
                self.end_headers()
                self.wfile.write(blob)
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
                src = source_for_url(url)
                if src is None:
                    self.send_json({"error": "Unsupported stepsheet URL. Supported sites: " +
                                    ", ".join(s.label for s in SOURCES.values()) + "."}, 400)
                    return
                self.send_json(src.fetch_sheet(url))
                return
        except urllib.error.URLError as e:
            self.send_json({"error": "Upstream request failed: " + str(e)}, 502)
            return

        super().do_GET()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    print("Serving on http://localhost:%d" % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
