// What the person has agreed to (0019 my_consents): terms, privacy, the health card notice and marketing messages,
// with the history of every agreement and withdrawal.
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type ConsentKind = 'terms' | 'privacy' | 'health_card' | 'marketing';

export interface ConsentItem {
  kind: ConsentKind;
  /** The version agreed to; null when never given or withdrawn. */
  agreed_version: string | null;
  agreed_at: string | null;
  /** Health card only: a card is stored, and the agreement is to the notice shown now. */
  has_card?: boolean;
  current?: boolean;
}

export interface MyConsents {
  health_notice_version: string;
  items: ConsentItem[];
  history: {
    kind: ConsentKind | 'parental';
    version: string;
    action: 'granted' | 'withdrawn';
    at: string;
  }[];
}

export function useMyConsents() {
  return useQuery({
    queryKey: ['my-consents'],
    queryFn: () => api.rpc<MyConsents>('my_consents'),
  });
}

export function healthConsent(data: MyConsents | undefined): ConsentItem | undefined {
  return data?.items.find((i) => i.kind === 'health_card');
}
