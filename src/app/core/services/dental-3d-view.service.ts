import { Injectable, signal } from '@angular/core';

/**
 * The chart's arrangements of the teeth. See features/dental-3d/dentition-layout.ts.
 *
 *  - overview:   the mouth. The natural arches, parted like an open mouth, with the gums and the
 *                palate, the state of the gums and the tartar. The one the chart opens on.
 *  - panoramic:  the arches unrolled like a panoramic radiograph, every crown and root in sight.
 *                It was the overview until Nov 2026.
 *  - occlusal / lingual: the biting surfaces / the tongue and palate sides.
 *  - arch:       the same natural arches, teeth only.
 */
export const DENTITION_VIEWS = ['overview', 'panoramic', 'occlusal', 'lingual', 'arch'] as const;
export type DentitionView = (typeof DENTITION_VIEWS)[number];

/** Whether a view keeps the teeth on their natural arches (so labels stand round them, and nothing comes forward). */
export function isArchView(view: DentitionView): boolean {
  return view === 'overview' || view === 'arch';
}

/** What a voice command asks the camera to do; each is applied once, by the chart on screen. */
export type CameraMove =
  | { kind: 'zoom'; factor: number }
  | { kind: 'rotate'; azimuth: number; polar: number }
  | { kind: 'reset' }
  | { kind: 'frame'; fdi: string };
export type CameraRequest = CameraMove & { id: number };

/** One step of "zoom avant": the same as a press of the toolbar's + button. */
export const ZOOM_IN_FACTOR = 0.8;
export const ZOOM_OUT_FACTOR = 1.25;
/** One step of "tourne à gauche": the same as the toolbar's turn buttons. */
export const TURN_STEP = Math.PI / 12;

/**
 * How the 3D chart is being looked at, apart from the chart itself, so a voice
 * command can change it without loading three.js and it survives switching
 * dossier tabs. The doctor's hands are in the patient's mouth: anything the mouse
 * can do to this view has to be sayable — zooming, turning, a tooth alone.
 *
 * Camera moves are requests with an id. The chart on screen applies each once
 * and marks it consumed; a request made while no chart is mounted is applied
 * when one mounts (the cockpit shows the chart first, then asks).
 */
@Injectable({ providedIn: 'root' })
export class Dental3dViewService {
  readonly view = signal<DentitionView>('overview');
  /**
   * Whether the mouth view draws the gums and the palate. Off, it is the arches with the teeth only
   * ("cache les gencives"): the roots, the bone-side of things, are then in plain sight.
   */
  readonly gums = signal(true);
  /** The tooth the view has closed in on, or null for the whole mouth. */
  readonly zoomedFdi = signal<string | null>(null);
  /** Whether a chart is on screen to obey. */
  readonly mounted = signal(0);
  /** The latest camera move asked for. */
  readonly camera = signal<CameraRequest | null>(null);
  /** Where the camera stands against its limits after the last move, so "zoom avant" can answer "zoom maximum". */
  readonly atLimit = signal<'near' | 'far' | null>(null);

  private nextId = 1;
  private consumedId = 0;

  reset(): void {
    this.view.set('overview');
    this.zoomedFdi.set(null);
  }

  /** Shows or hides the gums and the palate of the mouth view; with no argument, the other of the two. */
  showGums(show = !this.gums()): void {
    this.gums.set(show);
  }

  zoom(direction: 'in' | 'out', steps = 1): void {
    const one = direction === 'in' ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
    this.request({ kind: 'zoom', factor: one ** Math.max(1, Math.min(5, steps)) });
  }

  rotate(direction: 'left' | 'right' | 'up' | 'down' | 'flip'): void {
    const moves: Record<typeof direction, [number, number]> = {
      left: [-TURN_STEP * 2, 0], right: [TURN_STEP * 2, 0], up: [0, -TURN_STEP * 2], down: [0, TURN_STEP * 2], flip: [Math.PI, 0],
    };
    const [azimuth, polar] = moves[direction];
    this.request({ kind: 'rotate', azimuth, polar });
  }

  resetCamera(): void {
    this.request({ kind: 'reset' });
  }

  /** Brings a tooth back into the frame, its neighbours with it. */
  frame(fdi: string): void {
    this.request({ kind: 'frame', fdi });
  }

  /** The request still to apply, or null; the chart calls {@link consumed} once it has. */
  pending(): CameraRequest | null {
    const request = this.camera();
    return request && request.id > this.consumedId ? request : null;
  }

  consumed(id: number): void {
    this.consumedId = Math.max(this.consumedId, id);
  }

  private request(move: CameraMove): void {
    this.camera.set({ ...move, id: this.nextId++ } as CameraRequest);
  }
}
