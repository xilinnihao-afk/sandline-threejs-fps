#!/usr/bin/env python3
"""Convert the classic GoldSrc hostage civilian and original animations to GLB.

Python standard library only. Source MDL is kept outside public; the runtime
uses two small skinned variants, without weapons or external sequence groups.
"""
import hashlib
import json
import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'artifacts/objective-modes-20261024'
SOURCE = EVIDENCE / 'hostage.mdl'
OUT = ROOT / 'public/assets/hostages'
SCALE = .0254
SOURCE_URL = 'https://github.com/lennyrivas/cstrike/blob/main/models/hostage.mdl'


def png(width, height, pixels):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    scanlines = b''.join(b'\0' + pixels[y * width * 3:(y + 1) * width * 3] for y in range(height))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>2I5B', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(scanlines, 9)) + chunk(b'IEND', b''))


def quaternion(angles):
    sx, sy, sz = [math.sin(v / 2) for v in angles]
    cx, cy, cz = [math.cos(v / 2) for v in angles]
    return [sx * cy * cz - cx * sy * sz, cx * sy * cz + sx * cy * sz,
            cx * cy * sz - sx * sy * cz, cx * cy * cz + sx * sy * sz]


def matrix(position, q):
    x, y, z, w = q
    return [[1 - 2 * (y*y + z*z), 2 * (x*y - z*w), 2 * (x*z + y*w), position[0]],
            [2 * (x*y + z*w), 1 - 2 * (x*x + z*z), 2 * (y*z - x*w), position[1]],
            [2 * (x*z - y*w), 2 * (y*z + x*w), 1 - 2 * (x*x + y*y), position[2]], [0, 0, 0, 1]]


def multiply(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def point(m, v, w=1):
    return [sum(m[i][j] * v[j] for j in range(3)) + m[i][3] * w for i in range(3)]


def inverse_rigid(m):
    out = [[m[j][i] for j in range(3)] + [0] for i in range(3)] + [[0, 0, 0, 1]]
    for i in range(3):
        out[i][3] = -sum(out[i][j] * m[j][3] for j in range(3))
    return out


class HostageMDL:
    def __init__(self, source):
        self.data = source.read_bytes()
        assert self.data[:4] == b'IDST' and self.integer(4) == 10
        assert self.integer(72) == len(self.data)
        self.bones = []
        for index in range(self.integer(140)):
            o = self.integer(144) + index * 112
            self.bones.append({'name': self.string(o, 32), 'parent': self.integer(o+32),
                               'value': self.floats(o+64, 6), 'scale': self.floats(o+88, 6)})
        self.rest = self.world_matrices([b['value'] for b in self.bones])
        self.textures = []
        for index in range(self.integer(180)):
            o = self.integer(184) + index * 80
            width, height, start = struct.unpack_from('<3i', self.data, o+68)
            palette = self.data[start+width*height:start+width*height+768]
            pixels = b''.join(palette[v*3:v*3+3] for v in self.data[start:start+width*height])
            self.textures.append({'name': self.string(o, 64), 'width': width, 'height': height,
                                  'pixels': pixels, 'png': png(width, height, pixels)})
        self.skins = [list(struct.unpack_from('<'+'H'*self.integer(192), self.data,
                        self.integer(200)+family*self.integer(192)*2)) for family in range(self.integer(196))]
        self.meshes = []
        self.source_vertices = []
        for body in range(self.integer(204)):
            # This civilian has exactly one body model and no attached weapon.
            offset = self.integer(208)+body*76
            assert self.integer(offset+64) == 1
            model = self.integer(offset+72)
            numverts, boneindex, vertindex, numnorms, normboneindex, normindex = struct.unpack_from('<6i', self.data, model+80)
            verts = [self.floats(vertindex+n*12, 3) for n in range(numverts)]
            norms = [self.floats(normindex+n*12, 3) for n in range(numnorms)]
            bones = self.data[boneindex:boneindex+numverts]
            normbones = self.data[normboneindex:normboneindex+numnorms]
            self.source_vertices.extend(zip(verts, bones))
            for n in range(self.integer(model+72)):
                mesh = self.integer(model+76)+n*20
                position, normal, uv, joints, indices, lookup = [], [], [], [], [], {}
                count, cursor, skinref = struct.unpack_from('<3i', self.data, mesh)
                texture = self.textures[self.skins[0][skinref]]
                while True:
                    command = struct.unpack_from('<h', self.data, cursor)[0]
                    cursor += 2
                    if not command:
                        break
                    strip = []
                    for vertex in range(abs(command)):
                        key = struct.unpack_from('<4h', self.data, cursor)
                        cursor += 8
                        if key not in lookup:
                            vi, ni, s, t = key
                            lookup[key] = len(position)
                            position.append(point(self.rest[bones[vi]], verts[vi]))
                            normal.append(point(self.rest[normbones[ni]], norms[ni], 0))
                            uv.append([s/texture['width'], t/texture['height']])
                            joints.append([bones[vi], 0, 0, 0])
                        strip.append(lookup[key])
                    for v in range(2, len(strip)):
                        if command < 0:
                            triangle = [strip[0], strip[v-1], strip[v]]
                        elif v % 2:
                            triangle = [strip[v-1], strip[v-2], strip[v]]
                        else:
                            triangle = [strip[v-2], strip[v-1], strip[v]]
                        # GoldSrc's triangle command order is clockwise. Check
                        # against the authored outward vertex normals once.
                        a, b, c = [position[i] for i in triangle]
                        u, v1 = [b[k]-a[k] for k in range(3)], [c[k]-a[k] for k in range(3)]
                        cross = [u[1]*v1[2]-u[2]*v1[1], u[2]*v1[0]-u[0]*v1[2], u[0]*v1[1]-u[1]*v1[0]]
                        average = [sum(normal[i][k] for i in triangle) for k in range(3)]
                        if sum(cross[k]*average[k] for k in range(3)) < 0:
                            triangle.reverse()
                        indices.extend(triangle)
                assert len(indices)//3 == count, (len(indices)//3, count)
                self.meshes.append({'position': position, 'normal': normal, 'uv': uv,
                                    'joints': joints, 'indices': indices, 'skinref': skinref})
        self.sequences = {}
        for n in range(self.integer(164)):
            o = self.integer(168)+n*176
            self.sequences[self.string(o, 32)] = {'fps': self.floats(o+32, 1)[0], 'frames': self.integer(o+56),
                                                 'anim': self.integer(o+124), 'group': self.integer(o+156),
                                                 'motion': self.integer(o+68), 'motionbone': self.integer(o+72)}

    def integer(self, offset):
        return struct.unpack_from('<i', self.data, offset)[0]

    def floats(self, offset, count):
        return list(struct.unpack_from('<'+'f'*count, self.data, offset))

    def string(self, offset, count):
        return self.data[offset:offset+count].split(b'\0')[0].decode('ascii')

    def world_matrices(self, poses):
        matrices = []
        for bone, pose in zip(self.bones, poses):
            m = matrix(pose[:3], quaternion(pose[3:]))
            matrices.append(multiply(matrices[bone['parent']], m) if bone['parent'] >= 0 else m)
        return matrices

    def frame(self, sequence, frame):
        seq = self.sequences[sequence]
        assert seq['group'] == 0, 'Only self-contained sequence groups are exported'
        output = []
        for index, bone in enumerate(self.bones):
            start = seq['anim']+index*12
            pose = list(bone['value'])
            for channel, offset in enumerate(struct.unpack_from('<6H', self.data, start)):
                if offset:
                    cursor, remaining = start+offset, frame
                    while True:
                        valid, total = self.data[cursor:cursor+2]
                        assert valid and total >= valid
                        if remaining < total:
                            value = struct.unpack_from('<h', self.data, cursor+2*min(remaining+1, valid))[0]
                            pose[channel] += value*bone['scale'][channel]
                            break
                        cursor += (valid+1)*2
                        remaining -= total
            # GoldSrc removes motion channels and supplies world locomotion.
            if index == seq['motionbone']:
                for channel in range(3):
                    if seq['motion'] & (1 << channel):
                        pose[channel] = 0
            output.append(pose)
        return output


def build_glb(mdl, skin):
    binary = bytearray()
    doc = {'asset': {'version': '2.0', 'generator': 'Sandline GoldSrc hostage importer',
                     'copyright': 'Original Counter-Strike / Half-Life asset, Valve and original rights holders'},
           'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [], 'meshes': [], 'skins': [],
           'materials': [], 'textures': [], 'images': [], 'samplers': [{'magFilter': 9729, 'minFilter': 9987}],
           'accessors': [], 'bufferViews': [], 'animations': []}

    def view(data, target=None):
        binary.extend(b'\0' * (-len(binary) % 4))
        result = {'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data)}
        if target:
            result['target'] = target
        binary.extend(data)
        doc['bufferViews'].append(result)
        return len(doc['bufferViews'])-1

    def accessor(values, kind, component=5126, bounds=False, target=None):
        sizes = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
        size = sizes[kind]
        rows = [[v] for v in values] if size == 1 else values
        flattened = [v for row in rows for v in row]
        data = struct.pack('<'+{5126: 'f', 5123: 'H'}[component]*len(flattened), *flattened)
        a = {'bufferView': view(data, target), 'componentType': component, 'count': len(values), 'type': kind}
        if bounds:
            a['min'] = [min(row[i] for row in rows) for i in range(size)]
            a['max'] = [max(row[i] for row in rows) for i in range(size)]
        doc['accessors'].append(a)
        return len(doc['accessors'])-1

    idle_world = mdl.world_matrices(mdl.frame('idle1', 0))
    feet = min(point(idle_world[bone], vertex)[2] for vertex, bone in mdl.source_vertices)
    doc['nodes'].append({'name': 'ClassicHostage', 'matrix': [0, 0, -SCALE, 0, -SCALE, 0, 0, 0,
                                                          0, SCALE, 0, 0, 0, -feet*SCALE, 0, 1],
                         'children': [1, len(mdl.bones)+1]})
    for index, bone in enumerate(mdl.bones):
        node = {'name': bone['name'].replace(' ', '_'), 'translation': bone['value'][:3],
                'rotation': quaternion(bone['value'][3:])}
        children = [i+1 for i, child in enumerate(mdl.bones) if child['parent'] == index]
        if children:
            node['children'] = children
        doc['nodes'].append(node)
    inverse = [inverse_rigid(m) for m in mdl.rest]
    doc['skins'].append({'name': 'GoldSrc21BoneCivilian', 'joints': list(range(1, len(mdl.bones)+1)),
                         'skeleton': 1, 'inverseBindMatrices': accessor([[m[row][column] for column in range(4) for row in range(4)] for m in inverse], 'MAT4')})
    for texture_id in mdl.skins[skin]:
        texture = mdl.textures[texture_id]
        doc['images'].append({'name': texture['name'], 'mimeType': 'image/png', 'bufferView': view(texture['png'])})
        index = len(doc['textures'])
        doc['textures'].append({'sampler': 0, 'source': index})
        doc['materials'].append({'name': texture['name'], 'pbrMetallicRoughness': {
            'baseColorTexture': {'index': index}, 'roughnessFactor': .92, 'metallicFactor': 0}})
    primitives = []
    for mesh in mdl.meshes:
        primitives.append({'attributes': {
            'POSITION': accessor(mesh['position'], 'VEC3', bounds=True, target=34962),
            'NORMAL': accessor(mesh['normal'], 'VEC3', target=34962),
            'TEXCOORD_0': accessor(mesh['uv'], 'VEC2', target=34962),
            'JOINTS_0': accessor(mesh['joints'], 'VEC4', 5123, target=34962),
            'WEIGHTS_0': accessor([[1, 0, 0, 0]]*len(mesh['position']), 'VEC4', target=34962)},
            'indices': accessor(mesh['indices'], 'SCALAR', 5123, target=34963), 'material': mesh['skinref']})
    doc['meshes'].append({'name': 'UnarmedCivilian', 'primitives': primitives})
    doc['nodes'].append({'name': 'HostageBody', 'mesh': 0, 'skin': 0})
    for name, source in [('Idle', 'idle1'), ('Walk', 'walk_scared'), ('Run', 'run'), ('Crouch', 'crouch_idle')]:
        seq = mdl.sequences[source]
        poses = [mdl.frame(source, frame) for frame in range(seq['frames'])]
        times = accessor([frame/seq['fps'] for frame in range(seq['frames'])], 'SCALAR', bounds=True)
        animation = {'name': name, 'samplers': [], 'channels': [], 'extras': {'sourceSequence': source}}
        for index in range(len(mdl.bones)):
            positions = [pose[index][:3] for pose in poses]
            # The source model's root has incidental XY drift; gameplay owns
            # horizontal displacement while all authored vertical sway remains.
            if mdl.bones[index]['parent'] == -1:
                for p in positions:
                    p[0], p[1] = poses[0][index][0], poses[0][index][1]
            rotations = [quaternion(pose[index][3:]) for pose in poses]
            for frame in range(1, len(rotations)):
                if sum(a*b for a, b in zip(rotations[frame-1], rotations[frame])) < 0:
                    rotations[frame] = [-q for q in rotations[frame]]
            for path, values, kind in [('translation', positions, 'VEC3'), ('rotation', rotations, 'VEC4')]:
                animation['channels'].append({'sampler': len(animation['samplers']), 'target': {'node': index+1, 'path': path}})
                animation['samplers'].append({'input': times, 'output': accessor(values, kind), 'interpolation': 'LINEAR'})
        doc['animations'].append(animation)
    binary.extend(b'\0' * (-len(binary) % 4))
    doc['buffers'] = [{'byteLength': len(binary)}]
    metadata = json.dumps(doc, separators=(',', ':')).encode()
    metadata += b' ' * (-len(metadata) % 4)
    glb = (struct.pack('<III', 0x46546c67, 2, 28+len(metadata)+len(binary))
           + struct.pack('<II', len(metadata), 0x4e4f534a)+metadata
           + struct.pack('<II', len(binary), 0x004e4942)+binary)
    name = f'hostage-{skin+1}.glb'
    (OUT/name).write_bytes(glb)
    return {'file': name, 'bytes': len(glb), 'sha256': hashlib.sha256(glb).hexdigest(),
            'triangles': sum(len(m['indices'])//3 for m in mdl.meshes), 'bones': len(mdl.bones),
            'materials': len(mdl.skins[skin]), 'clips': [a['name'] for a in doc['animations']],
            'sourceFeetZ': feet, 'sourceTextureNames': [mdl.textures[i]['name'] for i in mdl.skins[skin]]}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    mdl = HostageMDL(SOURCE)
    report = {'source': SOURCE_URL, 'sourceGitBlob': '3672bf1992e7a7edaca7bf47b9d200649b5fe655',
              'sourceSha256': hashlib.sha256(mdl.data).hexdigest(), 'sourceBytes': len(mdl.data),
              'conversion': 'Original MDL geometry, rigid bone weights, normals, UVs, palette textures and local animation tracks. GoldSrc inch scale; Y up; -Z forward. Idle foot plane grounded. No weapon mesh.',
              'files': [build_glb(mdl, skin) for skin in range(len(mdl.skins))]}
    (EVIDENCE/'hostage-assets.json').write_text(json.dumps(report, indent=2)+'\n')
    (OUT/'manifest.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
