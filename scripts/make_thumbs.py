#!/usr/bin/env python3
"""
make_thumbs.py  —  version robuste (JPEG/PNG/HEIC*)
Crée des miniatures WEBP en miroir d'arborescence.

- Orientation EXIF corrigée (ImageOps.exif_transpose)
- Conversion des modes (CMYK/P/L/LA → RGB/RGBA)
- Conserve alpha; lossless si alpha
- Extensions prises en charge (casse insensible) : jpg, jpeg, png, heic, heif
- Options: --skip-existing, --width, --quality, --verbose

Usage :
  python make_thumbs.py --photos ./photos --thumbs ./thumbs --width 1200 --quality 80 --skip-existing --verbose
"""
import os, argparse, sys
from pathlib import Path
from PIL import Image, ImageOps, UnidentifiedImageError

try:
    from pillow_heif import register_heif  # optionnel pour HEIC/HEIF
    register_heif()
except Exception:
    pass

def ensure_rgb(im):
    if im.mode in ("RGB","RGBA"): return im
    if im.mode == "CMYK": return im.convert("RGB")
    if im.mode in ("P","L"): return im.convert("RGB")
    if im.mode == "LA": return im.convert("RGBA")
    try: return im.convert("RGB")
    except Exception: return im

def save_webp(im, out_path, quality, has_alpha):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    params = {"method": 6}
    if has_alpha:
        params.update({"lossless": True})
    else:
        params.update({"quality": quality})
    im.save(out_path, "WEBP", **params)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--photos", required=True)
    p.add_argument("--thumbs", required=True)
    p.add_argument("--width", type=int, default=1200)
    p.add_argument("--quality", type=int, default=80)
    p.add_argument("--skip-existing", action="store_true")
    p.add_argument("--verbose", action="store_true")
    args = p.parse_args()

    photos = Path(args.photos)
    thumbs = Path(args.thumbs)
    thumbs.mkdir(parents=True, exist_ok=True)

    exts = {".jpg",".jpeg",".png",".heic",".heif"}
    count = skipped = 0
    for src in sorted(photos.rglob("*")):
        if src.suffix.lower() not in exts: continue
        rel = src.relative_to(photos)
        out = (thumbs / rel).with_suffix(".webp")
        if args.skip_existing and out.exists():
            skipped += 1
            if args.verbose: print(f"[skip] {out}")
            continue
        try:
            im = Image.open(src)
            try: im = ImageOps.exif_transpose(im)
            except Exception: pass

            w,h = im.size
            if args.width and w > args.width:
                new_h = int(h * (args.width / w))
                im = im.resize((args.width, new_h), Image.LANCZOS)

            im = ensure_rgb(im)
            has_alpha = ("A" in im.getbands())

            save_webp(im, out, args.quality, has_alpha)
            count += 1
            if args.verbose: print(f"[ok] {src} -> {out}")
        except UnidentifiedImageError:
            print(f"[warn] Non reconnu: {src}", file=sys.stderr)
        except OSError as e:
            print(f"[warn] I/O: {src} — {e}", file=sys.stderr)
        except Exception as e:
            print(f"[warn] Erreur: {src} — {e}", file=sys.stderr)

    print(f"Miniatures générées: {count} — ignorées: {skipped} — vers: {thumbs}")

if __name__ == "__main__":
    main()
