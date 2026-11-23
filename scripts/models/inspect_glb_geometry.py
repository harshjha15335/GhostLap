import struct
import json

with open('public/models/w17.glb', 'rb') as f:
    magic, version, length = struct.unpack('<4sII', f.read(12))
    chunk_len, chunk_type = struct.unpack('<II', f.read(8))
    json_data = f.read(chunk_len).decode('utf-8')
    bin_offset = 12 + 8 + chunk_len
    gltf = json.loads(json_data)

nodes = gltf.get('nodes', [])
meshes = gltf.get('meshes', [])
materials = gltf.get('materials', [])
accessors = gltf.get('accessors', [])

print(f"{'Node':<12} {'Mesh':<12} {'Material':<25} {'Tris':<8} {'Min [X, Y, Z]':<30} {'Max [X, Y, Z]'}")
print('-' * 110)

total_tris = 0
for n_idx, n in enumerate(nodes):
    mesh_idx = n.get('mesh')
    if mesh_idx is None:
        continue
    m = meshes[mesh_idx]
    for p in m.get('primitives', []):
        mat_idx = p.get('material')
        mat_name = materials[mat_idx].get('name', '') if mat_idx is not None else 'None'
        idx_acc = p.get('indices')
        tris = accessors[idx_acc]['count'] // 3 if idx_acc is not None else 0
        total_tris += tris
        
        pos_acc = p.get('attributes', {}).get('POSITION')
        pos_min = accessors[pos_acc].get('min', []) if pos_acc is not None else []
        pos_max = accessors[pos_acc].get('max', []) if pos_acc is not None else []
        
        min_str = f"[{pos_min[0]:.2f}, {pos_min[1]:.2f}, {pos_min[2]:.2f}]" if pos_min else ""
        max_str = f"[{pos_max[0]:.2f}, {pos_max[1]:.2f}, {pos_max[2]:.2f}]" if pos_max else ""
        
        print(f"{n.get('name', ''):<12} {m.get('name', ''):<12} {mat_name:<25} {tris:<8} {min_str:<30} {max_str}")

print('-' * 110)
print(f"Total Triangles: {total_tris:,}")
