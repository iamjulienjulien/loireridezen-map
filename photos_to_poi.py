#!/usr/bin/env python3
"""
photos_to_poi.py
Convert geotagged photos into a GeoJSON FeatureCollection ready for Leaflet.
- Reads JPEG/JPG/PNG/HEIC with GPS EXIF (lat/lon)
- Outputs: data/pois_photos.geojson (type = "photo")
- Each feature: name (from filename), image (relative path), thumb (thumbnail path if any), time (DateTimeOriginal)
Usage:
  python photos_to_poi.py --photos ./photos --out ./data/pois_photos.geojson --image-prefix ./photos --thumb-prefix ./thumbs
"""
import os, json, argparse, datetime
from pathlib import Path

# Try to import piexif + PIL (Pillow) for EXIF; fall back to exifread if needed
def _try_imports():
    libs = {}
    try:
        import piexif
        libs["piexif"] = piexif
    except Exception:
        libs["piexif"] = None
    try:
        from PIL import Image
        libs["PIL_Image"] = Image
    except Exception:
        libs["PIL_Image"] = None
    try:
        import exifread
        libs["exifread"] = exifread
    except Exception:
        libs["exifread"] = None
    return libs

LIBS = _try_imports()

def dms_to_deg(values, ref):
    """Convert EXIF DMS (as rationals) to decimal degrees"""
    try:
        d, m, s = values
        # Handle PIL rationals or exifread Ratio
        def rat_to_float(x):
            try:
                return float(x[0]) / float(x[1])
            except Exception:
                try:
                    return float(x.num) / float(x.den)
                except Exception:
                    return float(x)
        dd = rat_to_float(d) + rat_to_float(m)/60.0 + rat_to_float(s)/3600.0
        if ref in ["S","W"]:
            dd = -dd
        return dd
    except Exception:
        return None

def get_exif_piexif(path):
    Image = LIBS["PIL_Image"]
    piexif = LIBS["piexif"]
    if not Image or not piexif: return None
    try:
        im = Image.open(path)
        exif_bytes = im.info.get("exif")
        if not exif_bytes:
            return None
        exif = piexif.load(exif_bytes)
        gps = exif.get("GPS", {})
        lat = dms_to_deg(gps.get(piexif.GPSIFD.GPSLatitude), gps.get(piexif.GPSIFD.GPSLatitudeRef, b"").decode(errors="ignore") if gps.get(piexif.GPSIFD.GPSLatitudeRef) else None)
        lon = dms_to_deg(gps.get(piexif.GPSIFD.GPSLongitude), gps.get(piexif.GPSIFD.GPSLongitudeRef, b"").decode(errors="ignore") if gps.get(piexif.GPSIFD.GPSLongitudeRef) else None)
        # DateTimeOriginal
        exif_DT = exif.get("Exif", {}).get(piexif.ExifIFD.DateTimeOriginal)
        when = exif_DT.decode(errors="ignore") if isinstance(exif_DT, (bytes,bytearray)) else exif_DT
        return {"lat": lat, "lon": lon, "time": when}
    except Exception:
        return None

def get_exif_exifread(path):
    exifread = LIBS["exifread"]
    if not exifread: return None
    try:
        with open(path, "rb") as f:
            tags = exifread.process_file(f, details=False)
        lat = dms_to_deg(tags.get("GPS GPSLatitude", []), str(tags.get("GPS GPSLatitudeRef", "")))
        lon = dms_to_deg(tags.get("GPS GPSLongitude", []), str(tags.get("GPS GPSLongitudeRef", "")))
        when = str(tags.get("EXIF DateTimeOriginal", ""))
        return {"lat": lat, "lon": lon, "time": when}
    except Exception:
        return None

def extract_gps_datetime(path):
    # 1) piexif+PIL; 2) exifread; (HEIC might not work without extra deps)
    info = get_exif_piexif(path)
    if not info:
        info = get_exif_exifread(path)
    return info or {}

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--photos", required=True, help="Folder containing photos")
    p.add_argument("--out", default="./data/pois_photos.geojson", help="Output GeoJSON file")
    p.add_argument("--image-prefix", default="./photos", help="URL/path prefix for image links in GeoJSON")
    p.add_argument("--thumb-prefix", default="./thumbs", help="URL/path prefix for thumbnails (optional)")
    args = p.parse_args()

    photos_dir = Path(args.photos)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    exts = {".jpg",".jpeg",".png",".JPG",".JPEG",".PNG",".heic",".HEIC"}
    feats = []
    for f in sorted(photos_dir.rglob("*")):
        if not f.suffix in exts:
            continue
        info = extract_gps_datetime(str(f))
        lat, lon = info.get("lat"), info.get("lon")
        if lat is None or lon is None:
            continue  # skip non-geotagged
        when = info.get("time")
        name = f.stem.replace("_"," ").replace("-"," ").strip()
        image_rel = f.as_posix().split(photos_dir.as_posix())[-1].lstrip("/")
        image_url = os.path.join(args.image_prefix, image_rel).replace("\\","/")
        thumb_url = os.path.join(args.thumb_prefix, image_rel).replace("\\","/")
        feats.append({
            "type":"Feature",
            "properties": {
                "name": name,
                "type": "photo",
                "image": image_url,
                "thumb": thumb_url,
                "time": when
            },
            "geometry": {"type":"Point","coordinates":[lon, lat]}
        })

    fc = {"type":"FeatureCollection","features":feats}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(feats)} features → {out_path}")

if __name__ == "__main__":
    main()
