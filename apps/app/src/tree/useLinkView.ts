import { useQuery } from '@tanstack/react-query';
import type { ApiTree, RelationInput } from '@aywo/layout';
import { api, hasSession } from '@/lib/api';

export interface OutsiderNode {
  id: string;
  name: string;
  nameUnknown: boolean;
  photoUrl: string | null;
}

export type LinkAnswer =
  | { mode: 'member'; tree_id: string }
  | (ApiTree<OutsiderNode> & {
      mode: 'outsider';
      tree_name: string;
      shared_by: string | null;
      labels?: Record<string, RelationInput>;
    });

/** LLD L5 no. 6. Works without signing in. Outsiders get names and photos only. */
export function useLinkView(token: string) {
  return useQuery({
    queryKey: ['link-view', token],
    retry: false,
    queryFn: async () => {
      // This route treats an expired token as a visitor and never answers 401, so family would get the outsider view.
      // Any signed-in call refreshes the session first.
      if (await hasSession()) await api.get('/me').catch(() => undefined);
      return api.get<LinkAnswer>(`/view-by-link/${encodeURIComponent(token)}`);
    },
  });
}
