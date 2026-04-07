import io
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parent
ASSET_DIR = ROOT / "assets" / "celebrities"

TARGET_RATIO = 4 / 5
TARGET_WIDTH = 420
TARGET_HEIGHT = 525
TOP_BIAS = 0.18
JPEG_QUALITY = 72


def main() -> int:
    for image_path in sorted(ASSET_DIR.iterdir()):
        if not image_path.is_file():
            continue

        with Image.open(image_path) as image:
            normalized = ImageOps.exif_transpose(image).convert("RGB")
            cropped = crop_portrait(normalized)
            resized = cropped.resize((TARGET_WIDTH, TARGET_HEIGHT), Image.Resampling.LANCZOS)

            buffer = io.BytesIO()
            resized.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
            image_path.with_suffix(".jpg").write_bytes(buffer.getvalue())

        if image_path.suffix.lower() != ".jpg":
            image_path.unlink(missing_ok=True)

    print("Portrait crop pass complete.")
    return 0


def crop_portrait(image: Image.Image) -> Image.Image:
    width, height = image.size
    current_ratio = width / height

    if current_ratio > TARGET_RATIO:
        crop_height = height
        crop_width = round(crop_height * TARGET_RATIO)
    else:
        crop_width = width
        crop_height = round(crop_width / TARGET_RATIO)

    left = max(0, round((width - crop_width) / 2))
    max_top = max(0, height - crop_height)
    top = max(0, min(max_top, round(height * TOP_BIAS) - round(crop_height * 0.22)))

    return image.crop((left, top, left + crop_width, top + crop_height))


if __name__ == "__main__":
    raise SystemExit(main())
