// Invite and earn: a personal code to share. When someone new joins a family tree with it, both get 30 days of Plus.
// Someone new can also type the code of the person who invited them, within 14 days of joining.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card, Field, PrimaryButton, SectionTitle, SmallButton } from '@/components/ui';
import { api } from '@/lib/api';
import type { Referral } from '@/ops/types';
import { ActionError, Gate, Note, Page } from '@/social/parts';
import { colors, fonts, radius } from '@/theme/tokens';

const SITE = 'https://aywo.in';

export default function InviteFriends() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const mine = useQuery({ queryKey: ['referral'], queryFn: () => api.rpc<Referral>('referral_my') });
  const [copied, setCopied] = useState(false);
  const [theirs, setTheirs] = useState('');
  const claim = useMutation({
    mutationFn: () => api.rpc<{ by: string }>('referral_claim', { p_code: theirs.trim() }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['referral'] }),
  });

  return (
    <Page title={t('ops.refer.title')} subtitle={t('ops.refer.subtitle')}>
      <Gate query={mine}>
        {(data) => {
          const link = `${SITE}/?ref=${data.code}`;
          return (
            <>
              <View style={styles.hero}>
                <Text style={styles.heroLabel}>{t('ops.refer.yourCode')}</Text>
                <Text selectable style={styles.code}>{data.code}</Text>
                <View style={styles.actions}>
                  <SmallButton
                    kind="yellow"
                    label={t('ops.refer.share')}
                    onPress={() => void Share.share({ message: t('ops.refer.message', { code: data.code, link }) })}
                  />
                  <SmallButton
                    kind="plain"
                    label={copied ? t('ops.offers.copied') : t('ops.refer.copy')}
                    onPress={() => {
                      void Clipboard.setStringAsync(link);
                      setCopied(true);
                    }}
                  />
                </View>
              </View>
              <Card style={styles.block}>
                <SectionTitle>{t('ops.refer.how')}</SectionTitle>
                <Note>{t('ops.refer.step1')}</Note>
                <Note>{t('ops.refer.step2')}</Note>
                <Note>{t('ops.refer.step3', { days: data.reward_days })}</Note>
              </Card>
              <Card style={styles.block}>
                <SectionTitle>{t('ops.refer.sofar')}</SectionTitle>
                <Text style={styles.stat}>{t('ops.refer.joined', { count: data.joined })}</Text>
                <Text style={styles.stat}>{t('ops.refer.rewarded', { count: data.rewarded })}</Text>
                {data.bonus_until && new Date(data.bonus_until) > new Date() ? (
                  <Text style={styles.stat}>{t('ops.refer.freeUntil', { date: new Date(data.bonus_until).toLocaleDateString(i18n.language) })}</Text>
                ) : null}
              </Card>
              <Card style={styles.block}>
                <SectionTitle>{t('ops.refer.gotCode')}</SectionTitle>
                <Note>{t('ops.refer.gotCodeHelp')}</Note>
                {claim.isSuccess ? (
                  <Text style={styles.good}>{t('ops.refer.claimed', { name: claim.data?.by ?? '' })}</Text>
                ) : (
                  <>
                    <Field value={theirs} onChangeText={(v) => setTheirs(v.toUpperCase().replace(/[^A-Z0-9]/g, ''))} maxLength={12} accessibilityLabel={t('ops.refer.gotCode')} autoCapitalize="characters" />
                    <ActionError error={claim.error} />
                    <PrimaryButton label={t('ops.refer.claim')} disabled={theirs.length < 6 || claim.isPending} onPress={() => claim.mutate()} />
                  </>
                )}
              </Card>
              <Note>{t('ops.refer.fine')}</Note>
            </>
          );
        }}
      </Gate>
    </Page>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.hero, backgroundColor: colors.logoIndigo, padding: 22, gap: 8, alignItems: 'center' },
  heroLabel: { color: colors.logoYellow, fontFamily: fonts.extrabold, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  code: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 34, letterSpacing: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  block: { gap: 8 },
  stat: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  good: { color: '#1F7A4D', fontFamily: fonts.bold, fontSize: 15 },
});
