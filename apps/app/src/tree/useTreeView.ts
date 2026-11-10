import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ApiTree, RelationInput } from '@aywo/layout';
import { api } from '@/lib/api';

export type TreeMode = 'mine' | 'names' | 'see_as';

export interface TreeNode {
  id: string;
  name: string;
  nameUnknown: boolean;
  noteLabel: string | null;
  gender: string;
  living: string;
  birthOrder: number | null;
  birthDate: string | null;
  deathDate: string | null;
  birthPrecision: string | null;
  deathPrecision: string | null;
  birthPlace: string | null;
  deathPlace: string | null;
  notes: string | null;
  joined: boolean;
  version: number;
  photoUrl: string | null;
}

export interface TreeViewAnswer extends ApiTree {
  tree: { id: string; name: string };
  role: 'none' | 'viewer' | 'commenter' | 'editor' | 'co_creator' | 'creator';
  viewer_person_id: string | null;
  nodes: TreeNode[];
  labels: Record<string, TreeLabel>;
}

export interface TreeLabel extends RelationInput {
  pathCode: string;
  native?: string | null;
  /** The dictionary row behind the word on screen. None for a phrase built from the path. */
  kinTermId?: string | null;
  ask?: { term: string; native?: string | null }[];
  also?: { pathCode: string; label: string; native?: string | null } | null;
  askAbout?: { linkId: string; siblingId: string } | null;
}

/** LLD L5 no. 5. The server decides what comes back; contact details are not used on these screens. */
export function useTreeView(treeId: string, mode: TreeMode, lang: string, seeAsId: string | null) {
  return useQuery({
    queryKey: ['tree-view', treeId, mode, lang, seeAsId],
    enabled: mode !== 'see_as' || seeAsId !== null,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api.post<TreeViewAnswer>('/tree-view', { tree_id: treeId, mode, lang, focus_person_id: seeAsId ?? undefined }),
  });
}
