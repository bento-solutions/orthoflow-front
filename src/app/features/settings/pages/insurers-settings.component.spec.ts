import { describe, expect, it } from 'vitest';
import { InsuranceFormLayout } from '../../../core/services/insurance-forms-api.service';
import { defaultLayout } from './insurers-settings.component';

const layouts = [
  { code: 'cnops-dentaire', name: 'CNOPS', insurerCodes: ['CNOPS', 'MGPAP', 'OMFAM'] },
  { code: 'cnss-dentaire', name: 'CNSS', insurerCodes: ['CNSS'] },
] as unknown as InsuranceFormLayout[];

describe('the form an insurer gets by default', () => {
  it('is the layout that lists its code, whatever the case, and none for an insurer OrthoFlow has no sheet for', () => {
    expect(defaultLayout('mgpap', layouts)?.code).toBe('cnops-dentaire');
    expect(defaultLayout(' CNSS ', layouts)?.code).toBe('cnss-dentaire');
    expect(defaultLayout('AXA', layouts)).toBeNull();
  });
});
