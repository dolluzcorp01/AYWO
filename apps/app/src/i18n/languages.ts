// LLD L12: English + 22 Indian + 20 global languages, with every script or regional variant. Codes match db/seed/languages.sql.
// Screens without a translation yet fall back to English; relationship words still follow the chosen code.

export interface LanguageVariant {
  code: string;
  /** Plain label for the script or region, shown in English until the locale files are generated. */
  label: string;
}

export interface Language {
  id: string;
  native: string;
  english: string;
  /** One entry: choose it straight away. Several: ask which one. */
  variants: LanguageVariant[];
}

export const languages: Language[] = [
  { id: 'en', native: 'English', english: 'English', variants: [{ code: 'en-US', label: 'United States' }, { code: 'en-GB', label: 'United Kingdom' }, { code: 'en-IN', label: 'India' }] },
  { id: 'as', native: 'অসমীয়া', english: 'Assamese', variants: [{ code: 'as', label: 'Assamese' }] },
  { id: 'bn', native: 'বাংলা', english: 'Bengali', variants: [{ code: 'bn', label: 'Bengali' }] },
  { id: 'brx', native: 'बड़ो', english: 'Bodo', variants: [{ code: 'brx', label: 'Bodo' }] },
  { id: 'doi', native: 'डोगरी', english: 'Dogri', variants: [{ code: 'doi', label: 'Dogri' }] },
  { id: 'gu', native: 'ગુજરાતી', english: 'Gujarati', variants: [{ code: 'gu', label: 'Gujarati' }] },
  { id: 'hi', native: 'हिन्दी', english: 'Hindi', variants: [{ code: 'hi', label: 'Hindi' }] },
  { id: 'kn', native: 'ಕನ್ನಡ', english: 'Kannada', variants: [{ code: 'kn', label: 'Kannada' }] },
  { id: 'ks', native: 'کٲشُر', english: 'Kashmiri', variants: [{ code: 'ks-Arab', label: 'Perso-Arabic script' }, { code: 'ks-Deva', label: 'Devanagari script' }] },
  { id: 'kok', native: 'कोंकणी', english: 'Konkani', variants: [{ code: 'kok-Deva', label: 'Devanagari script' }, { code: 'kok-Latn', label: 'Roman script (Goa)' }, { code: 'kok-Knda', label: 'Kannada script' }] },
  { id: 'mai', native: 'मैथिली', english: 'Maithili', variants: [{ code: 'mai-Deva', label: 'Devanagari script' }, { code: 'mai-Tirh', label: 'Tirhuta script' }] },
  { id: 'ml', native: 'മലയാളം', english: 'Malayalam', variants: [{ code: 'ml', label: 'Malayalam' }] },
  { id: 'mni', native: 'মৈতৈলোন্', english: 'Manipuri (Meitei)', variants: [{ code: 'mni-Mtei', label: 'Meetei Mayek script' }, { code: 'mni-Beng', label: 'Bengali script' }] },
  { id: 'mr', native: 'मराठी', english: 'Marathi', variants: [{ code: 'mr', label: 'Marathi' }] },
  { id: 'ne', native: 'नेपाली', english: 'Nepali', variants: [{ code: 'ne', label: 'Nepali' }] },
  { id: 'or', native: 'ଓଡ଼ିଆ', english: 'Odia', variants: [{ code: 'or', label: 'Odia' }] },
  { id: 'pa', native: 'ਪੰਜਾਬੀ', english: 'Punjabi', variants: [{ code: 'pa-Guru', label: 'Gurmukhi script' }, { code: 'pa-Arab', label: 'Shahmukhi script' }] },
  { id: 'sa', native: 'संस्कृतम्', english: 'Sanskrit', variants: [{ code: 'sa', label: 'Sanskrit' }] },
  { id: 'sat', native: 'ᱥᱟᱱᱛᱟᱞᱤ', english: 'Santali', variants: [{ code: 'sat-Olck', label: 'Ol Chiki script' }, { code: 'sat-Deva', label: 'Devanagari script' }] },
  { id: 'sd', native: 'سنڌي', english: 'Sindhi', variants: [{ code: 'sd-Arab', label: 'Perso-Arabic script' }, { code: 'sd-Deva', label: 'Devanagari script' }] },
  { id: 'ta', native: 'தமிழ்', english: 'Tamil', variants: [{ code: 'ta', label: 'Tamil' }] },
  { id: 'te', native: 'తెలుగు', english: 'Telugu', variants: [{ code: 'te', label: 'Telugu' }] },
  { id: 'ur', native: 'اردو', english: 'Urdu', variants: [{ code: 'ur', label: 'Urdu' }] },
  { id: 'es', native: 'Español', english: 'Spanish', variants: [{ code: 'es-ES', label: 'Spain' }, { code: 'es-419', label: 'Latin America' }] },
  { id: 'pt', native: 'Português', english: 'Portuguese', variants: [{ code: 'pt-BR', label: 'Brazil' }, { code: 'pt-PT', label: 'Portugal' }] },
  { id: 'fr', native: 'Français', english: 'French', variants: [{ code: 'fr-FR', label: 'France' }, { code: 'fr-CA', label: 'Canada' }] },
  { id: 'ar', native: 'العربية', english: 'Arabic', variants: [{ code: 'ar', label: 'Modern Standard Arabic' }] },
  { id: 'zh', native: '中文', english: 'Chinese', variants: [{ code: 'zh-Hans', label: 'Mandarin, Simplified (China, Singapore)' }, { code: 'zh-Hant-TW', label: 'Mandarin, Traditional (Taiwan)' }, { code: 'zh-Hant-HK', label: 'Traditional (Hong Kong)' }, { code: 'yue-Hant', label: 'Cantonese' }] },
  { id: 'ja', native: '日本語', english: 'Japanese', variants: [{ code: 'ja', label: 'Japanese' }] },
  { id: 'ms', native: 'Bahasa Melayu', english: 'Malay', variants: [{ code: 'ms-MY', label: 'Malaysia' }, { code: 'ms-SG', label: 'Singapore' }] },
  { id: 'it', native: 'Italiano', english: 'Italian', variants: [{ code: 'it', label: 'Italian' }] },
  { id: 'sv', native: 'Svenska', english: 'Swedish', variants: [{ code: 'sv', label: 'Swedish' }] },
  { id: 'ga', native: 'Gaeilge', english: 'Irish', variants: [{ code: 'ga', label: 'Irish (Gaelic)' }] },
  { id: 'de', native: 'Deutsch', english: 'German', variants: [{ code: 'de-DE', label: 'Germany' }, { code: 'de-AT', label: 'Austria' }, { code: 'de-CH', label: 'Switzerland' }] },
  { id: 'ru', native: 'Русский', english: 'Russian', variants: [{ code: 'ru', label: 'Russian' }] },
  { id: 'id', native: 'Bahasa Indonesia', english: 'Indonesian', variants: [{ code: 'id', label: 'Indonesian' }] },
  { id: 'sw', native: 'Kiswahili', english: 'Swahili', variants: [{ code: 'sw-KE', label: 'Kenya' }, { code: 'sw-TZ', label: 'Tanzania' }] },
  { id: 'si', native: 'සිංහල', english: 'Sinhala', variants: [{ code: 'si', label: 'Sinhala' }] },
  { id: 'ko', native: '한국어', english: 'Korean', variants: [{ code: 'ko', label: 'Korean' }] },
  { id: 'tr', native: 'Türkçe', english: 'Turkish', variants: [{ code: 'tr', label: 'Turkish' }] },
  { id: 'vi', native: 'Tiếng Việt', english: 'Vietnamese', variants: [{ code: 'vi', label: 'Vietnamese' }] },
  { id: 'th', native: 'ไทย', english: 'Thai', variants: [{ code: 'th', label: 'Thai' }] },
  { id: 'fil', native: 'Filipino', english: 'Filipino', variants: [{ code: 'fil', label: 'Filipino (Tagalog)' }] },
];

/** The chips on Welcome (wireframe Main): the rest sit behind '+ 37 more'. */
const FIRST_SCREEN = ['en', 'ta', 'hi', 'te', 'zh', 'es'];
export const firstScreenLanguages: Language[] = FIRST_SCREEN.map((id) => languages.find((l) => l.id === id) as Language);
export const moreLanguageCount = languages.length - FIRST_SCREEN.length;

export function languageOfCode(code: string): Language | undefined {
  return languages.find((l) => l.variants.some((v) => v.code === code));
}

export function languageLabel(code: string): string {
  const language = languageOfCode(code);
  if (!language) return code;
  const variant = language.variants.find((v) => v.code === code);
  return language.variants.length > 1 && variant ? `${language.native} · ${variant.label}` : language.native;
}

/** The phone's own language when AYWO has it, otherwise English (LLD L12). */
export function matchPhoneLanguage(tag: string | null | undefined, languageCode: string | null | undefined): string {
  if (tag) {
    for (const language of languages) {
      const exact = language.variants.find((v) => v.code === tag);
      if (exact) return exact.code;
    }
  }
  if (languageCode) {
    const language = languages.find((l) => l.id === languageCode);
    if (language) return language.variants[0].code;
  }
  return 'en-US';
}
