import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FocusRecoveryService } from './focus-recovery.service';

describe('FocusRecoveryService', () => {
  let main: HTMLElement;
  let button: HTMLButtonElement;

  beforeEach(() => {
    main = document.createElement('main');
    main.tabIndex = -1;
    button = document.createElement('button');
    main.appendChild(button);
    document.body.appendChild(main);
    TestBed.inject(FocusRecoveryService).start();
  });

  afterEach(() => main.remove());

  const settled = () => new Promise((resolve) => setTimeout(resolve));

  it('moves focus to the main content when what had it is removed', async () => {
    button.focus();
    button.remove();
    await settled();
    expect(document.activeElement).toBe(main);
  });

  it('leaves focus alone when something else has already taken it', async () => {
    const other = document.createElement('button');
    main.appendChild(other);
    button.focus();
    button.remove();
    other.focus();
    await settled();
    expect(document.activeElement).toBe(other);
  });
});
