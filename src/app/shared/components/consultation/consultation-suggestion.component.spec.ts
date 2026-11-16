import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConsultationSuggestionComponent } from './consultation-suggestion.component';

describe('ConsultationSuggestionComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ConsultationSuggestionComponent, TranslateModule.forRoot()] });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('fr', {
      FINDING: { CARIES: 'Carie', EXTRACTION_REQUIRED: 'Extraction à faire' },
      SURFACE: { OCCLUSAL: 'Occlusale' },
      CONSULTATION: {
        DOC: { TOOTH: 'Dent' },
        SUGGEST: { STATE: 'État suggéré', TREATMENT: 'Soin suggéré', BOTH: 'Suggestion', NONE: 'Pas de suggestion', TO_CONFIRM: 'à confirmer', TEETH: 'Dents', SUSPECTED: '(suspicion)' },
      },
    });
    translate.use('fr');
  });

  function render(sentence: string, question: string | null = null): HTMLElement {
    const fixture = TestBed.createComponent(ConsultationSuggestionComponent);
    fixture.componentRef.setInput('sentence', sentence);
    fixture.componentRef.setInput('question', question);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the state it most likely is, on its tooth, marked to be confirmed', () => {
    const element = render('la 16 carie occlusale');

    expect(element.querySelector('.cs-kind')?.textContent).toContain('État suggéré');
    expect(element.querySelector('.cs-text')?.textContent).toContain('Dent 16 : Carie (occlusale)');
    expect(element.querySelector('[data-to-confirm]')?.textContent).toContain('à confirmer');
  });

  it('calls a treatment a treatment', () => {
    expect(render('extraction de la 38').querySelector('.cs-kind')?.textContent).toContain('Soin suggéré');
  });

  it('still says "to be confirmed", never "not understood", when it has nothing to suggest', () => {
    const element = render('euh, attendez une seconde', 'Sur quelle dent ?');

    expect(element.querySelector('.cs-none')?.textContent).toContain('Pas de suggestion');
    expect(element.querySelector('[data-to-confirm]')?.textContent).toContain('à confirmer');
    expect(element.querySelector('.cs-question')?.textContent).toContain('Sur quelle dent ?');
  });
});
