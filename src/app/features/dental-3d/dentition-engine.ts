import {
  Box3,
  BackSide,
  BufferGeometry,
  ColorManagement,
  DataTexture,
  DoubleSide,
  FrontSide,
  GLSL3,
  Group,
  LinearSRGBColorSpace,
  MOUSE,
  Mesh,
  NearestFilter,
  NormalBlending,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  RawShaderMaterial,
  RGBAFormat,
  Scene,
  Spherical,
  SphereGeometry,
  Triangle,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { BufferAttribute, Intersection } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DentalChartType } from '../../core/models/patient.model';
import type { DentitionView } from '../../core/services/dental-3d-view.service';
import {
  PATTERN_ID, PAINT_ZONES, PaintZone, ToothPaint, ZONE_COLOUR, ZONE_LIMITS, rgbTriplet, zoneAt,
} from '../../core/clinical/tooth-paint';
import { FAMILY_PAINT, VOICE_FOCUS_INK, VOICE_STAGED_INK } from '../../core/clinical/tooth-status';
import { DENTITION_ASSETS } from './dentition-assets.generated';
import { DentitionLayout, ToothMetrics, fitDistance, layoutFor } from './dentition-layout';

/**
 * Draws the teeth. Framework-free, one per page, kept for the life of the app.
 *
 * How it stays light, since this sits open all day on whatever PC the clinic has:
 *
 *  - It draws when something changed and not otherwise. An idle chart costs nothing,
 *    where a render loop would keep a laptop's GPU busy behind a page being read.
 *  - One WebGL context, reused. Dossier tabs come and go; the canvas moves between
 *    them instead of recompiling shaders and re-uploading teeth on every switch,
 *    which is what stalls a Windows machine for a visible moment.
 *  - No textures. Colour and surface data are per vertex, so a whole mouth is a few
 *    megabytes of GPU memory, where the source model needed 1.5 GB.
 *  - A tooth's record is a row in a small texture, so charting one is one texel upload
 *    and no shader work. Materials are never rebuilt.
 *  - While moving on a slow machine it draws fewer pixels and sharpens when it stops.
 */

/** Height of the state texture. Permanent and primary teeth together fit well inside. */
const MAX_TEETH = 64;
/** The seven parts of a tooth, plus one texel for the tooth as a whole. */
const STATE_COLUMNS = PAINT_ZONES.length + 1;
const TOOTH_COLUMN = PAINT_ZONES.length;

const FOV = 20;
/** Pattern marks per model unit: about a millimetre apart, as on the 2D chart. Closer when one tooth fills the view. */
const PATTERN_PITCH = 34;
const PATTERN_PITCH_ZOOMED = 110;
/** How far a tooth's number stands from its crown, in model units. */
const LABEL_CLEARANCE = 0.085;
/** Pixels from the top of the stage to the number of the tooth in close-up. */
const ZOOMED_LABEL_TOP = 18;
const VIEW_MS = 520;
const CAMERA_MS = 460;

const VERTEX = /* glsl */ `
  precision highp float;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform mat3 normalMatrix;
  uniform float uPositionScale;
  in vec3 position;
  in vec3 normal;
  in vec4 color;
  in vec4 _local;
  out vec3 vViewPosition;
  out vec3 vNormal;
  out vec3 vObject;
  out vec4 vLocal;
  out vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = mv.xyz;
    vNormal = normalMatrix * normal;
    vObject = position * uPositionScale;
    vLocal = _local;
    vColor = color.rgb;
    gl_Position = projectionMatrix * mv;
  }
`;

/** zoneOf must match zoneAt in core/clinical/tooth-paint.ts. */
const FRAGMENT = /* glsl */ `
  precision highp float;
  precision highp int;
  uniform highp sampler2D uState;
  uniform int uTooth;
  uniform bool uAnterior;
  uniform bool uCrownLost;
  uniform float uAlpha;
  uniform int uHoverZone;
  uniform int uPickedZones;
  uniform float uPitch;
  in vec3 vViewPosition;
  in vec3 vNormal;
  in vec3 vObject;
  in vec4 vLocal;
  in vec3 vColor;
  out vec4 fragColor;

  int zoneOf(vec4 l) {
    if (l.z < 0.0) return 0;
    if (l.z < ${ZONE_LIMITS.cervicalBand.toFixed(3)}) return 1;
    if (uAnterior) {
      if (l.z > ${ZONE_LIMITS.incisalEdge.toFixed(3)}) return 2;
    } else if (max(abs(l.x), abs(l.y)) < ${ZONE_LIMITS.occlusalCentre.toFixed(3)} && l.z > ${ZONE_LIMITS.occlusalHeight.toFixed(3)}) {
      return 2;
    }
    if (abs(l.x) > abs(l.y)) return l.x > 0.0 ? 3 : 4;
    return l.y > 0.0 ? 5 : 6;
  }

  // A line once per unit of coord, its half-width a share of that unit, soft by one pixel.
  float lines(float coord, float halfWidth) {
    float aa = fwidth(coord);
    float d = abs(fract(coord) - 0.5);
    float line = 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, d);
    // Finer than the pixels can show: the wash alone says it, without moire.
    return mix(line, 2.0 * halfWidth, smoothstep(0.3, 0.7, aa));
  }

  float dots(vec3 p, float radius) {
    float aa = fwidth(p.x) + fwidth(p.y);
    float d = length(fract(p) - 0.5);
    float dot_ = 1.0 - smoothstep(radius - aa, radius + aa, d);
    return mix(dot_, radius, smoothstep(0.4, 0.9, aa));
  }

  // The same marks the 2D chart draws, so a pattern means one thing everywhere.
  float patternMark(int id, vec3 p) {
    vec3 q = p * uPitch;
    if (id == 2) return lines(q.x + q.y, 0.17);                                 // hatch
    if (id == 3) return lines(q.x * 0.8, 0.2);                                  // endo
    if (id == 4) return lines(q.x, 0.14) * lines(q.y * 0.6, 0.3);               // dotted
    if (id == 5) return dots(q * 1.15, 0.26);                                   // stipple
    if (id == 6) return lines(q.y, 0.2);                                        // bars
    if (id == 7) return lines(q.x - q.y, 0.24);                                 // jag
    if (id == 8) return max(lines(q.x + q.y, 0.14), lines(q.x - q.y, 0.14));    // cross
    if (id == 9) return lines((q.x + q.y) * 0.7, 0.2);                          // owed
    return 0.0;
  }

  void main() {
    int zone = zoneOf(vLocal);
    if (uCrownLost && zone != 0) discard;

    vec3 N = normalize(vNormal);
    vec3 V = normalize(-vViewPosition);
    if (!gl_FrontFacing) N = -N;
    float NV = max(dot(N, V), 0.0);
    bool enamel = vLocal.z >= 0.0;

    vec3 base = vColor;
    vec4 paint = texelFetch(uState, ivec2(zone, uTooth), 0);
    int pattern = int(paint.a * 255.0 + 0.5);
    if (pattern > 0) {
      float wash = pattern == 1 ? 0.78 : pattern == 9 ? 0.26 : 0.46;
      float mark = patternMark(pattern, vObject);
      base = mix(base, paint.rgb, wash + (0.96 - wash) * mark);
    }

    vec3 keyDir = normalize(vec3(0.32, 0.5, 0.8));
    vec3 fillDir = normalize(vec3(-0.65, -0.15, 0.55));
    float key = max(dot(N, keyDir), 0.0);
    float fill = max(dot(N, fillDir), 0.0);
    float hemi = 0.5 + 0.5 * N.y;
    float occlusion = mix(0.5, 1.0, smoothstep(0.08, 0.92, vLocal.w));

    vec3 lit = base * (0.46 + 0.14 * hemi + 0.42 * key + 0.12 * fill) * occlusion;

    vec3 H = normalize(keyDir + V);
    float gloss = pattern == 0 || pattern == 2 ? 1.0 : 0.5;
    float specular = enamel
      ? 0.34 * gloss * pow(max(dot(N, H), 0.0), 70.0) + 0.05 * pow(max(dot(N, H), 0.0), 12.0)
      : 0.05 * pow(max(dot(N, H), 0.0), 18.0);
    lit += specular * occlusion;

    // White teeth on a white page need their edge. This is the chart's outline.
    float edge = pow(1.0 - NV, 2.6);
    lit *= 1.0 - 0.34 * edge;

    if (zone == uHoverZone) lit = mix(lit, vec3(0.145, 0.46, 0.54), 0.34);
    if (((uPickedZones >> zone) & 1) == 1) lit = mix(lit, vec3(0.13, 0.37, 0.44), 0.62);

    vec4 whole = texelFetch(uState, ivec2(${TOOTH_COLUMN}, uTooth), 0);
    lit = mix(lit, whole.rgb, whole.a * pow(1.0 - NV, 1.8));

    if (uAlpha < 1.0) {
      // Not in the mouth: an outline and the chart's cross-hatch, nothing that could pass for a tooth.
      float cross_ = patternMark(8, vObject);
      float outline = smoothstep(0.35, 0.95, 1.0 - NV);
      fragColor = vec4(vec3(0.39, 0.45, 0.48), uAlpha + 0.5 * outline + 0.22 * cross_);
      return;
    }
    fragColor = vec4(lit, 1.0);
  }
`;

const OUTLINE_VERTEX = /* glsl */ `
  precision highp float;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform mat3 normalMatrix;
  uniform float uThickness;
  in vec3 position;
  in vec3 normal;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // The same width on screen however near the camera is.
    mv.xyz += normalize(normalMatrix * normal) * uThickness * -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FLAT_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  out vec4 fragColor;
  void main() { fragColor = vec4(uColor, 1.0); }
`;

const MARKER_VERTEX = /* glsl */ `
  precision highp float;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform mat3 normalMatrix;
  in vec3 position;
  in vec3 normal;
  out vec3 vNormal;
  void main() {
    vNormal = normalMatrix * normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MARKER_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  in vec3 vNormal;
  out vec4 fragColor;
  void main() {
    float light = 0.72 + 0.28 * max(dot(normalize(vNormal), normalize(vec3(0.3, 0.5, 0.8))), 0.0);
    fragColor = vec4(uColor * light, 1.0);
  }
`;

const toUnit = ([r, g, b]: readonly [number, number, number]): [number, number, number] => [r / 255, g / 255, b / 255];
const hexUnit = (hex: string): [number, number, number] => toUnit([
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
]);

const SELECT_INK = hexUnit('#215e6f');
const HOVER_INK = hexUnit('#7da9b5');
const FOCUS_INK = hexUnit(VOICE_FOCUS_INK);
const STAGED_INK = rgbBytes(VOICE_STAGED_INK);
const PLANNED_RIM = ZONE_COLOUR.planned;
const LESION_COLOUR = toUnit(rgbTriplet(FAMILY_PAINT.condition.solid));

function rgbBytes(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Pose { position: Vector3; quaternion: Quaternion }

interface ToothObject {
  readonly fdi: string;
  readonly row: number;
  readonly mesh: Mesh;
  readonly metrics: ToothMetrics;
  readonly anterior: boolean;
  from: Pose;
  to: Pose;
  now: Pose;
  /** 0 at rest, 1 fully drawn forward. Selected and spoken-of teeth come forward. */
  lift: number;
  liftTarget: number;
  absent: boolean;
  crownLost: boolean;
  lesion: Mesh | null;
}

interface DentitionSet {
  readonly teeth: ToothObject[];
  readonly byFdi: Map<string, ToothObject>;
  readonly group: Group;
  readonly positionScale: number;
}

/** The faces named around a tooth in close-up. */
export const FACES = ['mesial', 'distal', 'buccal', 'lingual', 'occlusal'] as const;
export type ToothFace = (typeof FACES)[number];

/**
 * Which way along the tooth's own x axis is toward the midline. The bake's frames are built so
 * that x runs the same way across the mouth for each arch, so it goes by quadrant.
 */
export function mesialSign(fdi: string): 1 | -1 {
  return ['1', '3', '5', '7'].includes(fdi.charAt(0)) ? -1 : 1;
}

export interface DentitionHit {
  readonly fdi: string;
  readonly zone: PaintZone;
}

/** What the page wants to hear about. Called outside Angular's change detection on purpose. */
export interface DentitionEvents {
  hover(hit: DentitionHit | null, clientX: number, clientY: number): void;
  click(hit: DentitionHit | null): void;
  doubleClick(hit: DentitionHit): void;
  /** A tooth's number belongs at this pixel of the stage. Called for every tooth after every frame. */
  place(fdi: string, x: number, y: number, facing: number): void;
  /** The same for the letter of a face of the tooth alone in the frame. */
  placeFace(face: ToothFace, x: number, y: number, facing: number): void;
  /** Whether the user has moved the view away from where the arrangement left it. */
  moved(moved: boolean): void;
  /** The graphics context died and did not come back: only the 2D chart can carry on. */
  contextGone(): void;
}

let shared: DentitionEngine | null = null;

/** The page's engine. Throws when this browser cannot draw it, and the chart falls back to 2D. */
export function dentitionEngine(): DentitionEngine {
  shared ??= new DentitionEngine();
  return shared;
}

export function webGl2Available(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export class DentitionEngine {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.05, 100);
  private readonly controls: OrbitControls;
  private readonly raycaster = new Raycaster();
  private readonly canvas: HTMLCanvasElement;
  private readonly loader: GLTFLoader;

  private readonly stateData = new Uint8Array(STATE_COLUMNS * MAX_TEETH * 4);
  private readonly stateTexture = new DataTexture(this.stateData, STATE_COLUMNS, MAX_TEETH, RGBAFormat, UnsignedByteType);
  private readonly toothUniforms = {
    uState: { value: this.stateTexture },
    uTooth: { value: 0 },
    uAnterior: { value: false },
    uCrownLost: { value: false },
    uAlpha: { value: 1 },
    uHoverZone: { value: -1 },
    uPickedZones: { value: 0 },
    uPitch: { value: PATTERN_PITCH },
    uPositionScale: { value: 1 },
  };
  private readonly ghostUniforms = { ...this.toothUniforms, uTooth: { value: 0 }, uAnterior: { value: false }, uCrownLost: { value: false }, uAlpha: { value: 0.03 }, uHoverZone: { value: -1 }, uPickedZones: { value: 0 } };
  private readonly toothMaterial: RawShaderMaterial;
  private readonly ghostMaterial: RawShaderMaterial;
  private readonly selectOutline: Mesh;
  private readonly hoverOutline: Mesh;
  private readonly focusOutline: Mesh;
  private readonly markerGeometry = new SphereGeometry(1, 14, 10);
  private readonly markerMaterial: RawShaderMaterial;

  private sets = new Map<DentalChartType, Promise<DentitionSet>>();
  private active: DentitionSet | null = null;

  private events: DentitionEvents | null = null;
  private host: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private width = 1;
  private height = 1;
  private maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  private lowPower = false;

  private frameHandle = 0;
  private lastFrameAt = 0;
  private slowFrames = 0;
  private needsRender = false;
  private restFrameDue = false;

  private view: DentitionView = 'overview';
  /** The stage is taller than wide, as on a phone: each quadrant gets a row. */
  private portrait = false;
  private layout: DentitionLayout | null = null;
  private viewProgress = 1;
  private cameraFrom: { position: Vector3; target: Vector3 } | null = null;
  private cameraTo: { position: Vector3; target: Vector3 } | null = null;
  private cameraProgress = 1;
  private userMoved = false;
  private zoomedFdi: string | null = null;
  private selectedFdi: string | null = null;
  private hoveredFdi: string | null = null;
  private focusFdi: string | null = null;
  private paints = new Map<string, ToothPaint>();

  private pointerDown: { x: number; y: number; at: number } | null = null;
  private engaged = false;
  private hoverQueued: { x: number; y: number } | null = null;
  private readonly reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    // Colours here are the design tokens' own values. No conversion on the way in or out,
    // so a tooth painted with a token is exactly that token on screen.
    ColorManagement.enabled = false;

    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, stencil: false, powerPreference: 'default' });
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.canvas.style.display = 'block';
    this.canvas.style.outline = 'none';

    this.stateTexture.magFilter = NearestFilter;
    this.stateTexture.minFilter = NearestFilter;
    this.stateTexture.generateMipmaps = false;
    this.stateTexture.needsUpdate = true;

    this.toothMaterial = new RawShaderMaterial({
      glslVersion: GLSL3, vertexShader: VERTEX, fragmentShader: FRAGMENT,
      uniforms: this.toothUniforms, side: FrontSide,
    });
    this.ghostMaterial = new RawShaderMaterial({
      glslVersion: GLSL3, vertexShader: VERTEX, fragmentShader: FRAGMENT,
      uniforms: this.ghostUniforms, side: DoubleSide, transparent: true, depthWrite: false, blending: NormalBlending,
    });

    const outline = (color: [number, number, number], thickness: number) => {
      const mesh = new Mesh(new BufferGeometry(), new RawShaderMaterial({
        glslVersion: GLSL3, vertexShader: OUTLINE_VERTEX, fragmentShader: FLAT_FRAGMENT,
        uniforms: { uColor: { value: new Vector3(...color) }, uThickness: { value: thickness } },
        side: BackSide,
      }));
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      return mesh;
    };
    this.hoverOutline = outline(HOVER_INK, 0.0024);
    this.selectOutline = outline(SELECT_INK, 0.0034);
    this.focusOutline = outline(FOCUS_INK, 0.0048);

    this.markerMaterial = new RawShaderMaterial({
      glslVersion: GLSL3, vertexShader: MARKER_VERTEX, fragmentShader: MARKER_FRAGMENT,
      uniforms: { uColor: { value: new Vector3(...LESION_COLOUR) } },
    });

    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(MeshoptDecoder);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    this.controls.addEventListener('change', () => this.invalidate());
    this.controls.addEventListener('start', () => {
      this.cameraFrom = this.cameraTo = null;
      this.cameraProgress = 1;
      this.setMoved(true);
    });
    // Vertical drags keep scrolling the page on a tablet; a chart must not trap the finger.
    this.canvas.style.touchAction = 'pan-y';

    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  /* ── Mounting ───────────────────────────────────────────────────────── */

  attach(host: HTMLElement, events: DentitionEvents): void {
    this.detach();
    this.host = host;
    this.events = events;
    host.appendChild(this.canvas);
    host.addEventListener('wheel', this.onHostWheel, { capture: true, passive: true });
    host.addEventListener('pointerleave', this.onHostLeave);
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(host);
    this.onResize();
    this.invalidate();
  }

  /** With a host given, only if that is still the one it is attached to: a new chart may already have taken over. */
  detach(from?: HTMLElement): void {
    if (from && from !== this.host) return;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.host?.removeEventListener('wheel', this.onHostWheel, { capture: true });
    this.host?.removeEventListener('pointerleave', this.onHostLeave);
    this.canvas.remove();
    this.host = null;
    this.events = null;
    this.setHovered(null);
    this.engaged = false;
  }

  /* ── The teeth ──────────────────────────────────────────────────────── */

  /** Shows one dentition, fetching it the first time it is asked for. */
  async show(dentition: DentalChartType): Promise<void> {
    const set = await this.setOf(dentition);
    if (this.active === set) return;
    if (this.active) this.scene.remove(this.active.group);
    this.active = set;
    this.scene.add(set.group);
    this.toothUniforms.uPositionScale.value = set.positionScale;
    this.ghostUniforms.uPositionScale = this.toothUniforms.uPositionScale;
    this.applyLayout(false);
    this.applyPaint();
    this.fitCamera(false);
    this.invalidate();
  }

  private setOf(dentition: DentalChartType): Promise<DentitionSet> {
    let set = this.sets.get(dentition);
    if (!set) {
      set = MeshoptDecoder.ready
        .then(() => this.loader.loadAsync(DENTITION_ASSETS[dentition]))
        .then((gltf) => this.buildSet(gltf.scene));
      set.catch(() => this.sets.delete(dentition));
      this.sets.set(dentition, set);
    }
    return set;
  }

  private buildSet(root: Group): DentitionSet {
    const group = new Group();
    const positionScale = Number(root.userData['positionScale']);
    const meshes: Mesh[] = [];
    root.traverse((node) => { if (node instanceof Mesh) meshes.push(node); });
    if (meshes.length > MAX_TEETH) throw new Error(`Too many teeth in the model: ${meshes.length}`);

    const teeth = meshes.map((mesh, row): ToothObject => {
      const extras = mesh.userData as unknown as ToothMetrics;
      mesh.removeFromParent();
      mesh.material = this.toothMaterial;
      mesh.matrixAutoUpdate = false;
      mesh.onBeforeRender = () => this.bindTooth(tooth);
      group.add(mesh);
      const pose = (): Pose => ({ position: new Vector3(), quaternion: new Quaternion() });
      const tooth: ToothObject = {
        fdi: extras.fdi,
        row,
        mesh,
        metrics: extras,
        anterior: Number(extras.fdi.charAt(1)) <= 3,
        from: pose(), to: pose(), now: pose(),
        lift: 0, liftTarget: 0,
        absent: false, crownLost: false, lesion: null,
      };
      return tooth;
    });
    return { teeth, byFdi: new Map(teeth.map((t) => [t.fdi, t])), group, positionScale };
  }

  private bindTooth(tooth: ToothObject): void {
    const material = tooth.absent ? this.ghostMaterial : this.toothMaterial;
    const u = tooth.absent ? this.ghostUniforms : this.toothUniforms;
    u.uTooth.value = tooth.row;
    u.uAnterior.value = tooth.anterior;
    u.uCrownLost.value = tooth.crownLost;
    u.uHoverZone.value = tooth.fdi === this.hoveredFdi ? this.hoveredZoneIndex : -1;
    u.uPickedZones.value = tooth.fdi === this.selectedFdi ? this.pickedZones : 0;
    material.uniformsNeedUpdate = true;
  }

  private hoveredZoneIndex = -1;
  /** Bit per part of the selected tooth: the faces the next finding will be on. */
  private pickedZones = 0;

  /** Writes every tooth's record into the state texture. One upload, nothing rebuilt. */
  setPaint(paints: readonly ToothPaint[]): void {
    this.paints = new Map(paints.map((p) => [p.fdi, p]));
    this.applyPaint();
    this.invalidate();
  }

  private applyPaint(): void {
    const set = this.active;
    if (!set) return;
    this.stateData.fill(0);
    for (const tooth of set.teeth) {
      const paint = this.paints.get(tooth.fdi);
      const rowStart = tooth.row * STATE_COLUMNS * 4;
      PAINT_ZONES.forEach((zone, column) => {
        const zonePaint = paint?.zones[zone];
        if (!zonePaint) return;
        const [r, g, b] = ZONE_COLOUR[zonePaint.family];
        const at = rowStart + column * 4;
        this.stateData[at] = r;
        this.stateData[at + 1] = g;
        this.stateData[at + 2] = b;
        this.stateData[at + 3] = PATTERN_ID[zonePaint.pattern];
      });
      // Dictated and unsaved outranks owed: it is the thing to check right now.
      const rim = paint?.staged ? { colour: STAGED_INK, strength: 200 } : paint?.planned ? { colour: PLANNED_RIM, strength: 120 } : null;
      if (rim) {
        const at = rowStart + TOOTH_COLUMN * 4;
        this.stateData[at] = rim.colour[0];
        this.stateData[at + 1] = rim.colour[1];
        this.stateData[at + 2] = rim.colour[2];
        this.stateData[at + 3] = rim.strength;
      }
      tooth.absent = !!paint?.absent;
      tooth.crownLost = !!paint?.crownLost;
      tooth.mesh.material = tooth.absent ? this.ghostMaterial : this.toothMaterial;
      this.setLesion(tooth, !!paint?.lesion && !tooth.absent, set.positionScale);
    }
    this.stateTexture.needsUpdate = true;
  }

  private setLesion(tooth: ToothObject, on: boolean, positionScale: number): void {
    if (on && !tooth.lesion) {
      const marker = new Mesh(this.markerGeometry, this.markerMaterial);
      const [x, y, z] = tooth.metrics.apex;
      marker.position.set(x / positionScale, (y - 0.012) / positionScale, z / positionScale);
      marker.scale.setScalar(0.042 / positionScale);
      tooth.mesh.add(marker);
      tooth.lesion = marker;
    } else if (!on && tooth.lesion) {
      tooth.lesion.removeFromParent();
      tooth.lesion = null;
    }
  }

  /* ── What is being looked at ────────────────────────────────────────── */

  setView(view: DentitionView, animate = true): void {
    if (this.view === view && this.layout) return;
    this.view = view;
    this.applyLayout(animate);
    if (!this.zoomedFdi) this.fitCamera(animate);
    this.invalidate();
  }

  setSelected(fdi: string | null): void {
    this.selectedFdi = fdi;
    this.applyOutlines();
    this.invalidate();
  }

  setPicked(zones: readonly PaintZone[]): void {
    this.pickedZones = zones.reduce((bits, zone) => bits | (1 << PAINT_ZONES.indexOf(zone)), 0);
    this.invalidate();
  }

  /** A tooth pointed at through its number rather than on the canvas. */
  hoverTooth(fdi: string | null): void {
    this.setHovered(fdi);
  }

  /** The tooth the last voice command was about. */
  setFocus(fdi: string | null): void {
    this.focusFdi = fdi;
    this.applyOutlines();
    this.invalidate();
  }

  /** Closes in on one tooth, alone in the frame so every side can be seen, or returns to the mouth. */
  zoomTo(fdi: string | null): void {
    const set = this.active;
    this.zoomedFdi = fdi && set?.byFdi.has(fdi) ? fdi : null;
    if (set) for (const tooth of set.teeth) tooth.mesh.visible = !this.zoomedFdi || tooth.fdi === this.zoomedFdi;
    this.toothUniforms.uPitch.value = this.zoomedFdi ? PATTERN_PITCH_ZOOMED : PATTERN_PITCH;
    this.applyOrbitLimits();
    this.applyOutlines();
    this.fitCamera(true);
    this.invalidate();
  }

  resetCamera(): void {
    this.zoomTo(null);
  }

  /**
   * Multiplies the distance to what is framed: below 1 closes in. Held to the
   * camera's limits, and says when it reached one — "zoom avant" at the closest
   * answers "zoom maximum" instead of pretending to move.
   */
  zoomBy(factor: number): 'near' | 'far' | null {
    const direction = this.camera.position.clone().sub(this.controls.target);
    const current = direction.length();
    const min = this.controls.minDistance;
    const max = this.controls.maxDistance;
    const length = Math.min(max, Math.max(min, current * factor));
    const limit = length <= min * 1.0001 ? 'near' : length >= max * 0.9999 ? 'far' : null;
    if (Math.abs(length - current) < current * 1e-4) return limit ?? (factor < 1 ? 'near' : 'far');
    const position = this.controls.target.clone().add(direction.setLength(length));
    this.startCamera(position, this.controls.target.clone(), true);
    this.setMoved(true);
    this.invalidate();
    return limit;
  }

  /** Brings a tooth to the middle of the frame, at the same distance, its neighbours still in view. */
  frameTooth(fdi: string): void {
    const tooth = this.active?.byFdi.get(fdi);
    if (!tooth) return;
    const centre = new Box3().setFromObject(tooth.mesh).getCenter(new Vector3());
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.startCamera(centre.clone().add(offset), centre, true);
    this.setMoved(true);
    this.invalidate();
  }

  /** Whether a tooth is inside the frame, with a margin. */
  isToothInView(fdi: string): boolean {
    const tooth = this.active?.byFdi.get(fdi);
    if (!tooth || !tooth.mesh.visible) return false;
    const point = new Box3().setFromObject(tooth.mesh).getCenter(new Vector3()).project(this.camera);
    return Math.abs(point.x) <= 0.9 && Math.abs(point.y) <= 0.9 && point.z < 1;
  }

  /** Turns the view around what is framed, in radians: what dragging does, for a keyboard or a button. */
  rotateBy(azimuth: number, polar: number): void {
    const target = this.controls.target;
    const orbit = new Spherical().setFromVector3(this.camera.position.clone().sub(target));
    orbit.theta = Math.min(this.controls.maxAzimuthAngle, Math.max(this.controls.minAzimuthAngle, orbit.theta + azimuth));
    orbit.phi = Math.min(this.controls.maxPolarAngle, Math.max(this.controls.minPolarAngle, orbit.phi + polar));
    this.startCamera(target.clone().add(new Vector3().setFromSpherical(orbit)), target.clone(), true);
    this.setMoved(true);
    this.invalidate();
  }

  private applyOutlines(): void {
    const place = (outline: Mesh, fdi: string | null) => {
      const tooth = fdi ? this.active?.byFdi.get(fdi) : undefined;
      outline.visible = !!tooth && tooth.mesh.visible;
      if (tooth) outline.geometry = tooth.mesh.geometry;
    };
    place(this.focusOutline, this.focusFdi);
    place(this.selectOutline, this.focusFdi === this.selectedFdi ? null : this.selectedFdi);
    place(this.hoverOutline, this.hoveredFdi === this.selectedFdi || this.hoveredFdi === this.focusFdi ? null : this.hoveredFdi);
    const set = this.active;
    if (set) {
      const rows = this.view !== 'arch' && !this.zoomedFdi;
      for (const tooth of set.teeth) {
        tooth.liftTarget = rows && (tooth.fdi === this.focusFdi || tooth.fdi === this.selectedFdi) ? 1 : 0;
      }
    }
  }

  private applyLayout(animate: boolean): void {
    const set = this.active;
    if (!set) return;
    this.layout = layoutFor(this.view, set.teeth.map((t) => t.metrics), this.portrait);
    for (const tooth of set.teeth) {
      const pose = this.layout.poses.get(tooth.fdi)!;
      tooth.from = { position: tooth.now.position.clone(), quaternion: tooth.now.quaternion.clone() };
      tooth.to = { position: pose.position.clone(), quaternion: pose.quaternion.clone() };
    }
    if (animate && !this.reducedMotion) {
      this.viewProgress = 0;
    } else {
      this.viewProgress = 1;
      this.composeTeeth(1);
    }
    this.applyOrbitLimits();
  }

  /** The rows only make sense from the front; one tooth alone can be turned all the way round. */
  private applyOrbitLimits(): void {
    if (!this.layout) return;
    const free = this.zoomedFdi || this.layout.orbit.azimuth === Infinity;
    const { orbit } = this.layout;
    this.controls.minAzimuthAngle = free ? -Infinity : -orbit.azimuth;
    this.controls.maxAzimuthAngle = free ? Infinity : orbit.azimuth;
    this.controls.minPolarAngle = this.zoomedFdi ? 0.05 : orbit.polarMin;
    this.controls.maxPolarAngle = this.zoomedFdi ? Math.PI - 0.05 : orbit.polarMax;
  }

  private composeTeeth(progress: number): void {
    const set = this.active;
    if (!set) return;
    const eased = ease(progress);
    for (const tooth of set.teeth) {
      tooth.now.position.lerpVectors(tooth.from.position, tooth.to.position, eased);
      tooth.now.quaternion.slerpQuaternions(tooth.from.quaternion, tooth.to.quaternion, eased);
      this.composeTooth(tooth, set.positionScale);
    }
    this.syncOutlines();
  }

  private readonly scratchPosition = new Vector3();
  private readonly scratchScale = new Vector3();

  private composeTooth(tooth: ToothObject, positionScale: number): void {
    this.scratchPosition.copy(tooth.now.position);
    this.scratchPosition.z += tooth.lift * 0.22;
    this.scratchScale.setScalar(positionScale * (1 + tooth.lift * 0.09));
    tooth.mesh.matrix.compose(this.scratchPosition, tooth.now.quaternion, this.scratchScale);
    tooth.mesh.matrixWorldNeedsUpdate = true;
  }

  private syncOutlines(): void {
    for (const [outline, fdi] of [
      [this.focusOutline, this.focusFdi],
      [this.selectOutline, this.selectedFdi],
      [this.hoverOutline, this.hoveredFdi],
    ] as const) {
      const tooth = fdi ? this.active?.byFdi.get(fdi) : undefined;
      if (tooth && outline.visible) {
        outline.matrix.copy(tooth.mesh.matrix);
        outline.matrixWorldNeedsUpdate = true;
      }
    }
  }

  private fitCamera(animate: boolean): void {
    const set = this.active;
    const layout = this.layout;
    if (!set || !layout) return;
    const tooth = this.zoomedFdi ? set.byFdi.get(this.zoomedFdi) : undefined;
    const aspect = this.width / Math.max(this.height, 1);
    let target: Vector3;
    let distance: number;
    let direction: Vector3;
    if (tooth) {
      const pose = tooth.to;
      const middle = (tooth.metrics.top + tooth.metrics.bottom) / 2;
      target = new Vector3(0, middle, 0).applyQuaternion(pose.quaternion).add(pose.position);
      const half = (tooth.metrics.top - tooth.metrics.bottom) / 2;
      distance = fitDistance(half * 1.05, half * 1.2, FOV, aspect);
      // From the tooth's cheek side and a little toward the biting surface, whichever arch it is on.
      direction = new Vector3(0, 0.45, 1).normalize().applyQuaternion(pose.quaternion);
    } else {
      target = new Vector3();
      distance = fitDistance(layout.halfWidth, layout.halfHeight, FOV, aspect);
      direction = layout.cameraDirection.clone();
    }
    // Before the camera moves: with no animation it gets there at once, and the old limits would hold it back.
    this.controls.maxDistance = distance * 2.2;
    this.controls.minDistance = distance * 0.12;
    this.startCamera(target.clone().add(direction.multiplyScalar(distance)), target, animate);
    this.setMoved(!!tooth);
  }

  private startCamera(position: Vector3, target: Vector3, animate: boolean): void {
    if (animate && !this.reducedMotion) {
      this.cameraFrom = { position: this.camera.position.clone(), target: this.controls.target.clone() };
      this.cameraTo = { position, target };
      this.cameraProgress = 0;
    } else {
      this.cameraFrom = this.cameraTo = null;
      this.cameraProgress = 1;
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.camera.lookAt(target);
      this.controls.update();
    }
  }

  private setMoved(moved: boolean): void {
    if (this.userMoved === moved) return;
    this.userMoved = moved;
    this.events?.moved(moved);
  }

  /* ── Frames ─────────────────────────────────────────────────────────── */

  /** Asks for a frame. Everything that changes what is on screen comes through here. */
  private invalidate(): void {
    this.needsRender = true;
    if (!this.frameHandle && this.host) this.frameHandle = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.frameHandle = 0;
    if (!this.host) return;
    const dt = this.lastFrameAt ? Math.min(now - this.lastFrameAt, 100) : 16;
    const wasContinuous = now - this.lastFrameAt < 120;
    this.lastFrameAt = now;

    let moving = false;
    if (this.viewProgress < 1) {
      this.viewProgress = Math.min(1, this.viewProgress + dt / VIEW_MS);
      this.composeTeeth(this.viewProgress);
      moving = true;
    }
    if (this.cameraFrom && this.cameraTo) {
      this.cameraProgress = Math.min(1, this.cameraProgress + dt / CAMERA_MS);
      const t = ease(this.cameraProgress);
      this.camera.position.lerpVectors(this.cameraFrom.position, this.cameraTo.position, t);
      this.controls.target.lerpVectors(this.cameraFrom.target, this.cameraTo.target, t);
      if (this.cameraProgress >= 1) this.cameraFrom = this.cameraTo = null;
      moving = true;
    }
    const set = this.active;
    if (set) {
      for (const tooth of set.teeth) {
        const gap = tooth.liftTarget - tooth.lift;
        if (Math.abs(gap) < 0.002) {
          if (gap !== 0) { tooth.lift = tooth.liftTarget; this.composeTooth(tooth, set.positionScale); }
          continue;
        }
        tooth.lift = this.reducedMotion ? tooth.liftTarget : tooth.lift + gap * (1 - Math.exp(-dt / 70));
        this.composeTooth(tooth, set.positionScale);
        moving = true;
      }
      this.syncOutlines();
    }
    if (this.controls.update()) moving = true;

    this.adaptResolution(moving, wasContinuous, dt);

    if (this.hoverQueued) {
      const { x, y } = this.hoverQueued;
      this.hoverQueued = null;
      this.updateHover(x, y);
    }

    if (this.needsRender || moving) {
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
      this.placeLabels();
    }

    if (moving || this.needsRender) {
      // The controls may already have asked for the next frame; two would stack up and multiply.
      if (!this.frameHandle) this.frameHandle = requestAnimationFrame(this.frame);
    } else if (this.restFrameDue) {
      this.restFrameDue = false;
      this.lowPower = false;
      this.renderer.setPixelRatio(this.maxPixelRatio);
      this.renderer.setSize(this.width, this.height, true);
      // Drawn in this same task: a resized canvas is blank until the next draw.
      this.renderer.render(this.scene, this.camera);
    }
  };

  /** Slow while moving: fewer pixels now, full sharpness once it stops. */
  private adaptResolution(moving: boolean, continuous: boolean, dt: number): void {
    if (!moving || !continuous) return;
    this.slowFrames = dt > 40 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
    if (this.slowFrames >= 8 && !this.lowPower) {
      this.lowPower = true;
      this.restFrameDue = true;
      this.renderer.setPixelRatio(Math.max(1, this.maxPixelRatio * 0.6));
      this.renderer.setSize(this.width, this.height, true);
    }
  }

  private readonly anchor = new Vector3();
  private readonly outward = new Vector3();
  private readonly toCamera = new Vector3();

  private placeLabels(): void {
    const set = this.active;
    const events = this.events;
    if (!set || !events) return;
    this.camera.updateMatrixWorld();
    const rows = this.view !== 'arch';
    for (const tooth of set.teeth) {
      if (tooth.fdi === this.zoomedFdi) {
        // Alone in the frame, its number keeps one place above it: the keyboard's focus is on it.
        events.place(tooth.fdi, this.width / 2, ZOOMED_LABEL_TOP, 1);
        continue;
      }
      if (!tooth.mesh.visible || this.zoomedFdi) {
        events.place(tooth.fdi, -9999, -9999, 0);
        continue;
      }
      if (rows) {
        // In one straight row in the band between the arches, clear of the longest crown.
        const upper = tooth.now.position.y > 0;
        const reach = this.layout!.labelReach[upper ? 'upper' : 'lower'] + LABEL_CLEARANCE;
        this.anchor.set(tooth.now.position.x, tooth.now.position.y + (upper ? -reach : reach), 0);
      } else {
        this.anchor.set(0, tooth.metrics.crownHeight * 0.45, tooth.metrics.halfDepth * 1.75)
          .applyQuaternion(tooth.now.quaternion).add(tooth.now.position);
      }
      this.anchor.z += tooth.lift * 0.22;
      this.toCamera.copy(this.camera.position).sub(this.anchor).normalize();
      this.outward.set(0, 0, 1).applyQuaternion(tooth.now.quaternion);
      const facing = rows ? 1 : this.outward.dot(this.toCamera);
      this.anchor.project(this.camera);
      events.place(tooth.fdi, (this.anchor.x + 1) * 0.5 * this.width, (1 - this.anchor.y) * 0.5 * this.height, facing);
    }
    this.placeFaceLetters();
  }

  /** Beside the tooth alone in the frame, which face is which, wherever it has been turned. */
  private placeFaceLetters(): void {
    const tooth = this.zoomedFdi ? this.active?.byFdi.get(this.zoomedFdi) : undefined;
    const events = this.events;
    if (!events) return;
    for (const face of FACES) {
      if (!tooth) {
        events.placeFace(face, -9999, -9999, 0);
        continue;
      }
      const m = tooth.metrics;
      const crown = m.crownHeight * 0.55;
      const sign = mesialSign(tooth.fdi);
      switch (face) {
        case 'mesial': this.anchor.set(sign * m.halfWidth * 1.45, crown, 0); break;
        case 'distal': this.anchor.set(-sign * m.halfWidth * 1.45, crown, 0); break;
        case 'buccal': this.anchor.set(0, crown, m.halfDepth * 1.45); break;
        case 'lingual': this.anchor.set(0, crown, -m.halfDepth * 1.45); break;
        case 'occlusal': this.anchor.set(0, m.top * 1.18, 0); break;
      }
      this.anchor.applyQuaternion(tooth.now.quaternion).add(tooth.now.position);
      this.anchor.z += tooth.lift * 0.22;
      this.toCamera.copy(this.camera.position).sub(this.anchor).normalize();
      this.outward.copy(this.anchor).sub(tooth.now.position).normalize();
      const facing = this.outward.dot(this.toCamera);
      this.anchor.project(this.camera);
      events.placeFace(face, (this.anchor.x + 1) * 0.5 * this.width, (1 - this.anchor.y) * 0.5 * this.height, facing);
    }
  }

  private onResize(): void {
    if (!this.host) return;
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height) return;
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.lowPower ? Math.max(1, this.maxPixelRatio * 0.6) : this.maxPixelRatio);
    this.renderer.setSize(width, height, true);
    const portrait = height > width;
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this.applyLayout(false);
      this.applyOutlines();
    }
    if (!this.userMoved) this.fitCamera(false);
    // Drawn in this same task: a resized canvas is blank until the next draw.
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  }

  /* ── Pointing ───────────────────────────────────────────────────────── */

  private readonly ndc = new Vector2();
  private readonly hits: Intersection[] = [];
  private readonly triangle = new Triangle();
  private readonly localPoint = new Vector3();
  private readonly bary = new Vector3();

  private pick(clientX: number, clientY: number): DentitionHit | null {
    const set = this.active;
    if (!set) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.hits.length = 0;
    set.group.updateMatrixWorld();
    for (const tooth of set.teeth) {
      if (tooth.mesh.visible) tooth.mesh.raycast(this.raycaster, this.hits);
    }
    if (!this.hits.length) return null;
    this.hits.sort((a, b) => a.distance - b.distance);
    // Through the part of a tooth whose crown is gone, to whatever is behind it.
    for (const hit of this.hits) {
      const tooth = set.teeth.find((t) => t.mesh === hit.object)!;
      const zone = this.zoneOfHit(tooth, hit);
      if (tooth.crownLost && zone !== 'root') continue;
      return { fdi: tooth.fdi, zone };
    }
    return null;
  }

  private zoneOfHit(tooth: ToothObject, hit: Intersection): PaintZone {
    const face = hit.face!;
    const geometry = tooth.mesh.geometry as BufferGeometry;
    const position = geometry.getAttribute('position') as BufferAttribute;
    const local = geometry.getAttribute('_local') as BufferAttribute;
    this.localPoint.copy(hit.point);
    tooth.mesh.worldToLocal(this.localPoint);
    this.triangle.setFromAttributeAndIndices(position, face.a, face.b, face.c);
    this.triangle.getBarycoord(this.localPoint, this.bary);
    const at = (get: (i: number) => number) => get(face.a) * this.bary.x + get(face.b) * this.bary.y + get(face.c) * this.bary.z;
    return zoneAt(at((i) => local.getX(i)), at((i) => local.getY(i)), at((i) => local.getZ(i)), tooth.anterior);
  }

  private setHovered(fdi: string | null, zone: PaintZone | null = null): void {
    const zoneIndex = zone ? PAINT_ZONES.indexOf(zone) : -1;
    if (fdi === this.hoveredFdi && zoneIndex === this.hoveredZoneIndex) return;
    this.hoveredFdi = fdi;
    this.hoveredZoneIndex = fdi && (fdi === this.selectedFdi || fdi === this.zoomedFdi) ? zoneIndex : -1;
    this.applyOutlines();
    this.syncOutlines();
    this.invalidate();
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.buttons !== 0) return;
    // One pick per frame at most, however fast the pointer reports.
    this.hoverQueued = { x: event.clientX, y: event.clientY };
    if (!this.frameHandle) this.frameHandle = requestAnimationFrame(this.frame);
  };

  private updateHover(x: number, y: number): void {
    const hit = this.pick(x, y);
    this.setHovered(hit?.fdi ?? null, hit?.zone ?? null);
    this.canvas.style.cursor = hit ? 'pointer' : 'grab';
    this.events?.hover(hit, x, y);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY, at: performance.now() };
    this.engaged = true;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || event.button !== 0) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (moved > 5) return;
    this.events?.click(this.pick(event.clientX, event.clientY));
  };

  private readonly onPointerLeave = (): void => {
    this.hoverQueued = null;
    this.setHovered(null);
    this.events?.hover(null, 0, 0);
  };

  private readonly onDoubleClick = (event: MouseEvent): void => {
    const hit = this.pick(event.clientX, event.clientY);
    if (hit) this.events?.doubleClick(hit);
  };

  /**
   * A chart in the middle of a page must not swallow the page's scrolling. The wheel
   * zooms once the doctor has pressed on the chart, or with Ctrl (which is also what a
   * trackpad pinch sends); otherwise it never reaches the controls and the page scrolls.
   */
  private readonly onHostWheel = (event: WheelEvent): void => {
    if (!this.engaged && !event.ctrlKey && !event.metaKey) event.stopPropagation();
  };

  private readonly onHostLeave = (): void => {
    this.engaged = false;
  };

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    window.setTimeout(() => {
      if (this.renderer.getContext().isContextLost()) this.events?.contextGone();
    }, 3000);
  };

  private readonly onContextRestored = (): void => {
    this.stateTexture.needsUpdate = true;
    this.invalidate();
  };

  /** The view as a plain picture, for printing: a WebGL canvas prints blank. */
  capture(): HTMLCanvasElement {
    this.renderer.render(this.scene, this.camera);
    const picture = document.createElement('canvas');
    picture.width = this.canvas.width;
    picture.height = this.canvas.height;
    // In the same task as the draw, while the drawing buffer still holds it.
    picture.getContext('2d')?.drawImage(this.canvas, 0, 0);
    return picture;
  }
}
