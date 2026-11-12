// Pure helpers for voice typing: which speech language to ask for, and how spoken words join what is already typed.

/** The speech language for the app language. Indian languages and English use the India variant, so names and
 * accents are heard the Indian way ("ta" becomes "ta-IN", "en-US" becomes "en-IN"). */
export function speechLang(appLang: string): string {
  const base = (appLang || 'en').toLowerCase().split(/[-_]/)[0];
  const indian = ['en', 'ta', 'hi', 'te', 'kn', 'ml', 'mr', 'bn', 'gu', 'pa', 'or', 'ur', 'as'];
  if (indian.includes(base)) return `${base}-IN`;
  return appLang;
}

/** What was typed before the mic was tapped, plus what is being said. */
export function mergeSpoken(before: string, spoken: string): string {
  const said = spoken.trim();
  if (!said) return before;
  if (!before.trim()) return said;
  return /\s$/.test(before) ? before + said : `${before} ${said}`;
}

/** For a name box: each word starts with a capital (English speech often comes back in small letters). */
export function asName(text: string): string {
  return text.replace(/(^|\s)(\p{Ll})/gu, (_m, space: string, letter: string) => space + letter.toUpperCase());
}

export type VoiceProblem = 'denied' | 'noSpeech' | 'notAvailable' | 'network' | 'failed';

/** A speech error, as the message to show. Stopping on purpose is not a problem. */
export function problemFor(code: string): VoiceProblem | null {
  switch (code) {
    case 'aborted':
      return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return 'denied';
    case 'no-speech':
    case 'speech-timeout':
      return 'noSpeech';
    case 'language-not-supported':
      return 'notAvailable';
    case 'network':
      return 'network';
    default:
      return 'failed';
  }
}
