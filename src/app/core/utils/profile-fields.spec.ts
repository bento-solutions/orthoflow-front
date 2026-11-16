import { describe, expect, it } from 'vitest';
import { missingForDocuments } from './profile-fields';

describe('missingForDocuments', () => {
  it('asks invoices for the tax numbers and prescriptions for a phone, as the server does', () => {
    expect(missingForDocuments({ name: 'Cabinet Atlas', address: '12 rue des Orangers', city: 'Casablanca' })).toEqual({
      financial: ['ice', 'taxId'],
      prescription: ['phone'],
    });
  });

  it('does not take the starting name or blanks for a filled field', () => {
    expect(missingForDocuments({ name: ' Cabinet ', ice: '  ', taxId: '1', address: 'a', city: 'c', phone: 'p' })).toEqual({
      financial: ['name', 'ice'],
      prescription: ['name'],
    });
  });

  it('finds nothing missing on a complete profile', () => {
    expect(missingForDocuments({ name: 'Cabinet Atlas', ice: '1', taxId: '2', address: 'a', city: 'c', phone: 'p' }))
      .toEqual({ financial: [], prescription: [] });
  });
});
