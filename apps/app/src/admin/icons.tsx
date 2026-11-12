// Line icons for the admin panel menu, one per page and one per group.
import type { ReactNode } from 'react';
import { Circle, Path } from 'react-native-svg';
import { Icon } from '@/components/Icons';

type Draw = (color: string) => ReactNode;
const line = (paths: ReactNode): Draw => (color) => <Icon color={color} size={18} width={1.8}>{paths}</Icon>;

export const ADMIN_ICONS: Record<string, Draw> = {
  dashboard: line(<><Path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" /></>),
  work: line(<><Path d="M4 13l2-8h12l2 8v6H4z" /><Path d="M4 13h5l1 2h4l1-2h5" /></>),
  tickets: line(<><Circle cx={12} cy={12} r={8} /><Path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5M12 16.5v.5" /></>),
  reports: line(<><Path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>),
  takedowns: line(<><Circle cx={12} cy={12} r={8} /><Path d="M6.5 6.5l11 11" /></>),
  dictionary: line(<><Path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><Path d="M5 17a3 3 0 0 1 3-3h10" /></>),
  users: line(<><Circle cx={12} cy={8} r={4} /><Path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>),
  trees: line(<><Circle cx={12} cy={5} r={2} /><Circle cx={6} cy={19} r={2} /><Circle cx={18} cy={19} r={2} /><Path d="M12 7v5M6 17v-2a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v2" /></>),
  orders: line(<><Path d="M5 8h14l-1 12H6z" /><Path d="M9 8V6a3 3 0 0 1 6 0v2" /></>),
  payments: line(<><Path d="M3 6h18v12H3z" /><Path d="M3 10h18M7 15h3" /></>),
  offers: line(<><Path d="M3 12V4h8l10 10-8 8z" /><Circle cx={7.5} cy={7.5} r={1.5} /></>),
  analytics: line(<><Path d="M4 20h16M7 16v-5M12 16V7M17 16v-8" /></>),
  settings: line(<><Circle cx={12} cy={12} r={3} /><Path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>),
  staff: line(<><Path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" /></>),
  broadcast: line(<><Path d="M4 10v4h3l7 4V6l-7 4z" /><Path d="M17 9a4 4 0 0 1 0 6" /></>),
  audit: line(<><Path d="M7 4h10v17H7z" /><Path d="M10 9h4M10 13h4M10 17h2" /></>),
};

export const GROUP_ICONS: Record<'work' | 'people' | 'business' | 'system', Draw> = {
  work: line(<><Path d="M4 8h16v11H4z" /><Path d="M9 8V5h6v3M4 13h16" /></>),
  people: line(<><Circle cx={9} cy={8} r={3.5} /><Path d="M3 20c1-3.5 3.5-5 6-5s5 1.5 6 5M16 4.5a3.5 3.5 0 0 1 0 7M18 15c1.5.7 2.5 2.4 3 5" /></>),
  business: line(<><Path d="M4 20h16M6 20V10M10 20V10M14 20V10M18 20V10M3 10l9-6 9 6z" /></>),
  system: ADMIN_ICONS.settings,
};

export const backIcon: Draw = line(<><Path d="M15 6l-6 6 6 6" /></>);
export const chevronDown: Draw = line(<><Path d="M6 9l6 6 6-6" /></>);
export const chevronRight: Draw = line(<><Path d="M9 6l6 6-6 6" /></>);
