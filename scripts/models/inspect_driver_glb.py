import struct
import json

with open('public/models/driver.glb', 'rb') as f:
    magic, version, length = struct.unpack('<4sII', f.read(12))
    chunk_len, chunk_type = struct.unpack('<II', f.read(8))
    json_data = f.read(chunk_len).decode('utf-8')
    gltf = json.loads(json_data)

print('=== DRIVER GLB SUMMARY ===')
print('Total file length:', length)
print('Meshes count:', len(gltf.get('meshes', [])))
print('Nodes count:', len(gltf.get('nodes', [])))
print('Materials count:', len(gltf.get('materials', [])))
print('Animations count:', len(gltf.get('animations', [])))
print('Skins count:', len(gltf.get('skins', [])))

print('\n=== ANIMATIONS ===')
for i, a in enumerate(gltf.get('animations', [])):
    print(f"Animation {i}: '{a.get('name')}', channels: {len(a.get('channels', []))}")

print('\n=== NODES ===')
for i, n in enumerate(gltf.get('nodes', [])):
    name = n.get('name', '')
    mesh = n.get('mesh')
    children = n.get('children')
    rot = n.get('rotation')
    scale = n.get('scale')
    trans = n.get('translation')
    print(f"Node {i:02d}: '{name}' | mesh: {mesh} | trans: {trans} | rot: {rot} | scale: {scale}")

print('\n=== MESHES ===')
for i, m in enumerate(gltf.get('meshes', [])):
    name = m.get('name', '')
    prims = m.get('primitives', [])
    print(f"Mesh {i:02d}: '{name}' | prims: {len(prims)}")

print('\n=== MATERIALS ===')
for i, mat in enumerate(gltf.get('materials', [])):
    print(f"Mat {i:02d}: '{mat.get('name')}'")
