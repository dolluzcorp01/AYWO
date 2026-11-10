// P4 alerts, free for everyone: ones received and ones sent. Opening this screen marks them as seen.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card, EmptyState, PrimaryButton } from '@/components/ui';
import { api } from '@/lib/api';
import { useTimeAgo } from '@/lib/time';
import { Gate, Note, Page, Row, useName } from '@/social/parts';
import type { AlertRow, HomeCounts } from '@/social/types';
import { colors, fonts } from '@/theme/tokens';

export default function Alerts() {
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const ago = useTimeAgo();
  const showName = useName();
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => api.rpc<AlertRow[]>('alerts_list') });
  const counts = useQuery({ queryKey: ['social-home'], queryFn: () => api.rpc<HomeCounts>('social_home_counts') });
  const markSeen = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api.rpc('alert_mark_seen', { p_alert: id }))),
    onSuccess: () => client.invalidateQueries({ queryKey: ['social-home'] }),
  });

  const unseen = (alerts.data ?? []).filter((a) => !a.seen).map((a) => a.id).join(',');
  useEffect(() => {
    if (unseen) markSeen.mutate(unseen.split(','));
    // Runs only when the list of unseen alerts changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseen]);

  return (
    <Page title={t('social.alerts.title')} subtitle={t('social.alerts.subtitle')}>
      {(counts.data?.incoming_sos ?? []).map((sos) => (
        <Row
          key={sos.id}
          urgent
          title={t('social.home.sosFrom', { name: showName(sos.name) })}
          onPress={() => router.push({ pathname: '/social/sos/watch/[id]', params: { id: sos.id } })}
        />
      ))}
      <PrimaryButton label={t('social.alerts.new')} onPress={() => router.push('/social/alerts/new')} />
      <Gate query={alerts}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState message={t('social.alerts.empty')} />
          ) : (
            <>
              {list.map((a) => (
                <Card key={a.id} style={styles.card}>
                  <View style={styles.top}>
                    <Text style={styles.kind}>{t(`social.alerts.kinds.${a.kind}`)}</Text>
                    {a.blood_group ? <Text style={styles.blood}>{t('social.alerts.bloodNeeded', { group: a.blood_group })}</Text> : null}
                  </View>
                  <Text style={styles.body}>{a.body}</Text>
                  <Note>
                    {a.is_mine
                      ? t('social.alerts.sentTo', { count: a.recipients ?? 0, when: ago(a.created_at) })
                      : t('social.alerts.from', { name: showName(a.sender_name), when: ago(a.created_at) })}
                  </Note>
                </Card>
              ))}
            </>
          )
        }
      </Gate>
    </Page>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6 },
  top: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  kind: { color: colors.alert, fontFamily: fonts.extrabold, fontSize: 14 },
  blood: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 14 },
  body: { color: colors.text, fontFamily: fonts.medium, fontSize: 15, lineHeight: 22 },
});
