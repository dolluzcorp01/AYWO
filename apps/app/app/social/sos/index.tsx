// P5 SOS, free. Hold for 2 seconds and it starts at once: every contact with AYWO hears an alarm, the others get a text,
// and live location begins. Only then are the choices shown: call the first contact, call the emergency number, or stop.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/lib/router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { openDoNotDisturbAccess } from '@/pay/registerPush';
import { Text } from '@/components/Text';
import { Card, ConfirmDialog, ErrorText, Loading, Pills, PrimaryButton, SecondaryButton, SectionTitle, TextButton } from '@/components/ui';
import { api, deviceStore } from '@/lib/api';
import { errorCode } from '@/lib/errors';
import { callNow, dialEmergency } from '@/social/call';
import { useEmergencyNumber } from '@/social/emergency';
import { ActionError, Note, Page, useName } from '@/social/parts';
import {
  locationPermissionNow,
  prepareLocationPermission,
  quickPlace,
  resumeSosTracking,
  startSosTracking,
  stopSosTracking,
} from '@/social/sosTask';
import { takeSosStart } from '@/social/sosStart';
import type { SosActive, SosContact, SosStart } from '@/social/types';
import { colors, fonts, minTapSize } from '@/theme/tokens';
import { showToast } from '@/components/Toast';

const HOLD_MS = 2_000;
// A weak network must not leave the person looking at "Alerting your contacts" for ever.
const START_TIMEOUT_MS = 20_000;
const PLACE_WAIT_MS = 1_500;
// While an SOS runs the server is asked again now and then, and more often once the time is up, so the screen goes
// back to normal by itself.
const CHECK_MS = 30_000;
const CHECK_AT_END_MS = 5_000;
const RESUME_AGAIN_MS = 15_000;
const DURATIONS = ['30', '60', '120', '240'] as const;
type Duration = (typeof DURATIONS)[number];
const SOS_MINUTES = 'aywo.sosMinutes';

class StartTimeout extends Error {}

function EmergencyButton() {
  const { t } = useTranslation();
  const number = useEmergencyNumber();
  return (
    <View style={styles.block}>
      <SecondaryButton label={t('social.sos.callEmergency', { number })} onPress={() => void dialEmergency(number).catch(() => showToast('error', t('social.sos.noDialler', { number })))} />
      <Note>{t('social.sos.notEmergency')}</Note>
    </View>
  );
}

function Running({ active, callPhone, tracking, locationWaiting, alerted, smsFailed, onStopped, onTimeUp, onTryLocation }: {
  active: SosActive;
  callPhone: string | null;
  tracking: string | null;
  locationWaiting: boolean;
  alerted: { apps: number; texts: number } | null;
  smsFailed: number;
  onStopped: () => void;
  onTimeUp: () => void;
  onTryLocation: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(tick);
  }, []);
  const msLeft = new Date(active.ends_at).getTime() - now;
  const minutesLeft = Math.max(Math.ceil(msLeft / 60_000), 0);
  const timeUp = msLeft <= 0;
  useEffect(() => {
    if (timeUp) onTimeUp();
    // Only the moment the time runs out matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp]);

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
        <Text style={styles.runningText}>{timeUp ? t('social.sos.timeUp') : t('social.sos.minutesLeft', { count: minutesLeft })}</Text>
      </View>
      {tracking === 'none' ? (
        <>
          <ErrorText>{t('social.sos.noLocation')}</ErrorText>
          <SecondaryButton label={t('social.sos.tryLocation')} onPress={onTryLocation} />
          {/* Once the phone has stopped asking, "try again" can do nothing: location has to be allowed in the phone's own settings. */}
          {Platform.OS !== 'web' ? (
            <>
              <Text style={styles.runningHelp}>{t('social.sos.locationSettingsHelp')}</Text>
              <SecondaryButton label={t('social.sos.openSettings')} onPress={() => void Linking.openSettings().catch(() => undefined)} />
            </>
          ) : null}
        </>
      ) : null}
      {tracking === null && locationWaiting ? <ErrorText>{t('social.sos.locationWaiting')}</ErrorText> : null}
      {tracking === 'foreground' ? <Note>{t('social.sos.keepOpen')}</Note> : null}
      {smsFailed > 0 ? <ErrorText>{t('social.sos.smsFailed', { count: smsFailed })}</ErrorText> : null}
      {callPhone ? <SecondaryButton label={t('social.sos.callFirst')} onPress={() => void callNow(callPhone).catch(() => showToast('error', t('social.sos.noDialler', { number: callPhone })))} /> : null}
      <EmergencyButton />
      <TextButton label={t('social.sos.seeWhatTheySee')} onPress={() => router.push({ pathname: '/social/sos/watch/[id]', params: { id: active.id } })} />
      <Pressable accessibilityRole="button" onPress={() => setStopping(true)} style={styles.stop}>
        <Text style={styles.stopText}>{t('social.sos.stop')}</Text>
      </Pressable>
      {stop.isError ? (
        <>
          <ActionError error={stop.error} />
          <Note>{t('social.sos.stopFailed')}</Note>
        </>
      ) : null}
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
  // Held for 2 seconds on Home: start at once, without a second hold here. Asked once, when the screen opens; a reload,
  // the back button or a link can never start an SOS.
  const startNow = useRef<boolean | null>(null);
  if (startNow.current === null) startNow.current = takeSosStart();
  const autoStarted = useRef(false);
  const client = useQueryClient();
  const showName = useName();
  // How long to share the place is remembered on this phone, so an SOS started from Home uses the same choice.
  const [duration, setDurationState] = useState<Duration>('60');
  const durationKnown = useRef<Promise<Duration>>(
    deviceStore
      .get(SOS_MINUTES)
      .then((saved) => (DURATIONS.find((d) => d === saved) ?? '60') as Duration)
      .catch(() => '60' as Duration),
  );
  const picked = useRef<Duration | null>(null);
  useEffect(() => {
    void durationKnown.current.then((saved) => {
      if (!picked.current) setDurationState(saved);
    });
  }, []);
  const setDuration = (value: Duration) => {
    picked.current = value;
    setDurationState(value);
    void deviceStore.set(SOS_MINUTES, value).catch(() => undefined);
  };
  const [holding, setHolding] = useState(false);
  const [alerted, setAlerted] = useState<{ apps: number; texts: number } | null>(null);
  const [callPhone, setCallPhone] = useState<string | null>(null);
  const [tracking, setTracking] = useState<string | null>(null);
  const [resumeFailed, setResumeFailed] = useState(false);
  const [resumeTry, setResumeTry] = useState(0);
  const [smsFailed, setSmsFailed] = useState(0);
  const [permission, setPermission] = useState<string | null>(null);
  const [needContacts, setNeedContacts] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const contacts = useQuery({ queryKey: ['sos-contacts'], queryFn: () => api.rpc<SosContact[]>('sos_contacts_list') });
  const active = useQuery({
    queryKey: ['sos-active'],
    queryFn: () => api.rpc<SosActive | null>('sos_active'),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      return new Date(data.ends_at).getTime() <= Date.now() ? CHECK_AT_END_MS : CHECK_MS;
    },
  });

  useEffect(() => {
    void locationPermissionNow().then(setPermission);
  }, []);

  // Leaving the screen in the middle of a hold must not start an SOS two seconds later.
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  // Opened again during an SOS, perhaps after the app was closed or on another phone: carry on sending location.
  // When the server cannot be reached for that, it says so and keeps trying.
  const activeId = active.data?.id;
  useEffect(() => {
    if (!activeId || tracking !== null) return undefined;
    let live = true;
    let again: ReturnType<typeof setTimeout> | undefined;
    resumeSosTracking(activeId).then(
      (how) => {
        if (!live) return;
        setResumeFailed(false);
        setTracking(how);
      },
      () => {
        if (!live) return;
        setResumeFailed(true);
        again = setTimeout(() => setResumeTry((n) => n + 1), RESUME_AGAIN_MS);
      },
    );
    return () => {
      live = false;
      if (again) clearTimeout(again);
    };
  }, [activeId, tracking, resumeTry]);

  // The server says no SOS of this person is on (stopped here, stopped on another phone, or the time ran out): the
  // screen goes back to normal, and this phone stops sending location.
  // Only an answer fetched since this screen opened counts: an old remembered answer must not turn location off.
  const noneActive = active.data === null && active.isFetchedAfterMount;
  function forgetRun() {
    setTracking(null);
    setResumeFailed(false);
    setCallPhone(null);
    setAlerted(null);
    setSmsFailed(0);
  }
  useEffect(() => {
    if (!noneActive) return;
    forgetRun();
    void stopSosTracking().catch(() => undefined);
  }, [noneActive]);
  const clearStartError = useRef<() => void>(() => undefined);

  function showStarted(started: SosStart) {
    setNeedContacts(false);
    setCallPhone(started.call_phone);
    setSmsFailed(started.sms_failed);
    setAlerted({ apps: started.app_alarms, texts: started.sms_sent });
    // The reply itself is proof that an SOS is on. If asking the server again fails, Stop must still be on screen.
    const on: SosActive = { id: started.id, started_at: new Date().toISOString(), ends_at: started.ends_at, last_at: null };
    client.setQueryData<SosActive | null>(['sos-active'], () => on);
    void client.invalidateQueries({ queryKey: ['sos-active'] });
  }

  const start = useMutation({
    mutationFn: async () => {
      const place = await Promise.race([
        quickPlace().catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), PLACE_WAIT_MS)),
      ]);
      // An SOS that starts as the screen opens must not go out before the saved choice has been read.
      const minutes = Number(picked.current ?? (await durationKnown.current));
      const request = api.post<SosStart>('/sos/start', { minutes, lat: place?.lat ?? null, lng: place?.lng ?? null });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tooLong = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StartTimeout()), START_TIMEOUT_MS);
      });
      try {
        return await Promise.race([request, tooLong]);
      } catch (error) {
        if (error instanceof StartTimeout) {
          // The reply may still arrive after the wait ran out: then the SOS is on, and the screen must show it.
          // Location starts through the resume step, with a new key from the server.
          request.then(
            (started) => {
              clearStartError.current();
              showStarted(started);
            },
            () => undefined,
          );
          void client.invalidateQueries({ queryKey: ['sos-active'] });
        }
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    onSuccess: (started) => {
      showStarted(started);
      startSosTracking({ id: started.id, writeToken: started.write_token, endsAt: started.ends_at })
        .then(setTracking)
        .catch(() => setTracking('none'));
    },
    onError: (error) => {
      if (errorCode(error) === 'sos_already_active') void client.invalidateQueries({ queryKey: ['sos-active'] });
    },
  });

  clearStartError.current = start.reset;

  const list = contacts.data ?? [];
  // Known to be empty. When the list could not be loaded the hold still works: the server has the real list.
  const noContacts = contacts.data !== undefined && contacts.data.length === 0;
  const running = active.data;
  const activeKnown = active.data !== undefined || active.isError;

  useEffect(() => {
    if (!startNow.current || autoStarted.current) return;
    if (!activeKnown || (!contacts.data && !contacts.isError)) return;
    autoStarted.current = true;
    if (active.data) return;
    if (noContacts) setNeedContacts(true);
    else start.mutate();
    // start is stable for this screen; only the answers arriving matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts.data, contacts.isError, active.data, activeKnown]);

  function pressIn() {
    if (noContacts) {
      setNeedContacts(true);
      return;
    }
    setHolding(true);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      setHolding(false);
      start.mutate();
    }, HOLD_MS);
  }

  function pressOut() {
    setHolding(false);
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }

  // A screen reader cannot hold a button, so its one tap asks first. An SOS never starts from a single tap.
  function askToStart() {
    if (noContacts) setNeedContacts(true);
    else setConfirmStart(true);
  }

  return (
    <Page title={t('social.sos.title')} subtitle={t('social.sos.subtitle')}>
      {!activeKnown ? (
        <>
          <Loading label={t('social.loading')} />
          <EmergencyButton />
        </>
      ) : running ? (
        <Running
          active={running}
          callPhone={callPhone ?? list[0]?.phone ?? null}
          tracking={tracking}
          locationWaiting={resumeFailed}
          alerted={alerted}
          smsFailed={smsFailed}
          onTimeUp={() => void client.invalidateQueries({ queryKey: ['sos-active'] })}
          onTryLocation={() => setTracking(null)}
          onStopped={() => {
            forgetRun();
            client.setQueryData<SosActive | null>(['sos-active'], () => null);
            void client.invalidateQueries({ queryKey: ['sos-active'] });
          }}
        />
      ) : (
        <>
          {active.isError && active.data === undefined ? (
            <>
              <ErrorText>{t('social.sos.cannotCheck')}</ErrorText>
              <TextButton label={t('social.sos.checkAgain')} disabled={active.isFetching} onPress={() => void active.refetch()} />
            </>
          ) : null}

          {start.isPending ? (
            <View style={styles.countdown} accessibilityRole="alert">
              <Text style={styles.runningTitle}>{t('social.sos.sending')}</Text>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('social.sos.holdLabel')}
              accessibilityHint={noContacts ? t('social.sos.noContacts') : t('social.sos.holdHint')}
              accessibilityActions={[{ name: 'activate' }]}
              onAccessibilityAction={askToStart}
              onPressIn={pressIn}
              onPressOut={pressOut}
              style={[styles.hold, holding && styles.holdOn, noContacts && styles.holdOff]}
            >
              <Text style={styles.holdMark}>{t('social.sos.mark')}</Text>
              <Text style={styles.runningText}>{holding ? t('social.sos.keepHolding') : t('social.sos.holdHint')}</Text>
            </Pressable>
          )}

          {noContacts && needContacts ? (
            <>
              <ErrorText>{t('social.sos.noContacts')}</ErrorText>
              <PrimaryButton label={t('social.sos.chooseContacts')} onPress={() => router.push('/social/sos/contacts')} />
            </>
          ) : null}

          {start.isError ? (
            <>
              {start.error instanceof StartTimeout ? (
                <ErrorText>{t('social.sos.startTimeout')}</ErrorText>
              ) : (
                <>
                  <ActionError error={start.error} />
                  <Note>{t('social.sos.startFailed')}</Note>
                </>
              )}
              <SecondaryButton label={t('social.sos.tryAgain')} onPress={() => start.mutate()} />
            </>
          ) : null}

          <EmergencyButton />

          <Card style={styles.block}>
            <SectionTitle>{t('social.sos.contacts')}</SectionTitle>
            {contacts.isError ? (
              <>
                <ActionError error={contacts.error} />
                <TextButton label={t('social.sos.tryAgain')} disabled={contacts.isFetching} onPress={() => void contacts.refetch()} />
              </>
            ) : null}
            {noContacts ? <Note>{t('social.sos.noContacts')}</Note> : null}
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
      )}
      <ConfirmDialog
        visible={confirmStart}
        title={t('social.sos.confirmStartTitle')}
        message={t('social.sos.confirmStartBody')}
        confirmLabel={t('social.sos.confirmStart')}
        danger
        onConfirm={() => {
          setConfirmStart(false);
          if (!running && !start.isPending) start.mutate();
        }}
        onCancel={() => setConfirmStart(false)}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  runningHelp: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
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
