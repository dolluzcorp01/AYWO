// P5 SOS, free. Hold for 2 seconds and it starts at once: every contact with AYWO hears an alarm, the others get a text,
// and live location begins. Only then are the choices shown: call the first contact, call the emergency number, or stop.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { openDoNotDisturbAccess } from '@/pay/registerPush';
import { Text } from '@/components/Text';
import { Card, ConfirmDialog, ErrorText, Pills, SecondaryButton, SectionTitle, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { errorCode } from '@/lib/errors';
import { callNow, dialEmergency } from '@/social/call';
import { emergencyNumber } from '@/social/emergency';
import { ActionError, Gate, Note, Page, useName } from '@/social/parts';
import {
  locationPermissionNow,
  prepareLocationPermission,
  quickPlace,
  resumeSosTracking,
  startSosTracking,
  stopSosTracking,
} from '@/social/sosTask';
import type { SosActive, SosContact, SosStart } from '@/social/types';
import { colors, fonts, minTapSize } from '@/theme/tokens';

const HOLD_MS = 2_000;
const DURATIONS = ['30', '60', '120', '240'] as const;
type Duration = (typeof DURATIONS)[number];

function EmergencyButton() {
  const { t } = useTranslation();
  const number = emergencyNumber();
  return (
    <View style={styles.block}>
      <SecondaryButton label={t('social.sos.callEmergency', { number })} onPress={() => void dialEmergency(number)} />
      <Note>{t('social.sos.notEmergency')}</Note>
    </View>
  );
}

function Running({ active, callPhone, tracking, alerted, smsFailed, onStopped }: {
  active: SosActive;
  callPhone: string | null;
  tracking: string | null;
  alerted: { apps: number; texts: number } | null;
  smsFailed: number;
  onStopped: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(tick);
  }, []);
  const minutesLeft = Math.max(Math.ceil((new Date(active.ends_at).getTime() - now) / 60_000), 0);

  const stop = useMutation({
    mutationFn: async () => {
      await api.post(`/sos/${active.id}/stop`);
      await stopSosTracking();
    },
    onSuccess: onStopped,
    onSettled: () => setStopping(false),
  });

  return (
    <>
      <View style={styles.runningPanel} accessibilityRole="alert">
        <Text style={styles.runningTitle}>{t('social.sos.running')}</Text>
        {alerted ? <Text style={styles.runningText}>{t('social.sos.alerted', { apps: alerted.apps, texts: alerted.texts })}</Text> : null}
        <Text style={styles.runningText}>{t('social.sos.minutesLeft', { count: minutesLeft })}</Text>
      </View>
      {tracking === 'none' ? <ErrorText>{t('social.sos.noLocation')}</ErrorText> : null}
      {tracking === 'foreground' ? <Note>{t('social.sos.keepOpen')}</Note> : null}
      {smsFailed > 0 ? <ErrorText>{t('social.sos.smsFailed', { count: smsFailed })}</ErrorText> : null}
      {callPhone ? <SecondaryButton label={t('social.sos.callFirst')} onPress={() => void callNow(callPhone)} /> : null}
      <EmergencyButton />
      <TextButton label={t('social.sos.seeWhatTheySee')} onPress={() => router.push({ pathname: '/social/sos/watch/[id]', params: { id: active.id } })} />
      <Pressable accessibilityRole="button" onPress={() => setStopping(true)} style={styles.stop}>
        <Text style={styles.stopText}>{t('social.sos.stop')}</Text>
      </Pressable>
      <ActionError error={stop.error} />
      <ConfirmDialog
        visible={stopping}
        title={t('social.sos.stopTitle')}
        message={t('social.sos.stopBody')}
        confirmLabel={t('social.sos.stop')}
        busy={stop.isPending}
        onConfirm={() => stop.mutate()}
        onCancel={() => setStopping(false)}
      />
    </>
  );
}

export default function SosScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  // Held for 2 seconds on Home: start at once, without a second hold here.
  const { start: startNow } = useLocalSearchParams<{ start?: string }>();
  const autoStarted = useRef(false);
  const client = useQueryClient();
  const showName = useName();
  const [duration, setDuration] = useState<Duration>('60');
  const [holding, setHolding] = useState(false);
  const [alerted, setAlerted] = useState<{ apps: number; texts: number } | null>(null);
  const [callPhone, setCallPhone] = useState<string | null>(null);
  const [tracking, setTracking] = useState<string | null>(null);
  const [smsFailed, setSmsFailed] = useState(0);
  const [permission, setPermission] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const contacts = useQuery({ queryKey: ['sos-contacts'], queryFn: () => api.rpc<SosContact[]>('sos_contacts_list') });
  const active = useQuery({ queryKey: ['sos-active'], queryFn: () => api.rpc<SosActive | null>('sos_active') });

  useEffect(() => {
    void locationPermissionNow().then(setPermission);
  }, []);

  // Opened again during an SOS, perhaps after the app was closed: carry on sending location.
  const activeId = active.data?.id;
  useEffect(() => {
    if (activeId && tracking === null) void resumeSosTracking(activeId).then(setTracking);
  }, [activeId, tracking]);

  const start = useMutation({
    mutationFn: async () => {
      const place = await quickPlace();
      return api.post<SosStart>('/sos/start', { minutes: Number(duration), lat: place?.lat ?? null, lng: place?.lng ?? null });
    },
    onSuccess: (started) => {
      setCallPhone(started.call_phone);
      setSmsFailed(started.sms_failed);
      setAlerted({ apps: started.app_alarms, texts: started.sms_sent });
      client.invalidateQueries({ queryKey: ['sos-active'] });
      startSosTracking({ id: started.id, writeToken: started.write_token, endsAt: started.ends_at })
        .then(setTracking)
        .catch(() => setTracking('none'));
    },
    onError: (error) => {
      if (errorCode(error) === 'sos_already_active') client.invalidateQueries({ queryKey: ['sos-active'] });
    },
  });

  useEffect(() => {
    if (startNow !== '1' || autoStarted.current || !contacts.data || active.data === undefined) return;
    autoStarted.current = true;
    if (!active.data && contacts.data.length > 0) start.mutate();
    // start is stable for this screen; only the answers arriving matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNow, contacts.data, active.data]);

  function pressIn() {
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      setHolding(false);
      start.mutate();
    }, HOLD_MS);
  }

  function pressOut() {
    setHolding(false);
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }

  const list = contacts.data ?? [];
  const running = active.data;

  return (
    <Page title={t('social.sos.title')} subtitle={t('social.sos.subtitle')}>
      <Gate query={active}>
        {() =>
          running ? (
            <Running
              active={running}
              callPhone={callPhone ?? list[0]?.phone ?? null}
              tracking={tracking}
              alerted={alerted}
              smsFailed={smsFailed}
              onStopped={() => {
                setTracking(null);
                setCallPhone(null);
                setAlerted(null);
                setSmsFailed(0);
                client.invalidateQueries({ queryKey: ['sos-active'] });
              }}
            />
          ) : (
            <>
              {start.isPending ? (
                <View style={styles.countdown}>
                  <Text style={styles.runningTitle}>{t('social.sos.sending')}</Text>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('social.sos.holdLabel')}
                  accessibilityHint={t('social.sos.holdHint')}
                  disabled={list.length === 0}
                  accessibilityActions={[{ name: 'activate' }]}
                  onAccessibilityAction={() => start.mutate()}
                  onPressIn={pressIn}
                  onPressOut={pressOut}
                  style={[styles.hold, holding && styles.holdOn, list.length === 0 && styles.holdOff]}
                >
                  <Text style={styles.holdMark}>{t('social.sos.mark')}</Text>
                  <Text style={styles.runningText}>{holding ? t('social.sos.keepHolding') : t('social.sos.holdHint')}</Text>
                </Pressable>
              )}

              {start.isError ? (
                <>
                  <ActionError error={start.error} />
                  <SecondaryButton label={t('social.sos.tryAgain')} onPress={() => start.mutate()} />
                </>
              ) : null}

              <EmergencyButton />

              <Card style={styles.block}>
                <SectionTitle>{t('social.sos.contacts')}</SectionTitle>
                <ActionError error={contacts.error} />
                {list.length === 0 && !contacts.isError ? <Note>{t('social.sos.noContacts')}</Note> : null}
                {list.map((c, i) => (
                  <Text key={c.id} style={styles.contact}>
                    {i === 0 ? t('social.sos.firstContact', { name: showName(c.name || c.phone) }) : showName(c.name || c.phone)}
                  </Text>
                ))}
                <TextButton label={t('social.sos.chooseContacts')} onPress={() => router.push('/social/sos/contacts')} />
              </Card>

              <Card style={styles.block}>
                <SectionTitle>{t('ops.card.title')}</SectionTitle>
                <Note>{t('ops.card.sosNote')}</Note>
                <TextButton label={t('ops.card.open')} onPress={() => router.push('/social/sos/card')} />
              </Card>

              <Card style={styles.block}>
                <SectionTitle>{t('social.sos.shareFor')}</SectionTitle>
                <Pills
                  options={DURATIONS.map((d) => ({ value: d, label: t('social.sos.minutes', { count: Number(d) }) }))}
                  value={duration}
                  onChange={setDuration}
                />
              </Card>

              {Platform.OS === 'android' ? (
                <Card style={styles.block}>
                  <SectionTitle>{t('social.sos.silentTitle')}</SectionTitle>
                  <Note>{t('social.sos.silentBody')}</Note>
                  <TextButton label={t('social.sos.silentAction')} onPress={() => void openDoNotDisturbAccess()} />
                </Card>
              ) : null}

              {permission !== 'always' && Platform.OS !== 'web' ? (
                <Card style={styles.block}>
                  <SectionTitle>{t('social.sos.prepareTitle')}</SectionTitle>
                  <Note>{t('social.sos.prepareBody')}</Note>
                  <TextButton label={t('social.sos.prepareAction')} onPress={() => void prepareLocationPermission().then(setPermission)} />
                </Card>
              ) : null}
            </>
          )
        }
      </Gate>
    </Page>
  );
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  hold: {
    alignSelf: 'center',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.alert,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 6,
  },
  holdOn: { borderWidth: 6, borderColor: colors.logoYellow },
  holdOff: { opacity: 0.45 },
  holdMark: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 44, letterSpacing: 2 },
  countdown: { borderRadius: 24, backgroundColor: colors.alert, padding: 24, alignItems: 'center', gap: 8 },
  runningPanel: { borderRadius: 24, backgroundColor: colors.alert, padding: 22, gap: 4, alignItems: 'center' },
  runningTitle: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 22, textAlign: 'center' },
  runningText: { color: colors.white, fontFamily: fonts.semibold, fontSize: 14, textAlign: 'center' },
  stop: { minHeight: 56, minWidth: minTapSize, borderRadius: 28, backgroundColor: colors.logoIndigo, alignItems: 'center', justifyContent: 'center' },
  stopText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 16 },
  contact: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
});
