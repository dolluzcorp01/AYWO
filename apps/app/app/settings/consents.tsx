// My consents: everything the person has agreed to, when, and how to take it back (DPDP Rules: withdrawing must be as
// easy as agreeing). Terms and privacy are needed to use AYWO, so withdrawing those means deleting the account; the
// health card and marketing messages can be withdrawn here in one tap. Below, the full history.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card, ConfirmDialog, SecondaryButton, SectionTitle, TextButton } from '@/components/ui';
import { PUBLISHER } from '@/legal/publisher';
import { api } from '@/lib/api';
import { useMyConsents } from '@/ops/consents';
import type { ConsentItem } from '@/ops/consents';
import type { MyExtras } from '@/ops/types';
import { ActionError, Gate, Note, Page } from '@/social/parts';
import { colors, fonts } from '@/theme/tokens';

export default function MyConsentsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const consents = useMyConsents();
  const extras = useQuery({ queryKey: ['my-extras'], queryFn: () => api.rpc<MyExtras>('my_extras') });
  const [withdrawing, setWithdrawing] = useState(false);
  const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

  const refresh = () => {
    client.invalidateQueries({ queryKey: ['my-consents'] });
    client.invalidateQueries({ queryKey: ['my-extras'] });
    client.invalidateQueries({ queryKey: ['emergency-card'] });
  };
  const withdrawHealth = useMutation({
    mutationFn: () => api.rpc('emergency_card_delete'),
    onSuccess: () => {
      setWithdrawing(false);
      refresh();
    },
  });
  const marketing = useMutation({ mutationFn: (on: boolean) => api.rpc('marketing_set', { p_on: on }), onSuccess: refresh });

  function status(item: ConsentItem) {
    if (!item.agreed_version) return t('ops.myConsents.notGiven');
    return t('ops.myConsents.agreedOn', { date: day(item.agreed_at), version: item.agreed_version });
  }

  return (
    <Page title={t('ops.myConsents.title')} subtitle={t('ops.myConsents.subtitle')}>
      <Gate query={consents}>
        {(data) => {
          const item = (kind: ConsentItem['kind']) => data.items.find((i) => i.kind === kind) as ConsentItem;
          const health = item('health_card');
          const marketingOn = extras.data?.marketing_opt_in ?? !!item('marketing').agreed_version;
          return (
            <>
              {(['terms', 'privacy'] as const).map((kind) => (
                <Card key={kind} style={styles.card}>
                  <Text style={styles.title}>{t(`ops.myConsents.${kind}`)}</Text>
                  <Text style={styles.status}>{status(item(kind))}</Text>
                  <Text style={styles.help}>{t('ops.myConsents.neededHelp')}</Text>
                  <View style={styles.actions}>
                    <TextButton label={t('ops.myConsents.read')} onPress={() => router.push(kind === 'terms' ? '/terms' : '/privacy')} />
                    <TextButton label={t('ops.myConsents.deleteAccount')} onPress={() => router.push('/settings/privacy')} />
                  </View>
                </Card>
              ))}

              <Card style={styles.card}>
                <Text style={styles.title}>{t('ops.myConsents.health_card')}</Text>
                <Text style={[styles.status, health.agreed_version && !health.current && styles.warn]}>
                  {health.agreed_version && !health.current ? t('ops.myConsents.olderNotice') : status(health)}
                </Text>
                <Text style={styles.help}>{t('ops.myConsents.healthHelp')}</Text>
                <View style={styles.actions}>
                  <SecondaryButton label={health.agreed_version ? t('ops.myConsents.openCard') : t('ops.myConsents.readAndAgree')} onPress={() => router.push('/social/sos/card')} />
                  {health.agreed_version || health.has_card ? <TextButton label={t('ops.consent.withdraw')} danger onPress={() => setWithdrawing(true)} /> : null}
                </View>
              </Card>

              <Card style={styles.card}>
                <Text style={styles.title}>{t('ops.myConsents.marketing')}</Text>
                <Text style={styles.status}>{marketingOn ? t('ops.myConsents.onSince', { date: day(item('marketing').agreed_at) }) : t('ops.myConsents.off')}</Text>
                <Text style={styles.help}>{t('ops.myConsents.marketingHelp')}</Text>
                <View style={styles.actions}>
                  <SecondaryButton
                    label={marketingOn ? t('ops.myConsents.turnOff') : t('ops.myConsents.turnOn')}
                    disabled={marketing.isPending}
                    onPress={() => marketing.mutate(!marketingOn)}
                  />
                </View>
              </Card>

              <ActionError error={withdrawHealth.error ?? marketing.error} />

              <SectionTitle>{t('ops.myConsents.history')}</SectionTitle>
              {data.history.length === 0 ? (
                <Note>{t('ops.myConsents.noHistory')}</Note>
              ) : (
                data.history.map((h, i) => (
                  <View key={i} style={styles.historyRow}>
                    <Text style={styles.historyDate}>{day(h.at)}</Text>
                    <Text style={styles.historyText}>
                      {t(`ops.myConsents.${h.action}`, { what: t(`ops.myConsents.${h.kind}`) })}
                      {h.kind === 'marketing' ? '' : ` (${h.version})`}
                    </Text>
                  </View>
                ))
              )}

              <Note>{t('ops.myConsents.complain', { ...PUBLISHER })}</Note>

              <ConfirmDialog
                visible={withdrawing}
                title={t('ops.consent.withdrawTitle')}
                message={t('ops.consent.withdrawMessage')}
                confirmLabel={t('ops.consent.withdrawConfirm')}
                danger
                busy={withdrawHealth.isPending}
                onConfirm={() => withdrawHealth.mutate()}
                onCancel={() => setWithdrawing(false)}
              />
            </>
          );
        }}
      </Gate>
    </Page>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6 },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 16 },
  status: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
  warn: { color: colors.alert },
  help: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 4 },
  historyRow: { flexDirection: 'row', gap: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  historyDate: { width: 100, color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  historyText: { flex: 1, color: colors.text, fontFamily: fonts.medium, fontSize: 14 },
});
