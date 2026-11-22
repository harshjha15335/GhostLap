import struct
import json

with open('public/models/w17.glb', 'rb') as f:
    magic, version, length = struct.unpack('<4sII', f.read(12))
    chunk_len, chunk_type = struct.unpack('<II', f.read(8))
    json_data = f.read(chunk_len).decode('utf-8')
    gltf = json.loads(json_data)

nodes = gltf.get('nodes', [])
meshes = gltf.get('meshes', [])
materials = gltf.get('materials', [])
accessors = gltf.get('accessors', [])

for n in nodes:
    mesh_idx = n.get('mesh')
    if mesh_idx is None:
        continue
    m = meshes[mesh_idx]
    for p in m.get('primitives', []):
        mat_idx = p.get('material')
        mat_name = materials[mat_idx].get('name', '') if mat_idx is not None else ''
        pos_acc = p.get('attributes', {}).get('POSITION')
        pos_min = accessors[pos_acc].get('min', [])
        pos_max = accessors[pos_acc].get('max', [])
        print(f"{n.get('name')}: mat='{mat_name}', Z=[{pos_min[1]:.2f}, {pos_max[1]:.2f}], Y=[{pos_min[2]:.2f}, {pos_max[2]:.2f}], X=[{pos_min[0]:.2f}, {pos_max[0]:.2f}]")
