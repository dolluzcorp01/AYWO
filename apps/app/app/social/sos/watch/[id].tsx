// For a chosen contact, or the person themselves: where the person is now, refreshed every 15 seconds.
// Opened by an SOS that arrived while the app was open (alarm=1), it rings until the contact says they have seen it.
// The person's emergency card (blood group, allergies) shows here for the people the SOS reached.
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card, PrimaryButton, SecondaryButton, SectionTitle } from '@/components/ui';
import { api } from '@/lib/api';
import { dialEmergency } from '@/social/call';
import { useEmergencyNumber } from '@/social/emergency';
import { Gate, Note, Page, useName, useWhen } from '@/social/parts';
import { useSosAlarm } from '@/social/SosAlarm';
import type { EmergencyCard } from '@/ops/types';
import type { SosView } from '@/social/types';
import { colors, fonts } from '@/theme/tokens';
import { showToast } from '@/components/Toast';

const REFRESH_MS = 15_000;

export default function SosWatch() {
  const { id, alarm } = useLocalSearchParams<{ id: string; alarm?: string }>();
  const { t } = useTranslation();
  const when = useWhen();
  const showName = useName();
  const number = useEmergencyNumber();
  const [seen, setSeen] = useState(alarm !== '1');
  const view = useQuery({
    queryKey: ['sos-view', id],
    queryFn: () => api.rpc<SosView>('sos_view', { p_event: id }),
    refetchInterval: (query) => (query.state.data && !query.state.data.active ? false : REFRESH_MS),
  });
  // Rings for an SOS that is on, and while the first answer is still on its way. It does not ring when the SOS could
  // not be loaded (no connection, or not one of this person's), and stops when the SOS ends.
  const ringing = !seen && (view.data ? view.data.active : !view.isError);
  useSosAlarm(ringing);
  const card = useQuery({ queryKey: ['sos-card', id], queryFn: () => api.rpc<EmergencyCard | null>('sos_emergency_card', { p_event: id }) });

  return (
    <Page title={t('social.sos.watchTitle')}>
      {/* Outside the loading and error states: the alarm can always be silenced. */}
      {ringing ? <PrimaryButton label={t('social.sos.seenIt')} onPress={() => setSeen(true)} /> : null}
      <Gate query={view}>
        {(data) => (
          <>
            <View style={[styles.panel, !data.active && styles.ended]} accessibilityRole="alert">
              <Text style={styles.title}>
                {data.active ? t('social.sos.needsHelp', { name: showName(data.name) }) : t('social.sos.watchEnded', { name: showName(data.name) })}
              </Text>
              {data.last ? <Text style={styles.text}>{t('social.sos.lastPlace', { when: when(data.last.at) })}</Text> : null}
            </View>
            {/* First, because the alert says "please call now". */}
            {data.active && data.call_phone ? (
              <PrimaryButton label={t('social.sos.callThem', { name: showName(data.name) })} onPress={() => void dialEmergency(String(data.call_phone)).catch(() => showToast('error', t('social.sos.noDialler', { number: String(data.call_phone) })))} />
            ) : null}
            {data.last ? (
              <PrimaryButton
                label={t('social.sos.openMap')}
                onPress={() => void Linking.openURL(`https://www.google.com/maps?q=${data.last?.lat},${data.last?.lng}`)}
              />
            ) : (
              <Note>{t('social.sos.noPlaceYet')}</Note>
            )}
            {data.active ? <Note>{t('social.sos.watchEnds', { when: when(data.ends_at) })}</Note> : null}
            {card.data ? (
              <Card style={styles.card}>
                <SectionTitle>{t('ops.card.theirs', { name: showName(data.name) })}</SectionTitle>
                {card.data.blood_group ? <Text style={styles.fact}>{t('ops.card.blood')}: {card.data.blood_group}</Text> : null}
                {card.data.allergies ? <Text style={styles.fact}>{t('ops.card.allergies')}: {card.data.allergies}</Text> : null}
                {card.data.conditions ? <Text style={styles.fact}>{t('ops.card.conditions')}: {card.data.conditions}</Text> : null}
                {card.data.medications ? <Text style={styles.fact}>{t('ops.card.medications')}: {card.data.medications}</Text> : null}
                {card.data.note ? <Text style={styles.fact}>{card.data.note}</Text> : null}
              </Card>
            ) : null}
            <Note>{t('social.sos.deletedAfter')}</Note>
          </>
        )}
      </Gate>
      {/* Always there, also when the SOS could not be loaded. */}
      <SecondaryButton label={t('social.sos.callEmergency', { number })} onPress={() => void dialEmergency(number).catch(() => showToast('error', t('social.sos.noDialler', { number })))} />
      <Note>{t('social.sos.notEmergency')}</Note>
    </Page>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: 24, backgroundColor: colors.alert, padding: 22, gap: 6 },
  ended: { backgroundColor: colors.logoIndigo },
  title: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 22 },
  text: { color: colors.white, fontFamily: fonts.semibold, fontSize: 14 },
  card: { gap: 6 },
  fact: { color: colors.text, fontFamily: fonts.bold, fontSize: 15, lineHeight: 22 },
});
