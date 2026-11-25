// P3 invites and Pop Parties: ones the caller is hosting and ones they are invited to.
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@/lib/router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { EmptyState, SectionTitle } from '@/components/ui';
import { api } from '@/lib/api';
import { EventTile, StartTiles } from '@/social/EventTile';
import { Gate, Page, useListSearch, useName } from '@/social/parts';
import type { EventRow } from '@/social/types';

export default function Invites() {
  const { t } = useTranslation();
  const router = useRouter();
  const showName = useName();
  const events = useQuery({ queryKey: ['events'], queryFn: () => api.rpc<EventRow[]>('event_list') });

  const search = useListSearch<EventRow>((e) => `${e.title} ${showName(e.host_name)}`);
  function sections(list: EventRow[]): { key: 'upcoming' | 'past' | 'cancelled'; rows: EventRow[] }[] {
    // Still "upcoming" for a few hours after it starts: the function is going on.
    const cutOff = Date.now() - 6 * 3_600_000;
    const time = (e: EventRow) => (e.starts_at ? Date.parse(e.starts_at) : Number.MAX_SAFE_INTEGER);
    const live = list.filter((e) => !e.cancelled);
    const all = [
      { key: 'upcoming' as const, rows: live.filter((e) => time(e) >= cutOff).sort((a, b) => time(a) - time(b)) },
      { key: 'past' as const, rows: live.filter((e) => time(e) < cutOff).sort((a, b) => time(b) - time(a)) },
      { key: 'cancelled' as const, rows: list.filter((e) => e.cancelled) },
    ];
    return all.filter((section) => section.rows.length > 0);
  }

  return (
    <Page title={t('social.invites.title')} subtitle={t('social.invites.subtitle')}>
      <StartTiles inviteLabel={t('social.invites.new')} popLabel={t('social.pop.new')} onInvite={() => router.push('/social/invites/new')} onPop={() => router.push('/social/pop/new')} />
      <Gate query={events}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState message={t('social.invites.empty')} />
          ) : (
            <>
              {search.box(list)}
              {search.nothing(list) ? <EmptyState message={t('search.nothing')} /> : null}
              {/* What is coming, soonest first; then what is over; cancelled ones last, out of the way. */}
              {sections(search.filter(list)).map((section) => (
                <View key={section.key} style={{ gap: 10 }}>
                  <SectionTitle>{t(`social.invites.sections.${section.key}`)}</SectionTitle>
                  {section.rows.map((e) => (
                    <EventTile key={e.id} event={e} onPress={() => router.push({ pathname: '/social/invites/[id]', params: { id: e.id } })} />
                  ))}
                </View>
              ))}
            </>
          )
        }
      </Gate>
    </Page>
  );
}
