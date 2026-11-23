import struct
import json

with open('public/models/driver.glb', 'rb') as f:
    f.seek(12)
    chunk_len, _ = struct.unpack('<II', f.read(8))
    gltf = json.loads(f.read(chunk_len).decode('utf-8'))

for i, m in enumerate(gltf.get('materials', [])):
    pbr = m.get('pbrMetallicRoughness', {})
    base_color = pbr.get('baseColorFactor', [1, 1, 1, 1])
    tex = pbr.get('baseColorTexture')
    print(f"Mat {i}: '{m.get('name')}', baseColor: {base_color}, hasTexture: {tex is not None}")
