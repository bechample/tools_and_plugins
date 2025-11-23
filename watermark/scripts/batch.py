#!/usr/bin/env python3
"""
Watermark all images in a folder with a text string.

Features:
- Color (name or hex) and opacity
- Fixed font size or relative-to-image-width sizing
- Positions (center/corners/edges) OR tiled/repeating pattern
- Optional text outline (stroke) for readability
- EXIF orientation handling; preserves EXIF on JPEG
- Recursive mode and tree mirroring

New (tiling):
- --tile: repeat the watermark across the whole image
- --tile-spacing[,-x,-y], --tile-offset-x/y, --tile-angle, --tile-opacity
"""

import argparse
import sys
from pathlib import Path
from typing import Tuple, Optional

from PIL import Image, ImageDraw, ImageFont, ImageColor, ImageOps

SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"}

def find_default_font() -> Optional[str]:
    candidates = [
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\calibri.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Helvetica.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for p in candidates:
        if Path(p).exists():
            return p
    return None

def load_font(font_path: Optional[str], font_size: int) -> ImageFont.FreeTypeFont:
    if font_path:
        try:
            return ImageFont.truetype(font_path, font_size)
        except OSError:
            print(f"[warn] Could not load font at '{font_path}'. Falling back.", file=sys.stderr)
    default = find_default_font()
    if default:
        try:
            return ImageFont.truetype(default, font_size)
        except OSError:
            pass
    print("[warn] Falling back to Pillow's default font (fixed size). Consider providing --font-path.", file=sys.stderr)
    return ImageFont.load_default()

def parse_opacity(value: float) -> int:
    if value <= 1.0:
        frac = min(max(value, 0.0), 1.0)
        return int(round(frac * 255))
    else:
        pct = min(max(value, 0.0), 100.0)
        return int(round((pct / 100.0) * 255))

def parse_color(value: str) -> Tuple[int, int, int]:
    return ImageColor.getrgb(value)

def measure_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, stroke_width: int = 0) -> Tuple[int, int]:
    if hasattr(draw, "multiline_textbbox"):
        bbox = draw.multiline_textbbox((0, 0), text, font=font, stroke_width=stroke_width)
    else:
        bbox = draw.textbbox((0, 0), text, font=font, stroke_width=stroke_width)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    return w, h

def compute_font_for_relative_width(
    text: str,
    target_fraction_of_image_width: float,
    image_width: int,
    font_path: Optional[str],
    stroke_width: int = 0,
) -> ImageFont.ImageFont:
    provisional_size = 100
    font = load_font(font_path, provisional_size)
    temp_img = Image.new("RGBA", (image_width, 200), (0, 0, 0, 0))
    draw = ImageDraw.Draw(temp_img)
    w, _ = measure_text(draw, text, font, stroke_width=stroke_width)
    if w == 0:
        return font
    target_width = max(1, int(round(target_fraction_of_image_width * image_width)))
    scale = target_width / w
    computed_size = max(1, int(round(provisional_size * scale)))
    return load_font(font_path, computed_size)

def position_xy(img_w: int, img_h: int, text_w: int, text_h: int, pos: str, margin: int) -> Tuple[int, int]:
    pos_key = pos.lower().replace(" ", "-")
    pos_key = {"centered": "center"}.get(pos_key, pos_key)
    margin = max(0, int(margin))
    choices = {
        "center": ((img_w - text_w) // 2, (img_h - text_h) // 2),
        "top-left": (margin, margin),
        "top-right": (img_w - text_w - margin, margin),
        "bottom-left": (margin, img_h - text_h - margin),
        "bottom-right": (img_w - text_w - margin, img_h - text_h - margin),
        "top": ((img_w - text_w) // 2, margin),
        "bottom": ((img_w - text_w) // 2, img_h - text_h - margin),
        "left": (margin, (img_h - text_h) // 2),
        "right": (img_w - text_w - margin, (img_h - text_h) // 2),
    }
    x, y = choices.get(pos_key, choices["bottom-right"])
    x = max(0, min(x, img_w - text_w))
    y = max(0, min(y, img_h - text_h))
    return x, y

def paste_rgba_clip(base_rgba: Image.Image, tile_rgba: Image.Image, x: int, y: int) -> None:
    """
    Paste tile_rgba onto base_rgba at (x,y), safely clipping if partially outside.
    """
    W, H = base_rgba.size
    tw, th = tile_rgba.size
    x0, y0 = max(x, 0), max(y, 0)
    x1, y1 = min(x + tw, W), min(y + th, H)
    if x0 >= x1 or y0 >= y1:
        return
    crop = tile_rgba.crop((x0 - x, y0 - y, x1 - x, y1 - y))
    base_rgba.paste(crop, (x0, y0), crop)

def build_text_tile(
    text: str,
    font: ImageFont.ImageFont,
    fill_rgba: Tuple[int, int, int, int],
    stroke_width: int,
    stroke_rgba: Optional[Tuple[int, int, int, int]],
    angle: float,
) -> Image.Image:
    # Probe bbox at origin
    probe = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    pd = ImageDraw.Draw(probe)
    if hasattr(pd, "multiline_textbbox"):
        left, top, right, bottom = pd.multiline_textbbox(
            (0, 0), text, font=font, stroke_width=stroke_width
        )
    else:
        left, top, right, bottom = pd.textbbox(
            (0, 0), text, font=font, stroke_width=stroke_width
        )

    w = max(1, right - left)
    h = max(1, bottom - top)

    # Safety pad to prevent subpixel/rotation clipping
    pad = max(2, stroke_width + 2)

    tile = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    td = ImageDraw.Draw(tile)

    # Offset by (-left, -top) so the glyph bbox sits fully within the padded tile
    origin = (pad - left, pad - top)

    if hasattr(td, "multiline_text"):
        td.multiline_text(
            origin,
            text,
            font=font,
            fill=fill_rgba,
            stroke_width=stroke_width,
            stroke_fill=stroke_rgba,
        )
    else:
        td.text(
            origin,
            text,
            font=font,
            fill=fill_rgba,
            stroke_width=stroke_width,
            stroke_fill=stroke_rgba,
        )

    # Optional rotation (expand to fit)
    if angle and abs(angle) > 1e-3:
        tile = tile.rotate(angle, expand=True, resample=Image.BICUBIC)

    return tile


def process_image(
    in_path: Path,
    out_path: Path,
    text: str,
    color: Tuple[int, int, int],
    alpha: int,
    position: str,
    margin: int,
    font_path: Optional[str],
    font_size: Optional[int],
    rel_size: Optional[float],
    stroke_width: int,
    stroke_color: Optional[Tuple[int, int, int]],
    quality: int,
    # tiling params
    tile: bool,
    tile_spacing: int,
    tile_spacing_x: Optional[int],
    tile_spacing_y: Optional[int],
    tile_offset_x: int,
    tile_offset_y: int,
    tile_angle: float,
    tile_alpha: Optional[int],
):
    with Image.open(in_path) as im0:
        exif_bytes = im0.info.get("exif")
        im = ImageOps.exif_transpose(im0)

        base_format = im0.format
        base_mode = im.mode

        # Prepare font
        if rel_size is not None:
            font = compute_font_for_relative_width(
                text=text,
                target_fraction_of_image_width=rel_size,
                image_width=im.width,
                font_path=font_path,
                stroke_width=stroke_width,
            )
        else:
            size = font_size if font_size is not None else 48
            font = load_font(font_path, size)

        base_rgba = im.convert("RGBA")
        overlay = Image.new("RGBA", base_rgba.size, (0, 0, 0, 0))

        # Compose fill colors
        effective_alpha = tile_alpha if tile_alpha is not None else alpha
        fill_rgba = (color[0], color[1], color[2], effective_alpha)
        if stroke_width > 0:
            sc = stroke_color if stroke_color else (0, 0, 0)
            stroke_rgba = (sc[0], sc[1], sc[2], effective_alpha)
        else:
            stroke_rgba = None

        if tile:
            # Build one text tile, possibly rotated
            tile_img = build_text_tile(
                text=text,
                font=font,
                fill_rgba=fill_rgba,
                stroke_width=stroke_width,
                stroke_rgba=stroke_rgba,
                angle=tile_angle,
            )

            tw, th = tile_img.size
            # Determine steps
            sx = max(1, tw + (tile_spacing_x if tile_spacing_x is not None else tile_spacing))
            sy = max(1, th + (tile_spacing_y if tile_spacing_y is not None else tile_spacing))

            # Compute starting coordinates so the grid always covers the whole image,
            # respecting the requested offset.
            # Floor-align the first tile to the left/top beyond the canvas.
            start_x = ((-tw + tile_offset_x) // sx) * sx
            start_y = ((-th + tile_offset_y) // sy) * sy

            y = start_y
            while y < base_rgba.height:
                x = start_x
                while x < base_rgba.width:
                    paste_rgba_clip(overlay, tile_img, x, y)
                    x += sx
                y += sy

        else:
            draw = ImageDraw.Draw(overlay)
            # Measure and position single watermark
            text_w, text_h = measure_text(draw, text, font, stroke_width=stroke_width)
            x, y = position_xy(base_rgba.width, base_rgba.height, text_w, text_h, position, margin)

            if hasattr(draw, "multiline_text"):
                draw.multiline_text(
                    (x, y),
                    text,
                    font=font,
                    fill=fill_rgba,
                    stroke_width=stroke_width,
                    stroke_fill=stroke_rgba,
                )
            else:
                draw.text(
                    (x, y),
                    text,
                    font=font,
                    fill=fill_rgba,
                    stroke_width=stroke_width,
                    stroke_fill=stroke_rgba,
                )

        # Composite and convert back
        out_image = Image.alpha_composite(base_rgba, overlay)

        if base_format in {"JPEG", "JPG", "BMP", "TIFF"}:
            final = out_image.convert("RGB")
        else:
            final = out_image if base_mode in {"RGBA", "LA"} else out_image.convert(base_mode)

        out_path.parent.mkdir(parents=True, exist_ok=True)

        save_kwargs = {}
        if exif_bytes and base_format in {"JPEG", "JPG"}:
            save_kwargs["exif"] = exif_bytes
        if base_format in {"JPEG", "JPG", "WEBP"}:
            save_kwargs["quality"] = quality

        final.save(out_path, format=base_format, **save_kwargs)

def iter_images(input_dir: Path, recursive: bool):
    if recursive:
        yield from (p for p in input_dir.rglob("*") if p.suffix.lower() in SUPPORTED_EXTS)
    else:
        yield from (p for p in input_dir.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS)

def build_output_path(out_dir: Path, src_path: Path, suffix: str, keep_tree: bool, base_input_dir: Path) -> Path:
    if keep_tree:
        rel = src_path.relative_to(base_input_dir)
        return (out_dir / rel.with_stem(rel.stem + suffix))
    else:
        return out_dir / src_path.with_stem(src_path.stem + suffix).name

def main():
    parser = argparse.ArgumentParser(description="Add a text watermark to all images in a folder.")
    parser.add_argument("-i", "--input", required=True, type=Path, help="Input folder containing images.")
    parser.add_argument("-o", "--output", required=True, type=Path, help="Output folder for watermarked images.")
    parser.add_argument("-t", "--text", required=True, help="Watermark text (use quotes / multiline with \\n).")

    # Single watermark placement
    parser.add_argument("--pos", "--position", dest="position", default="bottom-right",
                        choices=["center", "centered", "top-left", "top-right", "bottom-left", "bottom-right", "top", "bottom", "left", "right"],
                        help="Watermark position (ignored if --tile).")
    parser.add_argument("--margin", type=int, default=32, help="Margin in pixels from edges (ignored if --tile).")

    # Visuals
    parser.add_argument("--color", default="#FFFFFF", help="Text color (name or hex), default: #FFFFFF.")
    parser.add_argument("--opacity", type=float, default=0.35, help="Opacity as 0..1 fraction or 0..100 percent. Default: 0.35")
    parser.add_argument("--font-size", type=int, default=None, help="Font size in pixels. If omitted, use --rel-size or 48.")
    parser.add_argument("--rel-size", type=float, default=None, help="Text width as a fraction of image width (e.g., 0.25).")
    parser.add_argument("--font-path", type=Path, default=None, help="Path to a TTF/OTF font file.")
    parser.add_argument("--stroke-width", type=int, default=0, help="Optional text outline width in pixels (default: 0).")
    parser.add_argument("--stroke-color", default=None, help="Optional stroke color (name or hex).")

    # Output
    parser.add_argument("--quality", type=int, default=100, help="JPEG/WEBP quality (default: 95).")
    parser.add_argument("--suffix", default="_wm", help="Suffix to append to file name (default: _wm).")
    parser.add_argument("--recursive", action="store_true", help="Process subfolders recursively.")
    parser.add_argument("--keep-tree", action="store_true", help="Recreate input subfolder structure in output (use with --recursive).")

    # Tiling
    parser.add_argument("--tile", action="store_true", help="Repeat the watermark across the whole image (tiled).")
    parser.add_argument("--tile-spacing", type=int, default=64, help="Extra pixels between tiles (both axes).")
    parser.add_argument("--tile-spacing-x", type=int, default=None, help="Override horizontal spacing between tiles.")
    parser.add_argument("--tile-spacing-y", type=int, default=None, help="Override vertical spacing between tiles.")
    parser.add_argument("--tile-offset-x", type=int, default=0, help="Offset the tile grid horizontally (px).")
    parser.add_argument("--tile-offset-y", type=int, default=0, help="Offset the tile grid vertically (px).")
    parser.add_argument("--tile-angle", type=float, default=0.0, help="Rotate each tile by N degrees (e.g., 30, -45).")
    parser.add_argument("--tile-opacity", type=float, default=None, help="Optional opacity for tiles; defaults to --opacity.")

    args = parser.parse_args()

    input_dir: Path = args.input
    output_dir: Path = args.output

    if not input_dir.exists() or not input_dir.is_dir():
        print(f"[error] Input folder does not exist or is not a directory: {input_dir}", file=sys.stderr)
        sys.exit(1)

    try:
        rgb = parse_color(args.color)
    except ValueError as e:
        print(f"[error] Invalid color '{args.color}': {e}", file=sys.stderr)
        sys.exit(1)

    if args.stroke_color:
        try:
            stroke_rgb = parse_color(args.stroke_color)
        except ValueError as e:
            print(f"[error] Invalid stroke color '{args.stroke_color}': {e}", file=sys.stderr)
            sys.exit(1)
    else:
        stroke_rgb = None

    alpha = parse_opacity(args.opacity)

    tile_alpha = parse_opacity(args.tile_opacity) if args.tile_opacity is not None else None

    if args.rel_size is not None and args.rel_size <= 0:
        print("[error] --rel-size must be > 0 (e.g., 0.25).", file=sys.stderr)
        sys.exit(1)

    if args.tile and (args.tile_spacing < 0 or (args.tile_spacing_x is not None and args.tile_spacing_x < 0) or (args.tile_spacing_y is not None and args.tile_spacing_y < 0)):
        print("[error] Tile spacing must be >= 0.", file=sys.stderr)
        sys.exit(1)

    processed = 0
    for src in iter_images(input_dir, args.recursive):
        dst = build_output_path(output_dir, src, args.suffix, args.keep_tree, input_dir)
        try:
            process_image(
                in_path=src,
                out_path=dst,
                text=args.text,
                color=rgb,
                alpha=alpha,
                position=args.position,
                margin=args.margin,
                font_path=str(args.font_path) if args.font_path else None,
                font_size=args.font_size,
                rel_size=args.rel_size,
                stroke_width=args.stroke_width,
                stroke_color=stroke_rgb,
                quality=args.quality,
                tile=args.tile,
                tile_spacing=args.tile_spacing,
                tile_spacing_x=args.tile_spacing_x,
                tile_spacing_y=args.tile_spacing_y,
                tile_offset_x=args.tile_offset_x,
                tile_offset_y=args.tile_offset_y,
                tile_angle=args.tile_angle,
                tile_alpha=tile_alpha,
            )
            processed += 1
            print(f"[ok] {src} -> {dst}")
        except Exception as ex:
            print(f"[fail] {src}: {ex}", file=sys.stderr)

    if processed == 0:
        print("[warn] No images processed. Check your input folder and file extensions.", file=sys.stderr)
    else:
        print(f"[done] Processed {processed} image(s).")

if __name__ == "__main__":
    main()
