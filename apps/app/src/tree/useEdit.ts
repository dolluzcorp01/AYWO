// Changing the tree, and everything around it: E1, E2, E3, E4, E5, E6, comments and the word screen.
// Paths and shapes follow docs/BUILD-CONTRACT.md. These hooks are the one place to touch if an answer's shape moves.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiFailure } from '@/lib/api';

export type Relation = 'parent' | 'child' | 'spouse' | 'sibling';
export type LinkKind = 'birth' | 'adopted' | 'step' | 'foster' | 'unknown';
export type ContactKind = 'mobile' | 'whatsapp' | 'email';
export type ShareRole = 'viewer' | 'commenter' | 'editor' | 'co_creator';
export type EditMode = 'direct' | 'approval';

export interface PersonFields {
  display_name?: string;
  name_unknown?: boolean;
  gender?: string;
  living?: string;
  birth_date?: string | null;
  birth_precision?: string | null;
  death_date?: string | null;
  death_precision?: string | null;
  birth_place?: string | null;
  death_place?: string | null;
  birth_order?: number | null;
  notes?: string | null;
  photo_path?: string | null;
}

export interface AddRelativeArgs {
  p_anchor: string;
  p_relation: Relation;
  p_person?: PersonFields;
  p_existing_person?: string;
  p_union?: string;
  p_link_kind?: LinkKind;
}

function useTreeRefresh(treeId: string) {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ['tree-view', treeId] }),
      client.invalidateQueries({ queryKey: ['trees'] }),
    ]);
}

export type AddAnswer = { status: 'saved'; person_id: string; union_id: string | null } | { status: 'requested' };

/**
 * 'One undo' for the whole add happens on the server (F-TREE-03). Anyone who may not write directly
 * (an editor in approval mode, a viewer adding outside their own branch) sends the same add to the Creator instead.
 */
export function useAddRelative(treeId: string) {
  const refresh = useTreeRefresh(treeId);
  return useMutation({
    mutationFn: async (args: AddRelativeArgs): Promise<AddAnswer> => {
      try {
        const added = await api.rpc<{ person_id: string; union_id: string | null }>('add_relative', { ...args });
        return { status: 'saved', ...added };
      } catch (error) {
        if (!(error instanceof ApiFailure && error.code === 'not_allowed')) throw error;
        await api.rpc<string>('request_change', {
          p_person: args.p_anchor,
          p_payload: {
            action: 'add_relative',
            relation: args.p_relation,
            ...(args.p_person ? { person: args.p_person } : {}),
            ...(args.p_existing_person ? { existing_person: args.p_existing_person } : {}),
            ...(args.p_union ? { union: args.p_union } : {}),
            ...(args.p_link_kind ? { link_kind: args.p_link_kind } : {}),
          },
        });
        return { status: 'requested' };
      }
    },
    onSuccess: () => refresh(),
  });
}

export type PersonSaveAnswer = { status: 'saved'; id: string; version?: number } | { status: 'requested'; request_id: string };

/** 'requested' means this person may not write directly, so it went to the Creator. */
export function savePerson(personId: string, version: number, fields: PersonFields) {
  return api.patch<PersonSaveAnswer>(`/persons/${personId}`, { version, ...fields });
}

export function deletePerson(personId: string, version: number) {
  return api.del<PersonSaveAnswer>(`/persons/${personId}?version=${version}`);
}

export interface EditContact {
  id: string;
  kind: ContactKind;
  /** Null when the number exists but this person may not read it. Editing rights do not open a locked number. */
  value: string | null;
  value_normalized: string | null;
}

export function useContactsForEdit(personId: string | undefined) {
  return useQuery({
    queryKey: ['contacts-for-edit', personId],
    enabled: !!personId,
    gcTime: 0,
    queryFn: () => api.get<EditContact[]>(`/persons/${personId}/contacts-for-edit`),
  });
}

export function setContact(personId: string, kind: ContactKind, value: string, normalized: string) {
  return api.rpc<string>('set_person_contact', { p_person: personId, p_kind: kind, p_value: value, p_value_normalized: normalized });
}

export function deleteContact(contactId: string) {
  return api.rpc<void>('delete_person_contact', { p_contact: contactId });
}

// ----- Comments -----

export interface Comment {
  id: string;
  person_id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  resolved_at: string | null;
  created_at: string;
}

export function useComments(personId: string) {
  return useQuery({ queryKey: ['comments', personId], queryFn: () => api.get<Comment[]>(`/persons/${personId}/comments`) });
}

export function useAddComment(personId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.post<{ id: string }>(`/persons/${personId}/comments`, { body }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['comments', personId] }),
  });
}

// ----- Sharing -----

export interface ShareInput {
  scope_person_id?: string;
  grantee_person_id?: string;
  grantee_phone?: string;
  role: ShareRole;
  edit_mode: EditMode;
  contacts_visible: boolean;
  expires_at?: string;
}

export interface ShareRow {
  id: string;
  tree_id: string;
  role: ShareRole;
  edit_mode: EditMode;
  contacts_visible: boolean;
  expires_at: string | null;
  expired: boolean;
  scope_person_id: string | null;
  scope_name: string | null;
  grantee_person_id: string | null;
  grantee_person_name: string | null;
  grantee_profile_id: string | null;
  grantee_name: string | null;
  /** A number with no account yet, as ******1234. */
  waiting_phone: string | null;
  link_url: string | null;
}

export function useShares(treeId: string, enabled: boolean) {
  return useQuery({ queryKey: ['shares', treeId], enabled, queryFn: () => api.get<ShareRow[]>(`/trees/${treeId}/shares`) });
}

/** GET /trees/:id/members: for those who run the tree. Names and profile ids, never contact values. */
export interface TreeMembers {
  creator_id: string;
  claimed: { person_id: string; person_name: string; profile_id: string; display_name: string }[];
  grantees: { profile_id: string; display_name: string; role: string; branch_only: boolean }[];
  successor: { profile_id: string; display_name: string } | null;
}

export const treeMembersQuery = (treeId: string) => ({
  queryKey: ['tree-members', treeId],
  queryFn: () => api.get<TreeMembers>(`/trees/${treeId}/members`),
});

export function useTreeMembers(treeId: string) {
  return useQuery(treeMembersQuery(treeId));
}

export function useCreateShare(treeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ShareInput) => api.post<{ id: string; link_url: string }>(`/trees/${treeId}/shares`, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['shares', treeId] }),
  });
}

export function useRevokeShare(treeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => api.del<unknown>(`/shares/${shareId}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['shares', treeId] }),
  });
}

// ----- Activity (E4) -----

export type ActivityTab = 'needs_you' | 'changes' | 'access' | 'all';

interface ActivityBase {
  id: string;
  at: string;
  tree_id: string;
  tree_name: string;
  actor_id?: string | null;
  actor_name?: string | null;
  person_id?: string | null;
  person_name?: string | null;
  needs_you?: boolean;
}

export interface RequestPayload {
  action?: string;
  relation?: string;
  person?: PersonFields;
  table?: string;
  op?: string;
  data?: PersonFields;
}

export interface RequestItem extends ActivityBase {
  type: 'request';
  request_id: string;
  kind: 'access_edit' | 'access_contacts' | 'role_upgrade' | 'change' | 'merge';
  state: 'pending' | 'approved' | 'declined' | 'expired' | 'applied';
  payload?: RequestPayload | null;
}

export interface ClaimItem extends ActivityBase {
  type: 'claim';
  notification_id: string;
}

export interface ChangeItem extends ActivityBase {
  type: 'change';
  batch_id: string;
  rows: number;
  op: 'insert' | 'update' | 'delete';
  table_name: string;
  contacts_changed: boolean;
  reverted: boolean;
  can_revert: boolean;
}

export interface ShareItem extends ActivityBase {
  type: 'share';
  share_id: string;
  role: ShareRole;
  revoked: boolean;
  expires_at: string | null;
  grantee_name: string | null;
  waiting_for_signup: boolean;
}

export type ActivityItem = RequestItem | ClaimItem | ChangeItem | ShareItem;

export function useActivity(tab: ActivityTab) {
  return useQuery({
    queryKey: ['activity', tab],
    queryFn: () => api.get<ActivityItem[]>(`/activity?tab=${tab}`),
  });
}

export function useDecideRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { requestId: string; decision: 'approve' | 'decline'; edited_payload?: unknown }) =>
      api.post<unknown>(`/requests/${input.requestId}/decide`, {
        decision: input.decision,
        ...(input.edited_payload !== undefined ? { edited_payload: input.edited_payload } : {}),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['activity'] });
      client.invalidateQueries({ queryKey: ['tree-view'] });
    },
  });
}

export function useUndoClaim() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (personId: string) => api.rpc<void>('claim_undo', { p_person: personId }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['activity'] });
      client.invalidateQueries({ queryKey: ['tree-view'] });
    },
  });
}

// ----- History (E6) -----

export interface HistoryItem {
  id: number;
  table_name: 'persons' | 'person_contacts' | 'unions' | 'parent_child' | string;
  row_id: string;
  op: 'insert' | 'update' | 'delete';
  at: string;
  batch_id: string;
  actor_id: string | null;
  actor_name: string | null;
  reverted_by: number | null;
  before: { display_name?: string; deleted_at?: string | null } | null;
  after: { display_name?: string; deleted_at?: string | null } | null;
  contact_kind: ContactKind | null;
  can_revert: boolean;
}

export function useHistory(treeId: string, personId?: string) {
  const query = personId ? `?person_id=${encodeURIComponent(personId)}` : '';
  return useQuery({ queryKey: ['history', treeId, personId ?? null], queryFn: () => api.get<HistoryItem[]>(`/trees/${treeId}/history${query}`) });
}

export function useRevert(treeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (target: { history_id?: number; batch_id?: string }) => api.post<unknown>('/history/revert', target),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['history', treeId] });
      client.invalidateQueries({ queryKey: ['tree-view', treeId] });
      client.invalidateQueries({ queryKey: ['trees'] });
    },
  });
}

// ----- Merge (E5) -----

export interface MergePerson {
  id: string;
  display_name: string;
  name_unknown: boolean;
  added_by: string | null;
  parents: string[];
  partners: string[];
  children: number;
  deleted: boolean;
  claimed: boolean;
  photo_url: string | null;
}

export interface MergeAnswer {
  request_id: string;
  tree_id: string;
  status: RequestItem['state'];
  score: number | null;
  people: MergePerson[];
}

export function useMerge(requestId: string) {
  return useQuery({ queryKey: ['merge', requestId], queryFn: () => api.get<MergeAnswer>(`/merge/${requestId}`) });
}

export function useApplyMerge(requestId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<unknown>(`/merge/${requestId}/apply`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['activity'] });
      client.invalidateQueries({ queryKey: ['tree-view'] });
      client.invalidateQueries({ queryKey: ['trees'] });
    },
  });
}

// ----- Search (F2) -----

export interface SearchHit {
  id: string;
  name: string;
}

export function useTreeSearch(treeId: string, q: string) {
  return useQuery({
    queryKey: ['search', treeId, q],
    enabled: q.length > 0,
    queryFn: () => api.get<SearchHit[]>(`/trees/${treeId}/search?q=${encodeURIComponent(q)}`),
  });
}

// ----- Relationship word (S-18) -----

export interface KinSuggestion {
  id: string;
  term: string;
  term_native: string | null;
  path_code: string;
  language_code: string;
  status: string;
  is_default: boolean;
}

export function useKinSuggest(lang: string, q: string, path: string | null) {
  return useQuery({
    queryKey: ['kin-suggest', lang, q, path],
    queryFn: () =>
      api.get<KinSuggestion[]>(`/kin/suggest?lang=${encodeURIComponent(lang)}&q=${encodeURIComponent(q)}&path=${encodeURIComponent(path ?? '')}`),
    enabled: path !== null,
  });
}

export function useAddKinTerm(treeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { path_code: string; language_code: string; term: string }) => api.post<unknown>('/kin/terms', input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tree-view', treeId] }),
  });
}

export function useReportKinTerm() {
  return useMutation({
    mutationFn: (input: { kin_term_id: string; suggestion: string | null }) => api.post<unknown>('/kin/reports', input),
  });
}

// ----- Notifications -----

export type NotifyChannel = 'push' | 'sms' | 'email';

export interface NotificationPref {
  kind: string;
  push: boolean;
  sms: boolean;
  email: boolean;
}

export function useNotificationPrefs() {
  return useQuery({ queryKey: ['notification-prefs'], queryFn: () => api.get<NotificationPref[]>('/notification-prefs') });
}

export function useSaveNotificationPref() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (pref: NotificationPref) => api.patch<unknown>('/notification-prefs', pref),
    onSuccess: () => client.invalidateQueries({ queryKey: ['notification-prefs'] }),
  });
}
