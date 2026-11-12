// Speak instead of typing. Uses the phone's own speech recognition (Android, iPhone) or the browser's (Chrome, Edge,
// Safari), in the app's language: Tamil is heard as Tamil. Nothing is sent to AYWO; the words go straight into the box.
// Only one box listens at a time: the others ignore the speech events.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { showToast } from '@/components/Toast';
import { mergeSpoken, problemFor, speechLang } from '@/voice/speech';

type SpeechModule = typeof import('expo-speech-recognition').ExpoSpeechRecognitionModule;

// Loaded once. In Expo Go and other builds without the native part it is missing, and the mic simply does not show.
let speech: SpeechModule | null | undefined;
function module(): SpeechModule | null {
  if (speech !== undefined) return speech;
  try {
    speech = (require('expo-speech-recognition') as typeof import('expo-speech-recognition')).ExpoSpeechRecognitionModule;
    if (Platform.OS === 'web' && !speech.isRecognitionAvailable()) speech = null;
  } catch {
    speech = null;
  }
  return speech;
}

/** Whether this phone or browser can turn speech into text. */
export function voiceAvailable(): boolean {
  return module() !== null;
}

let nextOwner = 1;
let owner = 0;

export interface VoiceInput {
  available: boolean;
  listening: boolean;
  toggle: () => void;
}

/**
 * value: the text in the box now. onChange: called with the box's new text as words arrive.
 * long: keep listening through pauses (a message or a story); otherwise stop after one phrase (a name, a search).
 */
export function useVoiceInput(value: string, onChange: (text: string) => void, options: { long?: boolean; shape?: (text: string) => string } = {}): VoiceInput {
  const { t, i18n } = useTranslation();
  const [listening, setListening] = useState(false);
  const me = useRef(0);
  if (me.current === 0) me.current = nextOwner++;
  const before = useRef('');
  const latest = useRef({ onChange, shape: options.shape });
  latest.current = { onChange, shape: options.shape };

  useEffect(() => {
    const s = module();
    if (!s) return;
    const subs = [
      s.addListener('result', (event) => {
        if (owner !== me.current) return;
        const said = event.results[0]?.transcript ?? '';
        const text = mergeSpoken(before.current, said);
        latest.current.onChange(latest.current.shape ? latest.current.shape(text) : text);
        // A long text keeps going: what is final becomes part of "before" for the next phrase.
        if (event.isFinal && options.long) before.current = text;
      }),
      s.addListener('error', (event) => {
        if (owner !== me.current) return;
        const problem = problemFor(event.error);
        if (problem) showToast('error', t(`voice.${problem}`));
      }),
      s.addListener('end', () => {
        if (owner !== me.current) return;
        owner = 0;
        setListening(false);
      }),
    ];
    return () => {
      subs.forEach((sub) => sub.remove());
      // Leaving the screen while listening stops the mic.
      if (owner === me.current) {
        owner = 0;
        s.abort();
      }
    };
  }, [options.long, t]);

  async function start() {
    const s = module();
    if (!s) return;
    const permission = await s.requestPermissionsAsync();
    if (!permission.granted) {
      showToast('error', t('voice.denied'));
      return;
    }
    if (owner !== 0) s.abort();
    owner = me.current;
    before.current = value;
    setListening(true);
    s.start({
      lang: speechLang(i18n.language),
      interimResults: true,
      continuous: !!options.long,
      addsPunctuation: !!options.long,
    });
  }

  function stop() {
    module()?.stop();
  }

  return {
    available: voiceAvailable(),
    listening,
    toggle: () => (listening ? stop() : void start()),
  };
}
