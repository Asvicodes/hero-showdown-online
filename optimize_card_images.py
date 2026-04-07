import io
import json
import mimetypes
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parent
ASSET_DIR = ROOT / "assets" / "celebrities"
DECK_PATH = ROOT / "data" / "offline-cards.json"
DECK_PATHS = ROOT / "data" / "offline-cards.paths.json"

MAX_WIDTH = 420
JPEG_QUALITY = 68


def main() -> int:
    optimize_assets()
    rebuild_embedded_deck()
    return 0


def optimize_assets() -> None:
    for image_path in sorted(ASSET_DIR.iterdir()):
        if not image_path.is_file():
            continue

        with Image.open(image_path) as image:
            normalized = ImageOps.exif_transpose(image)
            normalized = normalized.convert("RGB")

            if normalized.width > MAX_WIDTH:
                ratio = MAX_WIDTH / normalized.width
                target_height = max(1, round(normalized.height * ratio))
                normalized = normalized.resize((MAX_WIDTH, target_height), Image.Resampling.LANCZOS)

            buffer = io.BytesIO()
            normalized.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
            image_path.with_suffix(".jpg").write_bytes(buffer.getvalue())

        if image_path.suffix.lower() != ".jpg":
            image_path.unlink(missing_ok=True)


def rebuild_embedded_deck() -> None:
    source_cards = json.loads(DECK_PATHS.read_text(encoding="utf-8"))
    rebuilt_cards = []

    for card in source_cards:
        updated = dict(card)
        image = str(updated.get("image", ""))

        if image.startswith("./assets/"):
            file_path = (ROOT / image[2:]).resolve()

            if not file_path.exists():
                fallback = file_path.with_suffix(".jpg")
                if fallback.exists():
                    file_path = fallback

            if file_path.exists():
                mime_type = mimetypes.guess_type(str(file_path))[0] or "image/jpeg"
                encoded = file_path.read_bytes()
                updated["image"] = to_data_url(mime_type, encoded)
            else:
                updated["image"] = ""

        rebuilt_cards.append(updated)

    DECK_PATH.write_text(json.dumps(rebuilt_cards, ensure_ascii=False), encoding="utf-8")


def to_data_url(mime_type: str, payload: bytes) -> str:
    import base64

    return f"data:{mime_type};base64,{base64.b64encode(payload).decode('ascii')}"


if __name__ == "__main__":
    raise SystemExit(main())
