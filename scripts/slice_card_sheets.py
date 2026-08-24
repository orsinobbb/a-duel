from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps


CARD_SIZE = (600, 900)
CARD_ORDER = ("rank5", "rank4", "rank3", "rank2", "rank1", "explosive", "trap")

CROP_BOXES = {
    "A": (
        (34, 4, 399, 559),
        (412, 8, 733, 559),
        (747, 8, 1068, 559),
        (1079, 9, 1408, 559),
        (164, 574, 525, 1049),
        (541, 574, 901, 1049),
        (930, 574, 1257, 1049),
    ),
    "B": (
        (37, 5, 398, 575),
        (412, 7, 735, 574),
        (746, 7, 1071, 575),
        (1080, 8, 1410, 575),
        (173, 584, 533, 1067),
        (542, 584, 900, 1067),
        (931, 584, 1267, 1067),
    ),
}

THEME_OVERLAY = {
    "A": (4, 22, 62, 118),
    "B": (55, 5, 5, 118),
}


def normalize_card(crop: Image.Image, player: str) -> Image.Image:
    background = ImageOps.fit(crop, CARD_SIZE, method=Image.Resampling.LANCZOS)
    background = background.filter(ImageFilter.GaussianBlur(28)).convert("RGBA")
    background = Image.alpha_composite(background, Image.new("RGBA", CARD_SIZE, THEME_OVERLAY[player]))

    foreground = ImageOps.contain(crop, CARD_SIZE, method=Image.Resampling.LANCZOS)
    left = (CARD_SIZE[0] - foreground.width) // 2
    top = (CARD_SIZE[1] - foreground.height) // 2
    background.paste(foreground, (left, top))
    return background.convert("RGB")


def slice_sheet(sheet_path: Path, player: str, output_dir: Path) -> list[Path]:
    sheet = Image.open(sheet_path).convert("RGB")
    player_dir = output_dir / f"player-{player.lower()}"
    player_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = []

    for name, box in zip(CARD_ORDER, CROP_BOXES[player], strict=True):
        card = normalize_card(sheet.crop(box), player)
        output_path = player_dir / f"{name}.webp"
        card.save(output_path, "WEBP", quality=88, method=6)
        outputs.append(output_path)

    return outputs


def create_preview(cards: list[Path], preview_path: Path) -> None:
    thumb_size = (240, 360)
    gap = 18
    preview = Image.new("RGB", (7 * thumb_size[0] + 8 * gap, 2 * thumb_size[1] + 3 * gap), "#161b1a")
    draw = ImageDraw.Draw(preview)

    for index, path in enumerate(cards):
        row, column = divmod(index, 7)
        x = gap + column * (thumb_size[0] + gap)
        y = gap + row * (thumb_size[1] + gap)
        image = Image.open(path).convert("RGB").resize(thumb_size, Image.Resampling.LANCZOS)
        preview.paste(image, (x, y))
        draw.rectangle((x - 1, y - 1, x + thumb_size[0], y + thumb_size[1]), outline="#d4a934", width=2)

    preview_path.parent.mkdir(parents=True, exist_ok=True)
    preview.save(preview_path, "PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Slice the two A Duel card sheets into normalized card assets.")
    parser.add_argument("--blue", required=True, type=Path)
    parser.add_argument("--red", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--preview", type=Path)
    args = parser.parse_args()

    cards = [
        *slice_sheet(args.blue, "A", args.output),
        *slice_sheet(args.red, "B", args.output),
    ]
    if args.preview:
        create_preview(cards, args.preview)


if __name__ == "__main__":
    main()
