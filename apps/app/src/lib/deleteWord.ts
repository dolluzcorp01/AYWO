// The word typed to confirm deleting an account or a tree.
//
// Many people read Tamil (or another language) on a phone that only types English letters, so the English word is
// always accepted too and shown beside the translated one: "நீக்கு / delete". Someone copying exactly what is shown
// types both words with the stroke between them, and that is accepted as well.
export function deleteWordShown(ownWord: string): string {
  return ownWord.toLowerCase() === 'delete' ? ownWord : `${ownWord} / delete`;
}

export function isDeleteWord(typed: string, ownWord: string): boolean {
  const clean = (text: string) => text.trim().toLowerCase().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ');
  const own = clean(ownWord);
  return [own, 'delete', `${own}/delete`].includes(clean(typed));
}
