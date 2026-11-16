import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { isUnknownName, shownFirstName, shownName } from './personName';

const t = ((key: string) => `[${key}]`) as unknown as TFunction;

describe('shownName', () => {
  it('prints a real name as it is', () => {
    expect(shownName(t, 'Meena Kumari')).toBe('Meena Kumari');
    expect(shownName(t, 'Meena Kumari', false)).toBe('Meena Kumari');
  });

  it('never prints the stored marker', () => {
    expect(shownName(t, 'Name unknown')).toBe('[tree.nameNotKnown]');
    expect(shownName(t, 'Name unknown', false)).toBe('[tree.nameNotKnown]');
  });

  it('follows the name_unknown flag whatever the text says', () => {
    expect(shownName(t, 'Anything', true)).toBe('[tree.nameNotKnown]');
  });

  it('a missing or empty name is not known either', () => {
    expect(shownName(t, null)).toBe('[tree.nameNotKnown]');
    expect(shownName(t, '  ')).toBe('[tree.nameNotKnown]');
  });
});

describe('shownFirstName', () => {
  it('takes the first word of a real name only', () => {
    expect(shownFirstName(t, 'Meena Kumari')).toBe('Meena');
    expect(shownFirstName(t, 'Name unknown')).toBe('[tree.nameNotKnown]');
  });
});

describe('isUnknownName', () => {
  it('knows the marker and the flag', () => {
    expect(isUnknownName('Name unknown')).toBe(true);
    expect(isUnknownName('Ravi', true)).toBe(true);
    expect(isUnknownName('Ravi')).toBe(false);
  });
});
