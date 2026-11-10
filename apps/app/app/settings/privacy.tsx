// S-17 Privacy and account: take a copy of everything, sign out, read the legal pages, delete the account.
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, ConfirmDialog, ErrorText, Field, Muted, SecondaryButton, TextButton, TopBar } from '@/components/ui';
import { api, clearSession } from '@/lib/api';
import { errorCode, useErrorText } from '@/lib/errors';
import { logOut } from '@/lib/logout';
import { signOutOfStore } from '@/pay/store';
import { usePlan } from '@/pay/usePlan';
import { colors, fonts } from '@/theme/tokens';

export default function Privacy() {
  const { t } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const plan = usePlan();
  const [warning, setWarning] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [word, setWord] = useState('');
  const confirmWord = t('settings.deleteWord');

  const exportData = useMutation({
    mutationFn: () => api.post<{ url: string }>('/account/export'),
    onSuccess: (answer) => Linking.openURL(answer.url),
  });
  const remove = useMutation({
    mutationFn: (planAcknowledged: boolean) => api.post<unknown>('/account/delete', { plan_acknowledged: planAcknowledged }),
    onSuccess: async () => {
      await signOutOfStore().catch(() => undefined);
      await clearSession();
    },
    // The server has the last word: a plan this screen had not heard about yet still gets the warning.
    onError: (error) => {
      if (errorCode(error) === 'plan_cancel_first') setWarning(true);
    },
  });

  // Only the payer is charged, and a plan already cancelled just runs out on its own.
  const data = plan.data;
  const stillCharging = !!data?.is_payer && !!data.will_renew && (data.status === 'trial' || data.status === 'active' || data.status === 'grace');
  const inTheStore = data?.store === 'apple' || data?.store === 'google';

  function startDelete() {
    if (stillCharging && !acknowledged) setWarning(true);
    else setDeleting(true);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TopBar title={t('me.privacy')} onBack={() => goBack(router)} />

        <Card style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>{t('settings.exportTitle')}</Text>
          <Muted>{t('settings.exportHelp')}</Muted>
          <SecondaryButton label={t('settings.exportButton')} onPress={() => exportData.mutate()} disabled={exportData.isPending} />
          {exportData.isError ? <ErrorText>{errorText(exportData.error)}</ErrorText> : null}
        </Card>

        <SecondaryButton label={t('settings.signOut')} onPress={() => logOut()} />

        <Card style={styles.card}>
          <TextButton label={t('legal.termsLink')} onPress={() => router.push('/terms')} />
          <TextButton label={t('legal.privacyLink')} onPress={() => router.push('/privacy')} />
          <TextButton label={t('ops.me.blocked')} onPress={() => router.push('/settings/blocked')} />
        </Card>

        <Card style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>{t('settings.deleteTitle')}</Text>
          <Muted>{t('settings.deleteHelp')}</Muted>
          <TextButton label={t('settings.deleteButton')} onPress={startDelete} danger />
          {remove.isError && errorCode(remove.error) !== 'plan_cancel_first' ? <ErrorText>{errorText(remove.error)}</ErrorText> : null}
        </Card>
      </ScrollView>

      <ConfirmDialog
        visible={warning}
        title={t('settings.planWarningTitle')}
        message={t(inTheStore ? 'settings.planWarningStore' : 'settings.planWarningWeb')}
        confirmLabel={t('settings.planWarningGo')}
        onConfirm={() => {
          setWarning(false);
          router.push('/family-plan');
        }}
        onCancel={() => setWarning(false)}
      >
        <TextButton
          label={t('settings.planWarningDelete')}
          danger
          onPress={() => {
            setWarning(false);
            setAcknowledged(true);
            setDeleting(true);
          }}
        />
      </ConfirmDialog>

      <ConfirmDialog
        visible={deleting}
        title={t('settings.deleteConfirmTitle')}
        message={t('settings.deleteConfirmHelp', { word: confirmWord })}
        confirmLabel={t('settings.deleteButton')}
        danger
        busy={remove.isPending || word.trim().toLowerCase() !== confirmWord.toLowerCase()}
        onCancel={() => {
          setDeleting(false);
          setWord('');
        }}
        onConfirm={() => {
          setDeleting(false);
          remove.mutate(acknowledged);
        }}
      >
        <View style={styles.word}>
          <Field value={word} onChangeText={setWord} accessibilityLabel={t('settings.deleteConfirmHelp', { word: confirmWord })} autoCapitalize="none" autoCorrect={false} />
        </View>
      </ConfirmDialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 12, paddingBottom: 16 },
  card: { gap: 8 },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 16 },
  word: { marginVertical: 4 },
});
