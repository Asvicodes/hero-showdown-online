import json
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from urllib.error import HTTPError, URLError


WORKSPACE = Path(__file__).resolve().parent
SOURCE_XLSX = WORKSPACE / "tollywood_50plus_actors.xlsx"
OUTPUT_DIR = WORKSPACE / "assets" / "celebrities"
OUTPUT_JSON = WORKSPACE / "data" / "offline-cards.json"

NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
USER_AGENT = "HeroShowdownOfflineDeck/1.0"
REQUEST_DELAY_SECONDS = 0.7
MAX_RETRIES = 4
TITLE_ALIASES = {
    "Karthikeya": "Kartikeya Gummakonda",
    "Gopichand": "Gopichand (actor)",
    "Manchu Vishnu": "Vishnu Manchu",
}


def main() -> int:
    cards = parse_xlsx(SOURCE_XLSX)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)

    built_cards = []
    failures = []

    for index, card in enumerate(cards, start=1):
        print(f"[{index}/{len(cards)}] Resolving image for {card['name']}...")
        try:
            image_path = download_commons_image(card["name"])
        except Exception as error:
            print(f"  Skipped after retries: {error}")
            image_path = ""

        if not image_path:
            failures.append(card["name"])

        built_cards.append(
            {
                "id": slugify(card["name"]),
                "name": card["name"],
                "role": card["role"],
                "image": image_path.replace("\\", "/") if image_path else "",
                "totalMovies": card["totalMovies"],
                "hits": card["hits"],
                "flops": card["flops"],
                "heightCm": card["heightCm"],
                "imdbStarmeter": card["imdbStarmeter"],
            }
        )
        OUTPUT_JSON.write_text(json.dumps(built_cards, ensure_ascii=False, indent=2), encoding="utf-8")

    OUTPUT_JSON.write_text(json.dumps(built_cards, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSaved {len(built_cards)} cards to {OUTPUT_JSON}")
    if failures:
        print("\nNo free Commons image found for:")
        for name in failures:
            print(f"- {name}")
    return 0


def parse_xlsx(path: Path) -> list[dict]:
    with zipfile.ZipFile(path) as workbook:
        shared_strings = []
        if "xl/sharedStrings.xml" in workbook.namelist():
            root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
            for si in root.findall("a:si", NS):
                shared_strings.append("".join(node.text or "" for node in si.findall(".//a:t", NS)))

        sheet = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
        rows = []
        for row in sheet.findall(".//a:sheetData/a:row", NS):
            values = [read_cell(cell, shared_strings) for cell in row.findall("a:c", NS)]
            rows.append(values)

    headers = rows[0]
    items = []
    for row in rows[1:]:
        if not any(str(value).strip() for value in row):
            continue
        mapped = dict(zip(headers, row))
        items.append(
            {
                "name": mapped.get("Name", "").strip(),
                "role": mapped.get("Role", "Celebrity").strip() or "Celebrity",
                "totalMovies": int(mapped.get("Total Movies", 0)),
                "hits": int(mapped.get("Hits", 0)),
                "flops": int(mapped.get("Flops", 0)),
                "heightCm": int(mapped.get("Height (cm)", 0)),
                "imdbStarmeter": int(mapped.get("IMDb Starmeter", 0)),
            }
        )
    return items


def read_cell(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        inline = cell.find("a:is", NS)
        if inline is None:
            return ""
        return "".join(node.text or "" for node in inline.findall(".//a:t", NS))

    value = cell.find("a:v", NS)
    if value is None:
        return ""
    text = value.text or ""
    if cell_type == "s" and text:
        return shared_strings[int(text)]
    return text


def download_commons_image(name: str) -> str:
    entity_id = find_wikidata_entity(name)
    if not entity_id:
        return ""

    image_filename = get_commons_image_filename(entity_id)
    if not image_filename:
        return ""

    extension = Path(image_filename).suffix.lower() or ".jpg"
    safe_name = f"{slugify(name)}{extension}"
    local_path = OUTPUT_DIR / safe_name
    if local_path.exists():
        return f"./assets/celebrities/{safe_name}"

    image_url = (
        "https://commons.wikimedia.org/wiki/Special:FilePath/"
        + urllib.parse.quote(image_filename)
        + "?width=900"
    )

    local_path.write_bytes(download_bytes(image_url))

    return f"./assets/celebrities/{safe_name}"


def find_wikidata_entity(name: str) -> str:
    page_title = find_wikipedia_page(name)
    if not page_title:
        return ""

    summary_url = (
        "https://en.wikipedia.org/api/rest_v1/page/summary/"
        + urllib.parse.quote(page_title, safe="")
    )
    data = fetch_json(summary_url)
    return data.get("wikibase_item", "")


def find_wikipedia_page(name: str) -> str:
    if name in TITLE_ALIASES:
        return TITLE_ALIASES[name]

    attempts = [name, f"{name} actor", f"{name} actress", f"{name} Indian actor", f"{name} Indian actress"]

    for query in attempts:
        search_url = (
            "https://en.wikipedia.org/w/api.php?origin=*&action=query&list=search&srsearch="
            + urllib.parse.quote(query)
            + "&srlimit=1&format=json"
        )
        data = fetch_json(search_url)
        results = data.get("query", {}).get("search", [])
        if results:
            return results[0].get("title", "")
    return ""


def get_commons_image_filename(entity_id: str) -> str:
    data = fetch_json(f"https://www.wikidata.org/wiki/Special:EntityData/{entity_id}.json")
    claims = data.get("entities", {}).get(entity_id, {}).get("claims", {})
    image_claims = claims.get("P18", [])
    if not image_claims:
        return ""

    return (
        image_claims[0]
        .get("mainsnak", {})
        .get("datavalue", {})
        .get("value", "")
    )


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
            time.sleep(REQUEST_DELAY_SECONDS)
            return data
        except HTTPError as error:
            if error.code == 429 and attempt < MAX_RETRIES - 1:
                time.sleep((2 ** attempt) * 2)
                continue
            raise
        except URLError:
            if attempt < MAX_RETRIES - 1:
                time.sleep((2 ** attempt) * 2)
                continue
            raise

    return {}


def download_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read()
            time.sleep(REQUEST_DELAY_SECONDS)
            return payload
        except HTTPError as error:
            if error.code == 429 and attempt < MAX_RETRIES - 1:
                time.sleep((2 ** attempt) * 2)
                continue
            raise
        except URLError:
            if attempt < MAX_RETRIES - 1:
                time.sleep((2 ** attempt) * 2)
                continue
            raise

    return b""


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


if __name__ == "__main__":
    raise SystemExit(main())
