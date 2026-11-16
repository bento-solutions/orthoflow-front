import { Component, DestroyRef, ElementRef, NgZone, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import type { Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ModelType, loadScanModel, modelLabel } from './scan-model';

/** Where the camera starts: above the arch, looking down on the biting surfaces. */
type View = 'occlusal' | 'front';

/**
 * An intraoral scan in 3D: drag to turn it, scroll or pinch to zoom, right-drag to move it.
 * It draws only when something changes, so a scan left open costs nothing.
 */
@Component({
  selector: 'app-scan-viewer',
  standalone: true,
  imports: [TranslateModule],
  host: { class: 'scan-viewer', '[class.expanded]': 'expanded()' },
  template: `
    <div #host class="stage" [attr.aria-label]="'PFILES.VIEWER_LABEL' | translate: { format: label() }" role="img"></div>
    @switch (state()) {
      @case ('loading') { <div class="overlay" role="status">{{ 'PFILES.MODEL_LOADING' | translate }}</div> }
      @case ('failed') { <div class="overlay" role="alert">{{ 'PFILES.MODEL_FAILED' | translate }}</div> }
      @case ('no-webgl') { <div class="overlay" role="alert">{{ 'PFILES.NO_WEBGL' | translate }}</div> }
    }
    <div class="tools">
      <button type="button" class="view" [attr.aria-pressed]="view() === 'occlusal'" (click)="setView('occlusal')">{{ 'PFILES.VIEW_OCCLUSAL' | translate }}</button>
      <button type="button" class="view" [attr.aria-pressed]="view() === 'front'" (click)="setView('front')">{{ 'PFILES.VIEW_FRONT' | translate }}</button>
      <button type="button" (click)="expanded.set(!expanded())"
        [title]="(expanded() ? 'PFILES.SHRINK' : 'PFILES.EXPAND') | translate" [attr.aria-label]="(expanded() ? 'PFILES.SHRINK' : 'PFILES.EXPAND') | translate">
        <span class="material-icons" aria-hidden="true">{{ expanded() ? 'close_fullscreen' : 'open_in_full' }}</span>
      </button>
    </div>
    <p class="hint">{{ label() }} · {{ 'PFILES.MODEL_HINT' | translate }}</p>
  `,
  styles: [`
    :host { position: relative; display: block; width: 100%; height: 100%; min-height: 14rem; overflow: hidden; border-radius: .75rem;
      background: radial-gradient(ellipse at center, #26343a 0%, #10181b 100%); }
    :host(.expanded) { position: fixed; inset: 0; z-index: var(--z-modal, 60); border-radius: 0; min-height: 0; }
    .stage { position: absolute; inset: 0; cursor: grab; touch-action: none; }
    .stage:active { cursor: grabbing; }
    .overlay { position: absolute; inset: 0; display: grid; place-items: center; padding: 1rem; text-align: center; color: #d6dfe1; font-size: .875rem; }
    .tools { position: absolute; top: .5rem; inset-inline-end: .5rem; display: flex; gap: .25rem; }
    .tools button { display: inline-flex; align-items: center; justify-content: center; width: 2.25rem; height: 2.25rem; border: 1px solid rgb(255 255 255 / .18);
      border-radius: .5rem; background: rgb(16 24 27 / .7); color: #e8eef0; cursor: pointer; }
    .tools button:hover { background: rgb(16 24 27 / .9); }
    .tools button.view { width: auto; padding: 0 .625rem; font-size: .75rem; font-weight: 600; }
    .tools button[aria-pressed='true'] { background: rgb(255 255 255 / .92); color: #10181b; border-color: transparent; }
    .tools button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
    .tools .material-icons { font-size: 1.125rem; }
    .hint { position: absolute; bottom: .375rem; inset-inline-start: .5rem; margin: 0; padding: .125rem .375rem; border-radius: .25rem;
      background: rgb(16 24 27 / .6); color: #c9d4d7; font-size: .6875rem; pointer-events: none; }
  `],
})
export class ScanViewerComponent {
  readonly blob = input.required<Blob>();
  readonly type = input.required<ModelType>();

  protected readonly state = signal<'loading' | 'ready' | 'failed' | 'no-webgl'>('loading');
  protected readonly expanded = signal(false);
  /** The preset the camera last went to; turning the scan by hand leaves neither lit. */
  protected readonly view = signal<View | null>('occlusal');
  protected readonly label = () => modelLabel(this.type());

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly zone = inject(NgZone);

  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private model: Object3D | null = null;
  private radius = 1;
  private frame = 0;
  private resize: ResizeObserver | null = null;
  private loadId = 0;

  constructor() {
    effect(() => {
      const blob = this.blob();
      const type = this.type();
      untracked(() => void this.show(blob, type));
    });
    // A full-screen scan closes with Escape, like the other lightboxes.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && this.expanded()) this.expanded.set(false); };
    document.addEventListener('keydown', onKey);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('keydown', onKey);
      this.dispose();
    });
  }

  private async show(blob: Blob, type: ModelType): Promise<void> {
    const id = ++this.loadId;
    this.state.set('loading');
    try {
      await this.ensureStage();
      if (!this.renderer) return;
      const model = await loadScanModel(blob, type);
      if (id !== this.loadId) return;
      await this.place(model);
      this.state.set('ready');
    } catch {
      if (id === this.loadId && this.state() !== 'no-webgl') this.state.set('failed');
    }
  }

  private async ensureStage(): Promise<void> {
    if (this.renderer) return;
    const THREE = await import('three');
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
    const el = this.host().nativeElement;
    let renderer: WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      this.state.set('no-webgl');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10_000);
    scene.add(camera);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445055, 1.1));
    // A light that moves with the camera: whatever side is turned to the doctor is lit.
    const head = new THREE.DirectionalLight(0xffffff, 1.6);
    head.position.set(0.3, 0.6, 1);
    camera.add(head);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.addEventListener('change', () => this.draw());
    controls.addEventListener('start', () => this.zone.run(() => this.view.set(null)));

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.zone.runOutsideAngular(() => {
      this.resize = new ResizeObserver(() => this.fit());
      this.resize.observe(el);
    });
    this.fit();
  }

  private async place(model: Object3D): Promise<void> {
    const THREE = await import('three');
    if (!this.scene) return;
    if (this.model) {
      this.scene.remove(this.model);
      disposeObject(this.model);
    }
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    const wrapper = new THREE.Group();
    wrapper.add(model);
    this.scene.add(wrapper);
    this.model = wrapper;
    this.radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1e-3);
    this.setView('occlusal');
  }

  protected setView(view: View): void {
    const camera = this.camera;
    const controls = this.controls;
    if (!camera || !controls) return;
    const distance = (this.radius / Math.sin(((camera.fov / 2) * Math.PI) / 180)) * 1.05;
    camera.near = distance / 100;
    camera.far = distance * 100;
    if (view === 'occlusal') {
      camera.position.set(0, 0, distance);
      camera.up.set(0, 1, 0);
    } else {
      camera.position.set(0, -distance, 0);
      camera.up.set(0, 0, 1);
    }
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
    this.view.set(view);
    this.draw();
  }

  private fit(): void {
    const el = this.host().nativeElement;
    if (!this.renderer || !this.camera) return;
    const w = Math.max(el.clientWidth, 1);
    const h = Math.max(el.clientHeight, 1);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  private draw(): void {
    if (this.frame) return;
    this.zone.runOutsideAngular(() => {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
      });
    });
  }

  private dispose(): void {
    this.loadId++;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resize?.disconnect();
    this.controls?.dispose();
    if (this.model) disposeObject(this.model);
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer = null;
  }
}

function disposeObject(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Object3D & { geometry?: { dispose(): void }; material?: { dispose(): void } | { dispose(): void }[] };
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}
