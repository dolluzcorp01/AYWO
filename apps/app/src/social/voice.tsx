// Voice notes: record one press at a time, so nothing has to be held down, and a small player for each note.
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
} from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { SmallButton } from '@/components/ui';
import type { PickedFile } from '@/lib/api';
import { colors, fonts, minTapSize } from '@/theme/tokens';

const LONGEST_MS = 5 * 60_000;

function clock(ms: number): string {
  const total = Math.max(Math.round(ms / 1000), 0);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function voiceFile(uri: string): PickedFile {
  return Platform.OS === 'web'
    ? { uri, contentType: 'audio/webm', extension: 'webm' }
    : { uri, contentType: 'audio/mp4', extension: 'm4a' };
}

/** onDenied(true): the microphone was refused. onDenied(false): it was allowed, and recording still could not start. */
export function VoiceRecorder({ onDone, onCancel, onDenied }: { onDone: (file: PickedFile, ms: number) => void; onCancel: () => void; onDenied: (refused: boolean) => void }) {
  const { t } = useTranslation();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [ms, setMs] = useState(0);
  const [ready, setReady] = useState(false);
  const startedAt = useRef(0);
  // Send, Cancel and the 5 minute limit can all end the recording; only the first one counts.
  const finished = useRef(false);

  useEffect(() => {
    let live = true;
    // The microphone is handed back however the panel closes, also when the person leaves the chat mid-recording.
    const recordingOff = () => void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    (async () => {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!live) return;
      if (!permission.granted) {
        onDenied(true);
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (!live) {
        recordingOff();
        return;
      }
      await recorder.prepareToRecordAsync();
      if (!live) {
        recordingOff();
        return;
      }
      recorder.record();
      startedAt.current = Date.now();
      setReady(true);
    })().catch(() => {
      recordingOff();
      if (live) onDenied(false);
    });
    return () => {
      live = false;
      if (finished.current) return;
      finished.current = true;
      try {
        // The recorder may already be gone with the screen; then there is nothing to stop.
        void recorder.stop().catch(() => undefined);
      } catch {
        // Already released.
      }
      recordingOff();
    };
    // Starts once, when this panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finish(send: boolean) {
    if (finished.current) return;
    finished.current = true;
    const took = Date.now() - startedAt.current;
    await recorder.stop().catch(() => undefined);
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    if (send && recorder.uri) onDone(voiceFile(recorder.uri), took);
    else onCancel();
  }

  useEffect(() => {
    if (!ready) return undefined;
    const tick = setInterval(() => {
      const gone = Date.now() - startedAt.current;
      setMs(gone);
      if (gone >= LONGEST_MS) void finish(true);
    }, 500);
    return () => clearInterval(tick);
    // finish reads only refs and the recorder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return (
    <View style={styles.recorder}>
      <View style={styles.dot} />
      <Text accessibilityLiveRegion="polite" style={styles.time}>{ready ? t('social.chat.recording', { time: clock(ms) }) : t('social.loading')}</Text>
      <SmallButton label={t('social.cancel')} kind="plain" onPress={() => void finish(false)} />
      <SmallButton label={t('social.chat.sendVoice')} onPress={() => void finish(true)} disabled={!ready} />
    </View>
  );
}

export function VoicePlayer({ url, ms, onDark, onStale }: { url: string; ms?: number | null; onDark?: boolean; onStale?: () => void }) {
  const { t } = useTranslation();
  // The signed link changes each time the chat is fetched again. A note that is playing keeps its link until it stops:
  // changing it would start the note over, or cut it off.
  const [source, setSource] = useState(url);
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);
  const playing = status.playing;
  useEffect(() => {
    if (url !== source && !playing) setSource(url);
  }, [url, source, playing]);

  function toggle() {
    if (playing) {
      player.pause();
      return;
    }
    // Not loaded when Play is pressed usually means the link ran out: ask the chat for a new one.
    if (!status.isLoaded) onStale?.();
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) void player.seekTo(0);
    player.play();
  }

  const colour = onDark ? colors.white : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={playing ? t('social.chat.pauseVoice') : t('social.chat.playVoice')}
      onPress={toggle}
      style={styles.player}
    >
      <Text style={[styles.playMark, { color: colour }]}>{playing ? t('social.chat.pauseVoice') : t('social.chat.playVoice')}</Text>
      {ms ? <Text style={[styles.playTime, { color: colour }]}>{clock(ms)}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  recorder: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.alert },
  time: { flex: 1, minWidth: 90, color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  player: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: minTapSize },
  playMark: { fontFamily: fonts.extrabold, fontSize: 14 },
  playTime: { fontFamily: fonts.medium, fontSize: 13 },
});
