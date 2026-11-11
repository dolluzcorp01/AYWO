// Design tokens: "Warm Daylight", chosen by the founder on 3 Nov 2026 (Output\Style_Options, option B).
// A warm cream page, white cards with soft shadows, indigo for text and the main button, purple for what is active,
// gold and orange from the logo only for the + button and celebrations. Change only with the founder's approval.
import { Platform } from 'react-native';

export const colors = {
  background: '#FAF8F5',
  text: '#1D1A3A',
  muted: '#6B6784',
  card: '#FFFFFF',
  cardBorder: '#EEEAE3',
  white: '#FFFFFF',
  onNeon: '#DAD9F5',
  relation: '#7A1FC4',
  ask: '#A94A00',
  activeTab: '#2F3379',
  alert: '#E5383B',
  alertTint: '#FDEDED',
  logoPurple: '#8E26E1',
  logoIndigo: '#2F3379',
  logoYellow: '#FDD623',
  logoOrange: '#FD8E49',
  // Named so screens need no hex codes.
  tint: '#F4F0FA',
  idleTab: '#9A96AE',
  dashed: '#D9D3EA',
  checkboxOff: '#E4E0EC',
  whatsapp: '#0B8F4D',
  glass: 'rgba(255,255,255,.16)',
  scrim: 'rgba(29,26,58,.4)',
  barEdge: '#EEEAE3',
  line: '#D9D3EA',
};

export const gradients = {
  // Solid indigo: Warm Daylight keeps gradients for the logo, the + button and celebrations only.
  button: ['#2F3379', '#2F3379'],
  highlight: ['#FDD623', '#FD8E49'],
  // The few emphasis panels: deep indigo, flat.
  neon: ['#2F3379', '#262A66'],
  neonOutline: ['#2F3379', '#2F3379'],
  whatsapp: ['#0B8F4D', '#0A9E86'],
  merge: ['#FD8E49', '#8E26E1'],
} as const;

export const fonts = {
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
};

/** Soft indigo shadows: 'card' for content, 'raised' for the hero and the floating tab bar. */
export const shadows = {
  card: Platform.select({
    web: { boxShadow: '0 6px 18px rgba(47,51,121,0.06)' },
    default: { shadowColor: '#2F3379', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  }),
  raised: Platform.select({
    web: { boxShadow: '0 16px 40px rgba(47,51,121,0.10)' },
    default: { shadowColor: '#2F3379', shadowOpacity: 0.1, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 6 },
  }),
} as const;

export const radius = { card: 20, hero: 28, button: 16 };

export const minTapSize = 44;
export const largeTextScale = 1.3;
