import { describe, expect, it } from 'vitest';
import { spokenSpelling } from './spoken-spelling';

describe('spokenSpelling', () => {
  it('joins letters said one by one', () => {
    expect(spokenSpelling('A, C, H, R, A, F')).toBe('Achraf');
    expect(spokenSpelling("le prénom s'écrit A C H R A F")).toBe('Achraf');
  });

  it('reads letters said by their French names', () => {
    expect(spokenSpelling('bé, a, enne, i')).toBe('Bani');
  });

  it('keeps the word a letter was insisted on', () => {
    expect(spokenSpelling('Achraf avec un C')).toBe('Achraf');
  });

  it('is nothing in an ordinary sentence', () => {
    expect(spokenSpelling('allergie à la pénicilline')).toBeNull();
    expect(spokenSpelling('a b')).toBeNull();
  });
});
