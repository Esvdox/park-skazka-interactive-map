from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

from PIL import Image


def fail(message: str) -> None:
    print(f"ERROR: {message}")
    raise SystemExit(1)


def main() -> None:
    root = Path(sys.argv[1])
    manifest = json.loads((root / "data" / "layers.json").read_text(encoding="utf-8"))
    ids: set[str] = set()
    failures: list[str] = []

    # The browser may receive a cache-busting query string; the local file name does not.
    base_ref = manifest["render"]["base"]
    base_path = root / urlsplit(base_ref).path
    with Image.open(base_path) as base:
        actual_base = [base.width, base.height]
    expected_base = [manifest["render"]["width"], manifest["render"]["height"]]
    if actual_base != expected_base:
        fail(f"base size {actual_base} != {expected_base}")

    for layer in manifest["layers"]:
        if layer["id"] in ids:
            failures.append(f"duplicate id: {layer['id']}")
        ids.add(layer["id"])
        asset = root / layer["asset"]
        if not asset.exists():
            failures.append(f"missing asset: {asset}")
            continue
        with Image.open(asset) as image:
            expected = [layer["bbox"]["width"], layer["bbox"]["height"]]
            actual = [image.width, image.height]
            if actual != expected:
                failures.append(f"size mismatch {layer['id']}: {actual} != {expected}")
            alpha = image.getchannel("A") if "A" in image.getbands() else None
            if alpha is None or alpha.getbbox() is None:
                failures.append(f"empty alpha: {layer['id']}")

    if failures:
        for item in failures:
            print(f"ERROR: {item}")
        raise SystemExit(1)

    print(
        json.dumps(
            {
                "base": expected_base,
                "layers": len(manifest["layers"]),
                "uniqueIds": len(ids),
                "assetsWithPixels": len(manifest["layers"]),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
