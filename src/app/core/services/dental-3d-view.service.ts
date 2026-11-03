import { Injectable, signal } from '@angular/core';

/** The chart's arrangements of the teeth. See features/dental-3d/dentition-layout.ts. */
export const DENTITION_VIEWS = ['overview', 'occlusal', 'lingual', 'arch'] as const;
export type DentitionView = (typeof DENTITION_VIEWS)[number];

/**
 * How the 3D chart is being looked at, apart from the chart itself, so a voice
 * command can change it without loading three.js and it survives switching
 * dossier tabs. The doctor's hands are in the patient's mouth: anything the mouse
 * can do to this view has to be sayable.
 */
@Injectable({ providedIn: 'root' })
export class Dental3dViewService {
  readonly view = signal<DentitionView>('overview');
  /** The tooth the view has closed in on, or null for the whole mouth. */
  readonly zoomedFdi = signal<string | null>(null);
  /** Whether a chart is on screen to obey. Told aloud when none is, rather than silently doing nothing. */
  readonly mounted = signal(0);

  reset(): void {
    this.view.set('overview');
    this.zoomedFdi.set(null);
  }
}
