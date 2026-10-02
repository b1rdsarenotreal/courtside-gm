#!/usr/bin/env python3
"""Bundle the app into one self-contained HTML file (dist/courtside.html).

    python scripts/bundle.py              # full HTML document
    python scripts/bundle.py --fragment   # body-only fragment (for hosts that add their own <html>/<head>)
"""
import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fragment", action="store_true")
    ap.add_argument("--out", type=Path, default=ROOT / "dist" / "courtside.html")
    a = ap.parse_args()
    html = (ROOT / "index.html").read_text()
    css = (ROOT / "css" / "style.css").read_text()
    html = html.replace('<link rel="stylesheet" href="css/style.css">', f"<style>\n{css}\n</style>")
    def inline(m):
        js = (ROOT / m.group(1)).read_text().replace("</script", "<\\/script")
        return f"<script>\n{js}\n</script>"
    html = re.sub(r'<script src="(js/[^"]+)"></script>', inline, html)
    if a.fragment:
        head = re.search(r"<head>(.*)</head>", html, re.S).group(1)
        body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
        head = re.sub(r"<meta [^>]*>\n?", "", head)
        html = head.strip() + "\n" + body.strip() + "\n"
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(html)
    print(f"Wrote {a.out} ({len(html) // 1024} KB)")

if __name__ == "__main__":
    main()
