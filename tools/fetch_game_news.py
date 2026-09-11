"""Fetch new Steam and YouTube RSS entries for Rules of Engagement: The Grey State.

Usage:
    python fetch_game_news.py [--state-file PATH] [--output PATH] [--dry-run]

Prints a JSON summary to stdout (or writes it to --output). State (which
entries have already been seen) is persisted to a JSON file so re-runs only
report genuinely new items.
"""

import argparse
import json
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

STEAM_URL = "https://store.steampowered.com/feeds/news/app/3978820/"
YOUTUBE_URL = "https://www.youtube.com/feeds/videos.xml?channel_id=UCzxH3ovfNamSg2w046MG_HA"

DEFAULT_STATE_FILE = Path(__file__).resolve().parent.parent / "state.json"

ATOM_NS = {"atom": "http://www.w3.org/2005/Atom"}


def fetch(url: str, timeout: int = 15) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "grey-state-news-tracker/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def parse_steam_rss(xml_bytes: bytes) -> list[dict]:
    root = ET.fromstring(xml_bytes)
    entries = []
    for item in root.findall("./channel/item"):
        title = item.findtext("title")
        link = item.findtext("link")
        guid = item.findtext("guid") or link
        pub_date = item.findtext("pubDate")
        if not title or not guid:
            continue
        entries.append(
            {
                "id": guid.strip(),
                "title": title.strip(),
                "link": (link or "").strip(),
                "published": (pub_date or "").strip(),
                "source": "steam",
            }
        )
    return entries


def parse_youtube_atom(xml_bytes: bytes) -> list[dict]:
    root = ET.fromstring(xml_bytes)
    entries = []
    for entry in root.findall("atom:entry", ATOM_NS):
        title = entry.findtext("atom:title", namespaces=ATOM_NS)
        video_id = entry.findtext("atom:id", namespaces=ATOM_NS)
        published = entry.findtext("atom:published", namespaces=ATOM_NS)
        link_el = entry.find("atom:link", ATOM_NS)
        link = link_el.get("href") if link_el is not None else ""
        if not title or not video_id:
            continue
        entries.append(
            {
                "id": video_id.strip(),
                "title": title.strip(),
                "link": (link or "").strip(),
                "published": (published or "").strip(),
                "source": "youtube",
            }
        )
    return entries


def load_state(path: Path) -> dict:
    if not path.exists():
        return {"steam": {"seen_ids": []}, "youtube": {"seen_ids": []}, "last_run": None}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_state(path: Path, state: dict) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


def filter_new(entries: list[dict], seen_ids: list[str]) -> list[dict]:
    seen = set(seen_ids)
    return [e for e in entries if e["id"] not in seen]


def fetch_source(name: str, url: str, parser, seen_ids: list[str]) -> dict:
    try:
        raw = fetch(url)
    except (urllib.error.URLError, TimeoutError) as exc:
        return {"status": "error", "error": str(exc), "new_items": []}
    try:
        entries = parser(raw)
    except ET.ParseError as exc:
        return {"status": "error", "error": f"parse error: {exc}", "new_items": []}
    new_items = filter_new(entries, seen_ids)
    return {"status": "ok", "new_items": new_items, "all_ids": [e["id"] for e in entries]}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-file", type=Path, default=DEFAULT_STATE_FILE)
    parser.add_argument("--output", type=Path, default=None, help="Write JSON result here instead of stdout")
    parser.add_argument("--dry-run", action="store_true", help="Do not update the state file")
    args = parser.parse_args(argv)

    state = load_state(args.state_file)
    is_first_run = args.state_file.exists() is False

    steam_result = fetch_source("steam", STEAM_URL, parse_steam_rss, state["steam"]["seen_ids"])
    youtube_result = fetch_source("youtube", YOUTUBE_URL, parse_youtube_atom, state["youtube"]["seen_ids"])

    result = {
        "run_date": datetime.now(timezone.utc).isoformat(),
        "is_first_run": is_first_run,
        "steam": {k: v for k, v in steam_result.items() if k != "all_ids"},
        "youtube": {k: v for k, v in youtube_result.items() if k != "all_ids"},
        "total_new": len(steam_result.get("new_items", [])) + len(youtube_result.get("new_items", [])),
    }

    if not args.dry_run:
        if steam_result["status"] == "ok":
            state["steam"]["seen_ids"] = steam_result["all_ids"]
        if youtube_result["status"] == "ok":
            state["youtube"]["seen_ids"] = youtube_result["all_ids"]
        state["last_run"] = result["run_date"]
        save_state(args.state_file, state)

    output_text = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output_text, encoding="utf-8")
    print(output_text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
