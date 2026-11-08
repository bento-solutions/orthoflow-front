import { describe, expect, it } from 'vitest';
import { ToothNumberTyping, stepInGrid, toothGrid } from './tooth-grid';

describe('stepInGrid', () => {
  const adult = toothGrid('adult');

  it('walks along the arch with left and right, across the midline too', () => {
    expect(stepInGrid(adult, '16', 'ArrowRight')).toBe('15');
    expect(stepInGrid(adult, '16', 'ArrowLeft')).toBe('17');
    expect(stepInGrid(adult, '11', 'ArrowRight')).toBe('21');
    expect(stepInGrid(adult, '31', 'ArrowLeft')).toBe('41');
  });

  it('goes to the opposing tooth with up and down', () => {
    expect(stepInGrid(adult, '16', 'ArrowDown')).toBe('46');
    expect(stepInGrid(adult, '46', 'ArrowUp')).toBe('16');
    expect(stepInGrid(adult, '21', 'ArrowDown')).toBe('31');
  });

  it('stays put at the edges rather than jumping across the mouth', () => {
    expect(stepInGrid(adult, '18', 'ArrowLeft')).toBe('18');
    expect(stepInGrid(adult, '28', 'ArrowRight')).toBe('28');
    expect(stepInGrid(adult, '16', 'ArrowUp')).toBe('16');
    expect(stepInGrid(adult, '46', 'ArrowDown')).toBe('46');
  });

  it('goes to the ends of the row with Home and End, of the chart with Ctrl', () => {
    expect(stepInGrid(adult, '46', 'Home')).toBe('48');
    expect(stepInGrid(adult, '46', 'End')).toBe('38');
    expect(stepInGrid(adult, '46', 'Home', true)).toBe('18');
    expect(stepInGrid(adult, '16', 'End', true)).toBe('38');
  });

  it('does the same on a child\'s chart', () => {
    const child = toothGrid('child');
    expect(stepInGrid(child, '51', 'ArrowRight')).toBe('61');
    expect(stepInGrid(child, '54', 'ArrowDown')).toBe('84');
    expect(stepInGrid(child, '75', 'ArrowRight')).toBe('75');
  });

  it('follows the rows on screen when each quadrant has its own', () => {
    const quadrants = toothGrid('adult', true);
    expect(stepInGrid(quadrants, '18', 'ArrowDown')).toBe('21');
    expect(stepInGrid(quadrants, '21', 'ArrowDown')).toBe('48');
    expect(stepInGrid(quadrants, '11', 'ArrowRight')).toBe('11');
  });

  it('ignores any other key and a tooth that is not on the chart', () => {
    expect(stepInGrid(adult, '16', 'Enter')).toBeNull();
    expect(stepInGrid(adult, '55', 'ArrowLeft')).toBeNull();
  });
});

describe('ToothNumberTyping', () => {
  const teeth = toothGrid('adult').flat();

  it('names a tooth once both digits are typed in quick succession', () => {
    const typing = new ToothNumberTyping();
    expect(typing.type('1', teeth, 1000)).toBeNull();
    expect(typing.type('6', teeth, 1400)).toBe('16');
  });

  it('starts again after a pause', () => {
    const typing = new ToothNumberTyping();
    typing.type('1', teeth, 1000);
    expect(typing.type('3', teeth, 3000)).toBeNull();
    expect(typing.type('6', teeth, 3200)).toBe('36');
  });

  it('names nothing when the number is not a tooth of this chart', () => {
    const typing = new ToothNumberTyping();
    typing.type('9', teeth, 1000);
    expect(typing.type('9', teeth, 1200)).toBeNull();
    typing.type('5', teeth, 1400);
    expect(typing.type('5', teeth, 1600)).toBeNull();
  });
});
