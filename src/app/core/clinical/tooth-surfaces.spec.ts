import { describe, expect, it } from 'vitest';
import {
  centreSurface, formatSurface, isAnteriorTooth, parseSurface, surfaceShorthand, surfaceZone, zoneSurface,
  zonesOf, SURFACE_ZONES,
} from './tooth-surfaces';

describe('tooth surfaces', () => {
  it('reads and writes compound surfaces in the canonical order', () => {
    expect(parseSurface('distal-mesial-occlusal')).toEqual(['mesial', 'occlusal', 'distal']);
    expect(formatSurface(['distal', 'mesial', 'occlusal'])).toBe('mesial-occlusal-distal');
    expect(formatSurface([])).toBeNull();
    expect(parseSurface(null)).toEqual([]);
    expect(parseSurface('mesial-banana')).toEqual(['mesial']);
  });

  it('abbreviates the way dentists chart', () => {
    expect(surfaceShorthand('mesial-occlusal-distal')).toBe('MOD');
    expect(surfaceShorthand('buccal')).toBe('B');
    expect(surfaceShorthand(undefined)).toBe('');
  });

  it('puts mesial toward the midline on both sides of the mouth', () => {
    // Patient's right (quadrants 1 and 4) is the left of the drawing, midline on its right.
    expect(surfaceZone('16', 'mesial')).toBe('right');
    expect(surfaceZone('16', 'distal')).toBe('left');
    expect(surfaceZone('46', 'mesial')).toBe('right');
    // Patient's left: midline on the left of the drawing.
    expect(surfaceZone('26', 'mesial')).toBe('left');
    expect(surfaceZone('36', 'distal')).toBe('right');
    // Primary teeth follow the same sides.
    expect(surfaceZone('55', 'mesial')).toBe('right');
    expect(surfaceZone('65', 'mesial')).toBe('left');
  });

  it('is its own inverse: the zone a surface sits on names that surface back', () => {
    for (const fdi of ['11', '16', '21', '26', '33', '36', '41', '46', '53', '64']) {
      for (const zone of SURFACE_ZONES) {
        expect(surfaceZone(fdi, zoneSurface(fdi, zone))).toBe(zone);
      }
    }
  });

  it('bites on an edge at the front and a table at the back', () => {
    expect(isAnteriorTooth('13')).toBe(true);
    expect(isAnteriorTooth('14')).toBe(false);
    expect(centreSurface('11')).toBe('incisal');
    expect(centreSurface('26')).toBe('occlusal');
    // A record made as "occlusal" on an incisor still lands on the centre.
    expect(surfaceZone('11', 'occlusal')).toBe('center');
  });

  it('gives cervical no zone and collects the zones of a compound surface', () => {
    expect(surfaceZone('16', 'cervical')).toBeNull();
    expect([...zonesOf('16', 'mesial-occlusal-distal-cervical')].sort()).toEqual(['center', 'left', 'right']);
  });
});
