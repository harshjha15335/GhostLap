import struct
import json

with open('public/models/w17.glb', 'rb') as f:
    magic, version, length = struct.unpack('<4sII', f.read(12))
    chunk_len, chunk_type = struct.unpack('<II', f.read(8))
    json_data = f.read(chunk_len).decode('utf-8')
    gltf = json.loads(json_data)

print('=== GLB SUMMARY ===')
print('Total file length:', length)
print('Meshes count:', len(gltf.get('meshes', [])))
print('Nodes count:', len(gltf.get('nodes', [])))
print('Materials count:', len(gltf.get('materials', [])))
print('Images count:', len(gltf.get('images', [])))
print('Textures count:', len(gltf.get('textures', [])))

print('\n=== NODES ===')
for i, n in enumerate(gltf.get('nodes', [])):
    name = n.get('name', '')
    mesh = n.get('mesh')
    children = n.get('children')
    print(f"Node {i:02d}: '{name}' | mesh: {mesh} | children: {children}")

print('\n=== MESHES ===')
for i, m in enumerate(gltf.get('meshes', [])):
    name = m.get('name', '')
    prims = len(m.get('primitives', []))
    print(f"Mesh {i:02d}: '{name}' | primitives: {prims}")

print('\n=== MATERIALS ===')
for i, mat in enumerate(gltf.get('materials', [])):
    print(f"Mat {i:02d}: '{mat.get('name')}'")
