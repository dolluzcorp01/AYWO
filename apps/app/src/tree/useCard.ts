import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContactAccess, ContactsAnswer } from '@aywo/shared';
import { api } from '@/lib/api';

export interface CardAnswer {
  access: ContactAccess;
  contacts: ContactsAnswer;
  ask_from: string | null;
  request_pending: boolean;
}

/** LLD S-07. Contact values, when allowed, come only through this server call. */
export function usePersonCard(personId: string) {
  return useQuery({
    queryKey: ['person-card', personId],
    queryFn: () => api.rpc<CardAnswer>('person_card', { p_person: personId }),
  });
}

export function useAskForContacts(personId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.rpc<string>('request_contacts', { p_person: personId }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['person-card', personId] }),
  });
}

/** D4. 'saved' changes the tree; 'requested' waits for the Creator. */
export function useSetElderYounger(treeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (answer: { personId: string; thanId: string; elder: boolean }) =>
      api.rpc<{ status: 'saved' | 'requested' }>('set_elder_younger', {
        p_person: answer.personId,
        p_than: answer.thanId,
        p_elder: answer.elder,
      }),
    onSuccess: (result) => {
      if (result.status === 'saved') client.invalidateQueries({ queryKey: ['tree-view', treeId] });
    },
  });
}
