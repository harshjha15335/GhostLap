#!/usr/bin/env python3
"""
Import and process the 2026 Mercedes W17 3D model from Sketchfab
(https://sketchfab.com/3d-models/2026-mercedes-w17-b806f1e70aa343219e7158169549b97b).

Usage:
    python scripts/models/import_w17.py [path_to_zip_or_glb]

If no path is specified, it scans the user's Downloads directory for any file
matching '*w17*' or '*b806f1e70aa343219e7158169549b97b*'.
"""

import sys
import os
import glob
import zipfile
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
PUBLIC_MODELS = ROOT / "public" / "models"
TARGET_GLB = PUBLIC_MODELS / "f1-2026-high.glb"

def find_downloaded_file():
    downloads = Path.home() / "Downloads"
    patterns = [
        "*w17*.zip", "*w17*.glb", "*w17*.gltf",
        "*b806f1e70aa343219e7158169549b97b*.zip",
        "*mercedes*2026*.zip", "*mercedes*2026*.glb"
    ]
    for pat in patterns:
        matches = list(downloads.glob(pat))
        if matches:
            # Return most recently modified
            matches.sort(key=lambda p: p.stat().st_mtime, reverse=True)
            return matches[0]
    return None

def main():
    src = None
    if len(sys.argv) > 1:
        src = Path(sys.argv[1])
    else:
        src = find_downloaded_file()

    if not src or not src.exists():
        print("No downloaded W17 model found.")
        print("Please download the model (glTF / GLB) from:")
        print("  https://sketchfab.com/3d-models/2026-mercedes-w17-b806f1e70aa343219e7158169549b97b")
        print("and run:")
        print("  python scripts/models/import_w17.py <path_to_downloaded_file>")
        sys.exit(1)

    print(f"Found source file: {src}")
    PUBLIC_MODELS.mkdir(parents=True, exist_ok=True)

    if src.suffix.lower() == ".zip":
        extract_dir = PUBLIC_MODELS / "w17_extracted"
        extract_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(src, "r") as zf:
            zf.extractall(extract_dir)
        print(f"Extracted to: {extract_dir}")
        
        # Look for scene.gltf or .glb
        glbs = list(extract_dir.glob("**/*.glb"))
        gltfs = list(extract_dir.glob("**/*.gltf"))
        if glbs:
            shutil.copy(glbs[0], TARGET_GLB)
            print(f"Copied {glbs[0].name} -> {TARGET_GLB}")
        elif gltfs:
            print(f"Found glTF: {gltfs[0]}. Converting or referencing...")
            # We can also keep the whole folder or convert with gltf-transform
            shutil.copy(gltfs[0], PUBLIC_MODELS / "scene.gltf")
    elif src.suffix.lower() == ".glb":
        shutil.copy(src, TARGET_GLB)
        print(f"Copied {src} -> {TARGET_GLB}")

    print("W17 model import complete!")

if __name__ == "__main__":
    main()
