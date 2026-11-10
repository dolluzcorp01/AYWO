// What the buttons on a screen offer. The server still checks every action, and files a request for anyone
// who can see a person but may not write directly, so 'add' and 'edit' stay open to all family.
type Role = 'none' | 'viewer' | 'commenter' | 'editor' | 'co_creator' | 'creator' | undefined;

/** Share rights and export belong to those who run the tree (share_create, buildGedcom). */
export function canShare(role: Role): boolean {
  return role === 'co_creator' || role === 'creator';
}

export function canComment(role: Role): boolean {
  return role === 'commenter' || role === 'editor' || canShare(role);
}

/** history_list: Editor and up. */
export function canSeeHistory(role: Role): boolean {
  return role === 'editor' || canShare(role);
}
