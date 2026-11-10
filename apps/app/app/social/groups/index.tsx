// P2 friends groups: college and office gangs, as a circle of their own.
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { EmptyState, PrimaryButton } from '@/components/ui';
import { api } from '@/lib/api';
import { Gate, Page, Row } from '@/social/parts';
import type { GroupRow } from '@/social/types';

export default function Groups() {
  const { t } = useTranslation();
  const router = useRouter();
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.rpc<GroupRow[]>('group_list') });
  return (
    <Page title={t('social.groups.title')} subtitle={t('social.groups.subtitle')}>
      <PrimaryButton label={t('social.groups.new')} onPress={() => router.push('/social/groups/new')} />
      <Gate query={groups}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState message={t('social.groups.empty')} />
          ) : (
            <>
              {list.map((g) => (
                <Row
                  key={g.id}
                  title={g.name}
                  subtitle={t('social.groups.memberCount', { count: g.members })}
                  onPress={() => router.push({ pathname: '/social/groups/[id]', params: { id: g.id } })}
                />
              ))}
            </>
          )
        }
      </Gate>
    </Page>
  );
}
