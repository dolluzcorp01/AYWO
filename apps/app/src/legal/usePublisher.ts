// The company and contact details on the public pages, as staff last saved them (Admin > App settings > Company
// details). Anything staff left empty, and everything while the settings cannot be loaded, comes from publisher.ts.
import { LEGAL_DRAFT, PUBLISHER } from '@/legal/publisher';
import { useAppConfig } from '@/ops/appConfig';

export type PublisherWords = typeof PUBLISHER;

export function usePublisher(): { words: PublisherWords; draft: boolean } {
  const saved = useAppConfig().data?.publisher;
  const words: Record<string, string> = { ...PUBLISHER };
  for (const key of Object.keys(PUBLISHER)) {
    const value = saved?.[key];
    if (typeof value === 'string' && value.trim()) words[key] = value.trim();
  }
  return { words: words as PublisherWords, draft: typeof saved?.draft === 'boolean' ? saved.draft : LEGAL_DRAFT };
}
