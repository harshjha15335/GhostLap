import struct
import json
import os

with open('public/models/driver.glb', 'rb') as f:
    magic, ver, length = struct.unpack('<4sII', f.read(12))
    chunk_len, chunk_type = struct.unpack('<II', f.read(8))
    json_data = f.read(chunk_len).decode('utf-8')
    bin_chunk_len, bin_chunk_type = struct.unpack('<II', f.read(8))
    bin_data = f.read(bin_chunk_len)
    gltf = json.loads(json_data)

bufferViews = gltf.get('bufferViews', [])
images = gltf.get('images', [])

out_dir = r'public/models/driver_textures'
os.makedirs(out_dir, exist_ok=True)

for i, img in enumerate(images):
    bv_idx = img.get('bufferView')
    bv = bufferViews[bv_idx]
    byte_offset = bv.get('byteOffset', 0)
    byte_len = bv['byteLength']
    img_data = bin_data[byte_offset : byte_offset + byte_len]
    ext = 'jpg' if img.get('mimeType') == 'image/jpeg' else 'png'
    name = img.get('name', f'img_{i}')
    out_path = os.path.join(out_dir, f"{i}_{name}.{ext}")
    with open(out_path, 'wb') as out_f:
        out_f.write(img_data)
    print(f"Extracted: {out_path} ({len(img_data)} bytes)")
