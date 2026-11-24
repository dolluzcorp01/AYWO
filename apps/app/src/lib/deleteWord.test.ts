import { describe, expect, it } from 'vitest';
import { deleteWordShown, isDeleteWord } from './deleteWord';

describe('the word typed to confirm a delete', () => {
  it('takes the English word in any language, in any case', () => {
    expect(isDeleteWord(' Delete ', 'நீக்கு')).toBe(true);
    expect(isDeleteWord('delete', 'delete')).toBe(true);
  });
  it('takes the translated word', () => {
    expect(isDeleteWord('நீக்கு', 'நீக்கு')).toBe(true);
  });
  it('takes exactly what the box shows, with or without spaces round the stroke', () => {
    expect(isDeleteWord(deleteWordShown('நீக்கு'), 'நீக்கு')).toBe(true);
    expect(isDeleteWord('நீக்கு/delete', 'நீக்கு')).toBe(true);
  });
  it('refuses anything else', () => {
    expect(isDeleteWord('', 'நீக்கு')).toBe(false);
    expect(isDeleteWord('delet', 'delete')).toBe(false);
    expect(isDeleteWord('remove', 'நீக்கு')).toBe(false);
  });
  it('shows one word in English and both in other languages', () => {
    expect(deleteWordShown('delete')).toBe('delete');
    expect(deleteWordShown('நீக்கு')).toBe('நீக்கு / delete');
  });
});
