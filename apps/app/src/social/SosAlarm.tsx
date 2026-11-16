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
        try {
          player.loop = true;
          player.seekTo(0).catch(() => undefined);
          player.play();
        } catch {
          // No sound is possible; the vibration still runs.
        }
      });
    Vibration.vibrate(PATTERN, true);
    return () => {
      live = false;
      // Vibration first: when the screen closes the player may already be gone, and pausing it then fails.
      Vibration.cancel();
      try {
        player.pause();
      } catch {
        // Already released with the screen: there is nothing left to stop.
      }
    };
  }, [ringing, player]);
}
