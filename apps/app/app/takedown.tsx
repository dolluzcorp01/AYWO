// Public: someone added to a tree without asking can ask for it to be removed. No account needed.
// AYWO Admin decides (S-20). The route is rate limited and says nothing about whether a person exists.
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, ErrorText, Field, Muted, PrimaryButton, TextButton, TopBar } from '@/components/ui';
import { api } from '@/lib/api';
import { useErrorText } from '@/lib/errors';
import { colors, fonts } from '@/theme/tokens';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_CONTACT = 3;
const MIN_REASON = 10;

export default function Takedown() {
  const params = useLocalSearchParams<{ personId?: string }>();
  const personId = params.personId && UUID.test(params.personId) ? params.personId : null;
  const { t } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [reason, setReason] = useState('');

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const send = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean }>('/takedown', {
        ...(personId ? { person_id: personId } : {}),
        ...(name.trim() ? { subject_name: name.trim() } : {}),
        requester_contact: contact.trim(),
        reason: reason.trim(),
      }),
  });

  const ready = (!!personId || !!name.trim()) && contact.trim().length >= MIN_CONTACT && reason.trim().length >= MIN_REASON;

  if (send.isSuccess) {
    return (
      <Screen>
        <TopBar title={t('takedown.title')} onBack={close} />
        <View style={styles.done}>
          <Text accessibilityRole="alert" style={styles.doneText}>{t('takedown.done')}</Text>
          <TextButton label={t('common.done')} onPress={close} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TopBar title={t('takedown.title')} onBack={close} />
        <Muted>{t('takedown.explain')}</Muted>
        <Field
          label={personId ? t('takedown.nameOptional') : t('takedown.name')}
          value={name}
          onChangeText={setName}
          maxLength={200}
          autoCorrect={false}
        />
        <Field
          label={t('takedown.contact')}
          value={contact}
          onChangeText={setContact}
          maxLength={200}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Field label={t('takedown.reason')} value={reason} onChangeText={setReason} maxLength={2000} multiline style={styles.reason} />
        <Card>
          <Text style={styles.note}>{t('takedown.note')}</Text>
        </Card>
        {send.isError ? <ErrorText>{errorText(send.error)}</ErrorText> : null}
      </ScrollView>
      <PrimaryButton label={send.isPending ? t('takedown.sending') : t('takedown.send')} onPress={() => send.mutate()} disabled={!ready || send.isPending} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 12, paddingBottom: 12 },
  reason: { minHeight: 110, paddingTop: 12, textAlignVertical: 'top' },
  note: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  doneText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
