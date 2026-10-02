from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage


def walk_layers(layer, path: tuple[str, ...] = ()):
    current = (*path, layer.name or "Без названия")
    if layer.is_group():
        for child in layer:
            yield from walk_layers(child, current)
        return
    yield layer, current


def find_top_level_group(psd: PSDImage, name: str):
    for layer in psd:
        if layer.name == name and layer.is_group():
            return layer
    raise ValueError(f"Группа {name!r} не найдена")


def stable_id(path: tuple[str, ...], source_index: int) -> str:
    digest = hashlib.sha1("/".join(path).encode("utf-8")).hexdigest()[:10]
    return f"layer-{source_index:03d}-{digest}"


def resize(image: Image.Image, scale: float) -> Image.Image:
    if scale == 1:
        return image
    size = (
        max(1, round(image.width * scale)),
        max(1, round(image.height * scale)),
    )
    return image.resize(size, Image.Resampling.LANCZOS)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("psd", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--group", default="Группа 1")
    parser.add_argument("--width", type=int, default=4096)
    parser.add_argument("--crop-right", type=int, default=None)
    parser.add_argument("--exclude-layer-id", action="append", default=[])
    args = parser.parse_args()

    psd = PSDImage.open(args.psd)
    scale = min(1.0, args.width / psd.width)
    output = args.output
    assets = output / "assets"
    layers_dir = assets / "layers"
    data_dir = output / "data"
    layers_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)

    base = resize(psd.topil().convert("RGB"), scale)
    if args.crop_right is not None:
        crop_right = min(base.width, max(1, round(args.crop_right * scale)))
        base = base.crop((0, 0, crop_right, base.height))
    base.save(assets / "base.webp", "WEBP", quality=90, method=6)

    group = find_top_level_group(psd, args.group)
    manifest: list[dict] = []
    skipped: list[dict] = []

    for source_index, (layer, path) in enumerate(walk_layers(group), start=1):
        bbox = layer.bbox
        if not bbox:
            skipped.append({"path": list(path), "reason": "empty-bbox"})
            continue
        x1, y1, x2, y2 = bbox
        if x2 <= x1 or y2 <= y1:
            skipped.append({"path": list(path), "reason": "empty-bbox"})
            continue
        if layer.is_visible():
            skipped.append({"path": list(path), "reason": "visible-in-base"})
            continue

        layer_id = stable_id(path, source_index)
        if layer_id in args.exclude_layer_id:
            skipped.append({"path": list(path), "reason": "excluded-by-id", "id": layer_id})
            continue
        asset_name = f"{layer_id}.webp"
        try:
            # topil() reads the layer pixels even when the PSD layer is hidden.
            rendered = layer.topil()
            if rendered is None:
                raise ValueError("composite returned None")
            rendered = resize(rendered.convert("RGBA"), scale)
            rendered.save(
                layers_dir / asset_name,
                "WEBP",
                lossless=True,
                method=6,
            )
        except Exception as exc:  # Keep a complete export report for PSD edge cases.
            skipped.append(
                {"path": list(path), "reason": "render-error", "error": str(exc)}
            )
            continue

        manifest.append(
            {
                "id": layer_id,
                "name": layer.name or "Без названия",
                "sourcePath": list(path),
                "sourceIndex": source_index,
                "asset": f"assets/layers/{asset_name}",
                "bbox": {
                    "left": round(x1 * scale),
                    "top": round(y1 * scale),
                    "width": rendered.width,
                    "height": rendered.height,
                },
                "sourceBbox": [x1, y1, x2, y2],
                "defaultStatus": "unknown",
                "weatherRule": None,
            }
        )

    document = {
        "schemaVersion": 1,
        "source": {
            "file": args.psd.name,
            "canvas": {"width": psd.width, "height": psd.height},
            "colorMode": str(psd.color_mode),
            "managedGroup": args.group,
            "selectionRule": "hidden non-empty leaf layers",
        },
        "render": {
            "width": base.width,
            "height": base.height,
            "scale": scale,
            "base": "assets/base.webp",
        },
        "layers": manifest,
        "export": {
            "exported": len(manifest),
            "skipped": len(skipped),
            "skippedItems": skipped,
        },
    }
    if args.crop_right is not None:
        document["render"]["crop"] = {"left": 0, "top": 0, "right": base.width, "bottom": base.height}
    (data_dir / "layers.json").write_text(
        json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "base": [base.width, base.height],
                "exported": len(manifest),
                "skipped": len(skipped),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
