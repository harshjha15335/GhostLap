import json
import struct

with open('public/models/driver.glb', 'rb') as f:
    f.seek(12)
    l, _ = struct.unpack('<II', f.read(8))
    g = json.loads(f.read(l).decode('utf-8'))

for m in g['materials']:
    p = m.get('pbrMetallicRoughness', {})
    t = p.get('baseColorTexture')
    tex_id = t['index'] if t else None
    img_id = g['textures'][tex_id]['source'] if tex_id is not None else None
    print(f"Material '{m['name']}' -> texture {tex_id} -> image {img_id}")
