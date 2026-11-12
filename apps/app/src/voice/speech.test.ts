import { describe, expect, it } from 'vitest';
import { asName, mergeSpoken, problemFor, speechLang } from './speech';

describe('speechLang', () => {
  it('uses the India variant for Tamil and English', () => {
    expect(speechLang('ta')).toBe('ta-IN');
    expect(speechLang('en-US')).toBe('en-IN');
    expect(speechLang('hi')).toBe('hi-IN');
  });
  it('keeps other languages as they are', () => {
    expect(speechLang('ar')).toBe('ar');
    expect(speechLang('fr-FR')).toBe('fr-FR');
  });
  it('falls back to English', () => {
    expect(speechLang('')).toBe('en-IN');
  });
});

describe('mergeSpoken', () => {
  it('adds speech after what was typed, with one space', () => {
    expect(mergeSpoken('Hello', 'how are you')).toBe('Hello how are you');
    expect(mergeSpoken('Hello ', 'how are you')).toBe('Hello how are you');
  });
  it('replaces nothing when nothing was said', () => {
    expect(mergeSpoken('Hello', '  ')).toBe('Hello');
  });
  it('works in Tamil', () => {
    expect(mergeSpoken('', 'வணக்கம் அம்மா')).toBe('வணக்கம் அம்மா');
  });
});

describe('asName', () => {
  it('capitalises each word of an English name', () => {
    expect(asName('ravi kumar')).toBe('Ravi Kumar');
  });
  it('leaves Tamil script alone', () => {
    expect(asName('ரவி குமார்')).toBe('ரவி குமார்');
  });
});

describe('problemFor', () => {
  it('maps speech errors to messages', () => {
    expect(problemFor('not-allowed')).toBe('denied');
    expect(problemFor('no-speech')).toBe('noSpeech');
    expect(problemFor('language-not-supported')).toBe('notAvailable');
    expect(problemFor('network')).toBe('network');
    expect(problemFor('audio-capture')).toBe('failed');
  });
  it('treats stopping on purpose as fine', () => {
    expect(problemFor('aborted')).toBeNull();
  });
});
