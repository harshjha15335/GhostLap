import struct
import json
import os

with open('public/models/driver.glb', 'rb') as f:
    magic, ver, total_len = struct.unpack('<4sII', f.read(12))
    json_len, json_type = struct.unpack('<II', f.read(8))
    json_str = f.read(json_len).decode('utf-8')
    gltf = json.loads(json_str)
    
    bin_len, bin_type = struct.unpack('<II', f.read(8))
    bin_data = bytearray(f.read(bin_len))

bufferViews = gltf['bufferViews']
images = gltf['images']

# Load replacement textures
with open('public/models/driver_textures/suit_grayscale.png', 'rb') as sf:
    suit_bytes = sf.read()

with open('public/models/driver_textures/helmet_grayscale.png', 'rb') as hf:
    helmet_bytes = hf.read()

# Image 1 is helmet, Image 4 is suit
# To be completely clean, let's append new bytes to bin_data and update bufferViews
def replace_image(img_idx, new_bytes):
    bv_idx = images[img_idx]['bufferView']
    # Align to 4 bytes
    while len(bin_data) % 4 != 0:
        bin_data.append(0)
    new_offset = len(bin_data)
    bin_data.extend(new_bytes)
    # Align to 4 bytes
    while len(bin_data) % 4 != 0:
        bin_data.append(0)
    bufferViews[bv_idx]['byteOffset'] = new_offset
    bufferViews[bv_idx]['byteLength'] = len(new_bytes)
    images[img_idx]['mimeType'] = 'image/png'
    print(f"Replaced image {img_idx} at offset {new_offset}, len {len(new_bytes)}")

replace_image(1, helmet_bytes)
replace_image(4, suit_bytes)

# Update buffer 0 byteLength
gltf['buffers'][0]['byteLength'] = len(bin_data)

# Re-encode JSON
new_json_str = json.dumps(gltf, separators=(',', ':'))
new_json_bytes = new_json_str.encode('utf-8')
# Pad JSON to 4-byte boundary with spaces (0x20)
while len(new_json_bytes) % 4 != 0:
    new_json_bytes += b' '

new_total_len = 12 + 8 + len(new_json_bytes) + 8 + len(bin_data)

out_glb = 'public/models/driver.glb'
with open(out_glb, 'wb') as out_f:
    out_f.write(struct.pack('<4sII', magic, ver, new_total_len))
    out_f.write(struct.pack('<II', len(new_json_bytes), json_type))
    out_f.write(new_json_bytes)
    out_f.write(struct.pack('<II', len(bin_data), bin_type))
    out_f.write(bin_data)

print(f"Successfully repacked {out_glb}, new total size: {new_total_len} bytes")
