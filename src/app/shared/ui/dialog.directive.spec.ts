import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialogDirective } from './dialog.directive';

@Component({
  standalone: true,
  imports: [DialogDirective],
  template: `
    <button id="opener" type="button">Open</button>
    @if (open()) {
      <div appDialog="title" (dialogClosed)="closed()" id="panel">
        <h2 id="title">Edit</h2>
        <button id="close" type="button">Close</button>
        @if (withField()) { <input id="field" aria-label="Name" /> }
        <button id="last" type="button">Save</button>
      </div>
    }
  `,
})
class HostComponent {
  readonly open = signal(false);
  readonly withField = signal(true);
  readonly closed = vi.fn();
}

describe('DialogDirective', () => {
  let host: HTMLElement;

  const render = (withField = true) => {
    const fixture = TestBed.createComponent(HostComponent);
    host = fixture.nativeElement;
    document.body.appendChild(host);
    fixture.componentInstance.withField.set(withField);
    fixture.detectChanges();
    (host.querySelector('#opener') as HTMLElement).focus();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    return fixture;
  };
  const press = (key: string, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(event);
    return event;
  };

  afterEach(() => host.remove());

  it('says it is a modal dialog and what it is called', () => {
    render();
    const panel = host.querySelector('#panel')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-labelledby')).toBe('title');
  });

  it('takes focus to the first field, past the close button', () => {
    render();
    expect(document.activeElement?.id).toBe('field');
  });

  it('takes focus to the first control when there is no field', () => {
    render(false);
    expect(document.activeElement?.id).toBe('close');
  });

  it('keeps Tab inside, both ways', () => {
    render();
    (host.querySelector('#last') as HTMLElement).focus();
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('close');
    expect(press('Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('last');
  });

  it('asks to close on Escape, without the Escape reaching anything behind it', () => {
    const fixture = render();
    const behind = vi.fn();
    host.addEventListener('keydown', behind);
    press('Escape');
    expect(fixture.componentInstance.closed).toHaveBeenCalledOnce();
    expect(behind).not.toHaveBeenCalled();
  });

  it('hands focus back to what opened it', () => {
    const fixture = render();
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    expect(document.activeElement?.id).toBe('opener');
  });
});
