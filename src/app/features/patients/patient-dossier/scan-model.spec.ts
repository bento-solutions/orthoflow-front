import { describe, it, expect } from 'vitest';
import type { Mesh } from 'three';
import { SMOOTH_LIMIT, hasModelExtension, isModel, loadScanModel, modelLabel } from './scan-model';

/** One triangle as a binary STL: 80-byte header, the count, then 50 bytes a facet. */
function binaryStl(): Blob {
  const buf = new ArrayBuffer(84 + 50);
  const view = new DataView(buf);
  view.setUint32(80, 1, true);
  const floats = [0, 0, 1, 0, 0, 0, 10, 0, 0, 0, 10, 0];
  floats.forEach((v, i) => view.setFloat32(84 + i * 4, v, true));
  return new Blob([buf]);
}

describe('scan models', () => {
  it('knows a 3D type from a picture', () => {
    expect(isModel('model/stl')).toBe(true);
    expect(isModel('model/gltf-binary')).toBe(true);
    expect(isModel('image/png')).toBe(false);
  });

  it('offers 3D files by their extension, whatever the case', () => {
    expect(hasModelExtension('upper-arch.STL')).toBe(true);
    expect(hasModelExtension('scan.ply')).toBe(true);
    expect(hasModelExtension('scan.glb')).toBe(true);
    expect(hasModelExtension('scan.3mf')).toBe(true);
    expect(hasModelExtension('panoramic.jpg')).toBe(false);
    expect(hasModelExtension('notes.stl.txt')).toBe(false);
  });

  it('names each format for a tile', () => {
    expect(modelLabel('model/stl')).toBe('STL');
    expect(modelLabel('model/x-ply')).toBe('PLY');
    expect(modelLabel('model/obj')).toBe('OBJ');
    expect(modelLabel('model/3mf')).toBe('3MF');
    expect(modelLabel('model/gltf+json')).toBe('glTF');
  });

  it('reads a binary STL and gives it normals the scanner left empty', async () => {
    const mesh = (await loadScanModel(binaryStl(), 'model/stl')) as Mesh;
    expect(mesh.isMesh).toBe(true);
    expect(mesh.geometry.getAttribute('position').count).toBe(3);
    // The facet in the file says (0, 0, 0); the triangle lies flat, so the light must come from +Z.
    const normal = mesh.geometry.getAttribute('normal');
    expect(normal.getZ(0)).toBeCloseTo(1);
  });

  it('joins the corners of a scan so it is smoothed, below the limit', async () => {
    expect(SMOOTH_LIMIT).toBeGreaterThan(100_000);
    const mesh = (await loadScanModel(binaryStl(), 'model/stl')) as Mesh;
    expect(mesh.geometry.index).toBeTruthy();
  });

  it('reads an ASCII PLY', async () => {
    const ply = [
      'ply', 'format ascii 1.0', 'element vertex 3',
      'property float x', 'property float y', 'property float z',
      'element face 1', 'property list uchar int vertex_indices', 'end_header',
      '0 0 0', '10 0 0', '0 10 0', '3 0 1 2', '',
    ].join('\n');
    const mesh = (await loadScanModel(new Blob([ply]), 'model/x-ply')) as Mesh;
    expect(mesh.isMesh).toBe(true);
    expect(mesh.geometry.getAttribute('normal')).toBeTruthy();
  });

  it('reads an OBJ and gives it the scan material', async () => {
    const obj = 'v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n';
    const group = await loadScanModel(new Blob([obj]), 'model/obj');
    const meshes: Mesh[] = [];
    group.traverse((o) => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
    expect(meshes).toHaveLength(1);
    expect((meshes[0].material as { type: string }).type).toBe('MeshStandardMaterial');
  });
});
