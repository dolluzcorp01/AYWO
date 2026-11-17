// What each role in a tree can and can't do, in plain words. One list for the roles page, the Share screen and the
// line on the tree screen, so they never disagree. It describes the server's rules (can_edit, is_creator_or_cocreator,
// contact_access, tree_delete); the server still checks every action.

export type TreeRole = 'viewer' | 'commenter' | 'editor' | 'co_creator' | 'creator';
/** yes, no, "goes to the owner to approve first", or "only if the owner turned on Show contact numbers". */
export type Right = 'yes' | 'no' | 'approval' | 'ifShown';

export const ROLE_ORDER: TreeRole[] = ['viewer', 'commenter', 'editor', 'co_creator', 'creator'];

export const ROLE_NAME: Record<TreeRole, string> = {
  viewer: 'share.view',
  commenter: 'share.comment',
  editor: 'share.edit',
  co_creator: 'share.coCreate',
  creator: 'roles.creator',
};

// In the order the rights are listed. Keys are under roles.rights.
export const RIGHTS: { key: string; by: Record<TreeRole, Right> }[] = [
  { key: 'see', by: { viewer: 'yes', commenter: 'yes', editor: 'yes', co_creator: 'yes', creator: 'yes' } },
  { key: 'change', by: { viewer: 'approval', commenter: 'approval', editor: 'yes', co_creator: 'yes', creator: 'yes' } },
  { key: 'notes', by: { viewer: 'no', commenter: 'yes', editor: 'yes', co_creator: 'yes', creator: 'yes' } },
  { key: 'history', by: { viewer: 'no', commenter: 'no', editor: 'yes', co_creator: 'yes', creator: 'yes' } },
  { key: 'numbers', by: { viewer: 'ifShown', commenter: 'ifShown', editor: 'ifShown', co_creator: 'yes', creator: 'yes' } },
  { key: 'approve', by: { viewer: 'no', commenter: 'no', editor: 'no', co_creator: 'yes', creator: 'yes' } },
  { key: 'share', by: { viewer: 'no', commenter: 'no', editor: 'no', co_creator: 'yes', creator: 'yes' } },
  { key: 'export', by: { viewer: 'no', commenter: 'no', editor: 'no', co_creator: 'yes', creator: 'yes' } },
  { key: 'delete', by: { viewer: 'no', commenter: 'no', editor: 'no', co_creator: 'no', creator: 'yes' } },
];

export function isTreeRole(value: unknown): value is TreeRole {
  return typeof value === 'string' && (ROLE_ORDER as string[]).includes(value);
}
