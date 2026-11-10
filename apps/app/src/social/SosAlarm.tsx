// The alarm a family contact hears when an SOS arrives while AYWO is open: the alarm sound on repeat and vibration,
// until they say they have seen it or the SOS ends. On a closed phone the push itself rings (the 'sos-alarm' channel).
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useEffect } from 'react';
import { Platform, Vibration } from 'react-native';

const PATTERN = [0, 800, 400];

export function useSosAlarm(ringing: boolean): void {
  const player = useAudioPlayer(require('../../assets/sounds/sos_alarm.wav'));
  useEffect(() => {
    if (!ringing || Platform.OS === 'web') return undefined;
    let live = true;
    void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false })
      .catch(() => undefined)
      .then(() => {
        if (!live) return;
        player.loop = true;
        player.seekTo(0).catch(() => undefined);
        player.play();
      });
    Vibration.vibrate(PATTERN, true);
    return () => {
      live = false;
      player.pause();
      Vibration.cancel();
    };
  }, [ringing, player]);
}
