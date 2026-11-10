// Staff second sign-in step: set up an authenticator app once, then type its 6-digit code every 12 hours.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { PrimaryButton } from '@/components/ui';
import { api, saveStaffProof } from '@/lib/api';
import { colors, fonts, minTapSize } from '@/theme/tokens';
import { Message, SecondaryButton, useAction } from './ui';

function CodeBox({ value, onChange, onSubmit, label }: { value: string; onChange: (v: string) => void; onSubmit: () => void; label: string }) {
  return (
    <TextInput
      value={value}
      onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, 6))}
      onSubmitEditing={onSubmit}
      keyboardType="number-pad"
      autoComplete="one-time-code"
      textContentType="oneTimeCode"
      maxLength={6}
      placeholder="000000"
      placeholderTextColor={colors.muted}
      accessibilityLabel={label}
      style={styles.code}
    />
  );
}

/** Asks for today's code. onDone runs once the proof is saved. */
export function TwoStepCode({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const action = useAction();
  const submit = () =>
    code.length === 6 &&
    action.run(async () => {
      const answer = await api.post<{ proof: string }>('/admin/two-step/verify', { code });
      await saveStaffProof(answer.proof);
      onDone();
    });
  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>
          {t('admin.twoStep.codeTitle')}
        </Text>
        <Text style={styles.text}>{t('admin.twoStep.codeText')}</Text>
        <CodeBox value={code} onChange={setCode} onSubmit={submit} label={t('admin.twoStep.codeLabel')} />
        {action.failure ? <Message text={action.failure} alert /> : null}
        <PrimaryButton label={t('admin.twoStep.continue')} onPress={submit} disabled={code.length !== 6 || action.busy} />
        <Text style={styles.small}>{t('admin.twoStep.lost')}</Text>
      </View>
    </View>
  );
}

/** First time: shows the setup key, then checks one code from the app. */
export function TwoStepSetup({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const { t } = useTranslation();
  const [setup, setSetup] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [code, setCode] = useState('');
  const action = useAction();

  const start = () =>
    action.run(async () => {
      setSetup(await api.post<{ secret: string; otpauth_url: string }>('/admin/two-step/setup'));
    });
  const confirm = () =>
    code.length === 6 &&
    action.run(async () => {
      const answer = await api.post<{ proof: string }>('/admin/two-step/confirm', { code });
      await saveStaffProof(answer.proof);
      onDone();
    });

  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>
          {t('admin.twoStep.setupTitle')}
        </Text>
        <Text style={styles.text}>{t('admin.twoStep.setupText')}</Text>
        {setup ? (
          <>
            <Text style={styles.step}>{t('admin.twoStep.step1')}</Text>
            <Text selectable accessibilityLabel={t('admin.twoStep.keyLabel')} style={styles.secret}>
              {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
            </Text>
            {Platform.OS !== 'web' || /Mobi|Android/i.test(globalThis.navigator?.userAgent ?? '') ? (
              <SecondaryButton label={t('admin.twoStep.openApp')} onPress={() => Linking.openURL(setup.otpauth_url)} />
            ) : null}
            <Text style={styles.step}>{t('admin.twoStep.step2')}</Text>
            <CodeBox value={code} onChange={setCode} onSubmit={confirm} label={t('admin.twoStep.codeLabel')} />
            {action.failure ? <Message text={action.failure} alert /> : null}
            <PrimaryButton label={t('admin.twoStep.turnOn')} onPress={confirm} disabled={code.length !== 6 || action.busy} />
          </>
        ) : (
          <>
            {action.failure ? <Message text={action.failure} alert /> : null}
            <PrimaryButton label={t('admin.twoStep.begin')} onPress={start} disabled={action.busy} />
          </>
        )}
        {onCancel ? <SecondaryButton label={t('admin.common.cancel')} onPress={onCancel} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  card: { width: '100%', maxWidth: 460, gap: 14, padding: 28, borderRadius: 24, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 24, letterSpacing: -0.4 },
  text: { color: colors.muted, fontFamily: fonts.medium, fontSize: 15, lineHeight: 22 },
  step: { color: colors.text, fontFamily: fonts.bold, fontSize: 14, marginTop: 4 },
  small: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 },
  secret: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 18,
    letterSpacing: 1.5,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.background,
    textAlign: 'center',
  },
  code: {
    minHeight: minTapSize + 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    textAlign: 'center',
    color: colors.text,
    fontFamily: fonts.extrabold,
    fontSize: 28,
    letterSpacing: 10,
  },
});
