// P3 invites and Pop Parties: ones the caller is hosting and ones they are invited to.
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { EmptyState, PrimaryButton, SecondaryButton } from '@/components/ui';
import { api } from '@/lib/api';
import { Gate, Page, Row, useName, useWhen } from '@/social/parts';
import type { EventRow } from '@/social/types';

export default function Invites() {
  const { t } = useTranslation();
  const router = useRouter();
  const when = useWhen();
  const showName = useName();
  const events = useQuery({ queryKey: ['events'], queryFn: () => api.rpc<EventRow[]>('event_list') });

  function line(e: EventRow): string {
    const parts = [
      e.is_mine ? t('social.invites.youHost') : t('social.invites.hostedBy', { name: showName(e.host_name) }),
      e.starts_at ? when(e.starts_at) : t('social.pop.stillDeciding'),
    ];
    if (e.cancelled) parts.push(t('social.invites.cancelled'));
    else if (!e.is_mine && !e.my_answer) parts.push(t('social.invites.waitingForYou'));
    return parts.join(' · ');
  }

  return (
    <Page title={t('social.invites.title')} subtitle={t('social.invites.subtitle')}>
      <PrimaryButton label={t('social.invites.new')} onPress={() => router.push('/social/invites/new')} />
      <SecondaryButton label={t('social.pop.new')} onPress={() => router.push('/social/pop/new')} />
      <Gate query={events}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState message={t('social.invites.empty')} />
          ) : (
            <>
              {list.map((e) => (
                <Row
                  key={e.id}
                  title={e.title}
                  subtitle={`${t(`social.invites.kinds.${e.kind}`)} · ${line(e)}`}
                  onPress={() => router.push({ pathname: '/social/invites/[id]', params: { id: e.id } })}
                />
              ))}
            </>
          )
        }
      </Gate>
    </Page>
  );
}
