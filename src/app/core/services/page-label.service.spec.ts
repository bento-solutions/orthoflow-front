import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { PageLabelService, pathOf } from './page-label.service';

@Component({ standalone: true, template: '' })
class Blank {}

async function setup() {
  TestBed.configureTestingModule({
    providers: [provideRouter([
      { path: '', component: Blank },
      { path: 'patients/:id', component: Blank },
    ])],
  });
  const router = TestBed.inject(Router);
  const labels = TestBed.inject(PageLabelService);
  await router.navigateByUrl('/patients/7');
  return { router, labels };
}

describe('PageLabelService', () => {
  it('reads the path of an address without its query', () => {
    expect(pathOf('/patients/7?tab=chart#x')).toBe('/patients/7');
  });

  it('keeps the name when only the query changes (the patient file tabs)', async () => {
    const { router, labels } = await setup();
    labels.set('Houssam Chakir', {});
    await router.navigateByUrl('/patients/7?tab=chart');
    expect(labels.label()).toBe('Houssam Chakir');
  });

  it('clears the name when leaving for another screen', async () => {
    const { router, labels } = await setup();
    labels.set('Houssam Chakir', {});
    await router.navigateByUrl('/');
    expect(labels.label()).toBeNull();
  });

  it('is cleared by the screen that set it, and only by that screen', async () => {
    const { labels } = await setup();
    const dossier = {};
    const other = {};
    labels.set('Houssam Chakir', dossier);
    labels.clear(other);
    expect(labels.label()).toBe('Houssam Chakir');
    labels.clear(dossier);
    expect(labels.label()).toBeNull();
  });
});
