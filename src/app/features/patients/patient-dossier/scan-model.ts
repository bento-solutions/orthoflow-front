import type { BufferGeometry, Object3D } from 'three';
import { toothGumColors } from './scan-shading';

/** The 3D formats an intraoral scan may come in, by the type the server decided from the bytes. */
export const MODEL_TYPES = ['model/stl', 'model/x-ply', 'model/obj', 'model/3mf', 'model/gltf-binary', 'model/gltf+json'] as const;
export type ModelType = (typeof MODEL_TYPES)[number];

/** What the file picker offers for a 3D Intraoral upload, besides pictures. */
export const MODEL_EXTENSIONS = ['.stl', '.ply', '.obj', '.3mf', '.glb', '.gltf'] as const;

export function isModel(contentType: string): contentType is ModelType {
  return (MODEL_TYPES as readonly string[]).includes(contentType);
}

export function hasModelExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return MODEL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** A short name for the format, for a tile or a caption: STL, PLY, OBJ, 3MF, glTF. */
export function modelLabel(contentType: string): string {
  switch (contentType) {
    case 'model/stl': return 'STL';
    case 'model/x-ply': return 'PLY';
    case 'model/obj': return 'OBJ';
    case 'model/3mf': return '3MF';
    default: return 'glTF';
  }
}

/**
 * Reads a scan into something three.js can draw. The loaders are imported here, on first use,
 * so the patient file does not carry them until a scan is opened.
 */
export async function loadScanModel(blob: Blob, type: ModelType): Promise<Object3D> {
  const THREE = await import('three');
  const scanMaterial = (vertexColors: boolean) =>
    new THREE.MeshStandardMaterial({
      // Enamel-and-stone when the scan carries no colour of its own.
      color: vertexColors ? 0xffffff : 0xece5da,
      vertexColors,
      roughness: 0.55,
      metalness: 0,
      side: THREE.DoubleSide,
    });
  const { mergeVertices } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
  const meshOf = (geometry: BufferGeometry) => {
    const shaded = shade(geometry, mergeVertices);
    return new THREE.Mesh(shaded, scanMaterial(!!shaded.getAttribute('color')));
  };

  switch (type) {
    case 'model/stl': {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
      const geometry = shade(new STLLoader().parse(await blob.arrayBuffer()), mergeVertices);
      // STL holds no colour (bar a rare per-facet extension the loader reads itself): tint the
      // crowns and gums from the shape so the arch reads as teeth and gingiva, not a white cast.
      if (!geometry.getAttribute('color')) {
        const position = geometry.getAttribute('position');
        const colors = toothGumColors(position.array, geometry.index ? geometry.index.array : null);
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
      return new THREE.Mesh(geometry, scanMaterial(true));
    }
    case 'model/x-ply': {
      const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
      return meshOf(new PLYLoader().parse(await blob.arrayBuffer()));
    }
    case 'model/obj': {
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
      const group = new OBJLoader().parse(await blob.text());
      // Without its .mtl an OBJ comes back flat grey; the scan material reads better.
      group.traverse((o) => {
        const mesh = o as InstanceType<typeof THREE.Mesh>;
        if (mesh.isMesh) {
          mesh.geometry = shade(mesh.geometry, mergeVertices);
          mesh.material = scanMaterial(!!mesh.geometry.getAttribute('color'));
        }
      });
      return group;
    }
    case 'model/3mf': {
      const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
      return new ThreeMFLoader().parse(await blob.arrayBuffer());
    }
    case 'model/gltf-binary':
    case 'model/gltf+json': {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const data = type === 'model/gltf-binary' ? await blob.arrayBuffer() : await blob.text();
      const gltf = await new GLTFLoader().parseAsync(data, '');
      return gltf.scene;
    }
  }
}

/**
 * Up to this many triangles a scan is smoothed: its corners are joined so the light runs over it
 * like enamel. Joining takes about two seconds a million triangles, so a bigger scan keeps its
 * facets, which are too small to see at that size anyway.
 */
export const SMOOTH_LIMIT = 400_000;

/**
 * Makes sure the light has something to fall on. Many scanners write empty facet normals into
 * their STL, and a scan drawn with them comes out black.
 */
export function shade(geometry: BufferGeometry, mergeVertices: (g: BufferGeometry) => BufferGeometry): BufferGeometry {
  const corners = geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
  if (!geometry.index && corners / 3 <= SMOOTH_LIMIT) {
    geometry.deleteAttribute('normal');
    const merged = mergeVertices(geometry);
    merged.computeVertexNormals();
    if (merged !== geometry) geometry.dispose();
    return merged;
  }
  if (!hasNormals(geometry)) geometry.computeVertexNormals();
  return geometry;
}

/** True when the geometry carries normals that point somewhere, judged on a spread of samples. */
function hasNormals(geometry: BufferGeometry): boolean {
  const normals = geometry.getAttribute('normal');
  if (!normals) return false;
  const step = Math.max(1, Math.floor(normals.count / 1000));
  for (let i = 0; i < normals.count; i += step) {
    if (normals.getX(i) !== 0 || normals.getY(i) !== 0 || normals.getZ(i) !== 0) return true;
  }
  return false;
}
