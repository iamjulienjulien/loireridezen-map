#!/usr/bin/env python3
"""
make_thumbs.py
Create WEBP thumbnails for all images in --photos into --thumbs, mirroring subfolders.
Default size: width 1200px (height auto), quality 80.
Usage:
  python make_thumbs.py --photos ./photos --thumbs ./thumbs --width 1200 --quality 80
"""
import os, argparse
from pathlib import Path
from PIL import Image

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--photos", required=True, help="Source photos folder")
    p.add_argument("--thumbs", required=True, help="Output thumbnails folder (mirrors structure)")
    p.add_argument("--width", type=int, default=1200)
    p.add_argument("--quality", type=int, default=80)
    args = p.parse_args()

    photos = Path(args.photos)
    thumbs = Path(args.thumbs)
    thumbs.mkdir(parents=True, exist_ok=True)

    exts = {".jpg",".jpeg",".png",".JPG",".JPEG",".PNG",".heic",".HEIC"}
    count = 0
    for src in sorted(photos.rglob("*")):
        if src.suffix not in exts: continue
        # mirror out path, change extension to .webp
        rel = src.relative_to(photos)
        out = (thumbs / rel).with_suffix(".webp")
        out.parent.mkdir(parents=True, exist_ok=True)

        try:
            im = Image.open(src)
            # handle rotation by EXIF
            im = Image.Image.transpose(im, Image.Transpose.EXIF) if hasattr(Image, "Transpose") else im
            w, h = im.size
            if w > args.width:
                new_h = int(h * (args.width / w))
                im = im.resize((args.width, new_h), Image.LANCZOS)
            im.save(out, "WEBP", quality=args.quality, method=6)
            count += 1
        except Exception as e:
            print(f"Skip {src}: {e}")

    print(f"Generated {count} thumbnails → {thumbs}")

if __name__ == "__main__":
    main()
