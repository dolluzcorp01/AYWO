// S-17 Notifications: push and email for each kind of message. The delivery job reads these (LLD L11).
// Emails go only to a confirmed address. Offers and news are off until the person switches them on (DPDP Act consent).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, ErrorText, Field, Loading, LoadFailed, SmallButton, Switch, TopBar } from '@/components/ui';
import { api } from '@/lib/api';
import { useMe } from '@/lib/account';
import type { MyExtras } from '@/ops/types';
import { useErrorText } from '@/lib/errors';
import { useNotificationPrefs, useSaveNotificationPref } from '@/tree/useEdit';
import type { NotificationPref } from '@/tree/useEdit';
import { colors, fonts } from '@/theme/tokens';

// A row exists only once changed, so unknown kinds show the database defaults: push and email on, SMS off.
const KINDS = ['request_created', 'request_decided', 'claim_made', 'comment_added', 'share_received', 'share_expired'];
const DEFAULT = { push: true, sms: false, email: true };

export default function Notifications() {
  const { t } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const prefs = useNotificationPrefs();
  const save = useSaveNotificationPref();
  const client = useQueryClient();
  const me = useMe();
  const extras = useQuery({ queryKey: ['my-extras'], queryFn: () => api.rpc<MyExtras>('my_extras') });
  const marketing = useMutation({
    mutationFn: (on: boolean) => api.rpc('marketing_set', { p_on: on }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['my-extras'] }),
  });
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const sendCode = useMutation({ mutationFn: () => api.post('/me/email/send-code'), onSuccess: () => setCodeSent(true) });
  const verify = useMutation({
    mutationFn: () => api.post('/me/email/verify', { code }),
    onSuccess: () => {
      setCode('');
      client.invalidateQueries({ queryKey: ['my-extras'] });
    },
  });
  const email = (me.data as { email?: string | null } | undefined)?.email ?? null;

  function prefFor(kind: string): NotificationPref {
    return prefs.data?.find((p) => p.kind === kind) ?? { kind, ...DEFAULT };
  }

  return (
    <Screen>
      <TopBar title={t('settings.notifications')} onBack={() => goBack(router)} />
      {prefs.isError ? (
        <LoadFailed message={errorText(prefs.error)} onRetry={() => prefs.refetch()} />
      ) : !prefs.data ? (
        <Loading label={t('tree.loading')} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {KINDS.map((kind) => {
            const pref = prefFor(kind);
            return (
              <Card key={kind} style={styles.card}>
                <Text accessibilityRole="header" style={styles.title}>{t(`settings.kind.${kind}`)}</Text>
                <View style={styles.switches}>
                  <Switch label={t('settings.push')} on={pref.push} onChange={(push) => save.mutate({ ...pref, push })} />
                  <Switch label={t('settings.email')} on={pref.email} onChange={(email) => save.mutate({ ...pref, email })} />
                </View>
              </Card>
            );
          })}
          {save.isError ? <ErrorText>{errorText(save.error)}</ErrorText> : null}

          <Card style={styles.card}>
            <Text accessibilityRole="header" style={styles.title}>{t('ops.prefs.offersTitle')}</Text>
            <Switch
              label={t('ops.prefs.offers')}
              help={t('ops.prefs.offersHelp')}
              on={!!extras.data?.marketing_opt_in}
              onChange={(on) => marketing.mutate(on)}
            />
            {marketing.isError ? <ErrorText>{errorText(marketing.error)}</ErrorText> : null}
          </Card>

          {email ? (
            <Card style={styles.card}>
              <Text accessibilityRole="header" style={styles.title}>{t('ops.prefs.emailTitle')}</Text>
              {extras.data?.email_verified ? (
                <Text style={styles.good}>{t('ops.prefs.emailOk', { email })}</Text>
              ) : (
                <>
                  <Text style={styles.text}>{t('ops.prefs.emailCheck', { email })}</Text>
                  {codeSent ? (
                    <>
                      <Field label={t('ops.prefs.code')} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" />
                      <View style={styles.row}>
                        <SmallButton label={t('ops.prefs.confirm')} disabled={code.length !== 6 || verify.isPending} onPress={() => verify.mutate()} />
                        <SmallButton kind="plain" label={t('ops.prefs.resend')} disabled={sendCode.isPending} onPress={() => sendCode.mutate()} />
                      </View>
                    </>
                  ) : (
                    <View style={styles.row}>
                      <SmallButton label={t('ops.prefs.sendCode')} disabled={sendCode.isPending} onPress={() => sendCode.mutate()} />
                    </View>
                  )}
                  {sendCode.isError ? <ErrorText>{errorText(sendCode.error)}</ErrorText> : null}
                  {verify.isError ? <ErrorText>{errorText(verify.error)}</ErrorText> : null}
                </>
              )}
            </Card>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 10, paddingVertical: 14 },
  card: { gap: 8 },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  switches: { gap: 8 },
  row: { flexDirection: 'row', gap: 10 },
  text: { color: colors.muted, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  good: { color: '#1F7A4D', fontFamily: fonts.bold, fontSize: 14 },
});
