// The signed-in person and their trees (contract endpoints, owned by the tree area).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, deviceStore } from '@/lib/api';

export interface Me {
  id: string;
  display_name: string;
  login_phone: string | null;
  email: string | null;
  language_code: string;
  large_text: boolean;
  /** Elder mode: a simple Home with a few big buttons. */
  simple_mode: boolean;
  plus: boolean;
  plus_until: string | null;
  admin_role: string | null;
  /** Set when the person asked to delete the account: the day it goes. Signing in and tapping Keep cancels it. */
  delete_after: string | null;
  /** A short-lived link to the account photo. */
  photo_url: string | null;
}

export interface TreeRow {
  id: string;
  name: string;
  people: number;
  role: 'none' | 'viewer' | 'commenter' | 'editor' | 'co_creator' | 'creator';
  /** When this person joined the tree: a date, not a head count. */
  joined: string;
  branch_only: boolean;
}

/** The tree Home leads with: the first one this person created, otherwise the first shared with them. */
export function mainTree(trees: TreeRow[] | undefined): TreeRow | undefined {
  return trees?.find((tree) => tree.role === 'creator') ?? trees?.[0];
}

export interface ClaimCandidate {
  person_id: string;
  tree_id: string;
  tree_name: string;
  display_name: string;
  photo_path: string | null;
}

/** What wireframe B2 shows, to help someone recognise themselves. Never a contact value. */
export interface ClaimDetails {
  person_id: string;
  tree_id: string;
  tree_name: string;
  display_name: string;
  photo_url: string | null;
  parents: string[];
  partners: string[];
  married: boolean;
  people: number;
  added_by: string | null;
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/me') });
}

/** Cancels a booked account deletion. */
export function useKeepAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Me>('/account/keep'),
    onSuccess: (answer) => client.setQueryData(['me'], answer),
  });
}

export function useTrees() {
  return useQuery({ queryKey: ['trees'], queryFn: () => api.get<TreeRow[]>('/trees') });
}

/** Saves to the account. The cached answer updates at once so the screen does not wait. */
export function useUpdateMe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (changes: { display_name?: string; email?: string; language_code?: string; large_text?: boolean; simple_mode?: boolean; photo_path?: string }) =>
      api.patch<Me>('/me', changes),
    onSuccess: (_answer, changes) => {
      client.invalidateQueries({ queryKey: ['me'] });
      // A new photo also lands on the person's own card if it has none.
      if (changes.photo_path) client.invalidateQueries({ queryKey: ['tree-view'] });
    },
  });
}

export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

// 'Not me' on B2 must stay answered, or every sign-in would ask again.
const NOT_ME = 'aywo.notMe';

export async function notMeIds(): Promise<string[]> {
  const raw = await deviceStore.get(NOT_ME);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? (list as string[]) : [];
  } catch {
    return [];
  }
}

export async function rememberNotMe(personId: string): Promise<void> {
  const list = await notMeIds();
  if (!list.includes(personId)) await deviceStore.set(NOT_ME, JSON.stringify([...list, personId]));
}

export async function claimCandidates(): Promise<ClaimCandidate[]> {
  const [rows, notMe] = await Promise.all([api.rpc<ClaimCandidate[]>('claim_candidates'), notMeIds()]);
  return rows.filter((row) => !notMe.includes(row.person_id));
}

export async function claimDetails(): Promise<ClaimDetails[]> {
  const [rows, notMe] = await Promise.all([api.post<ClaimDetails[]>('/claim-candidates'), notMeIds()]);
  return rows.filter((row) => !notMe.includes(row.person_id));
}

/** Only a path inside this app. A link someone was sent must not be able to send them to another site after sign-in. */
export function safeNext(next: string | undefined): string | undefined {
  return next && /^\/(?![/\\])/.test(next) ? next : undefined;
}
