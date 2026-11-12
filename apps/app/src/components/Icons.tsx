// Line icons copied from the frozen wireframes.
import type { ReactNode } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { layoutIsRtl } from '@/i18n/rtl';

interface IconProps {
  color: string;
  size?: number;
  width?: number;
}

/** The shared line-icon frame, for icons kept next to the screens that use them. */
export function Icon({ color, size = 20, width = 2, mirror, children }: IconProps & { children: ReactNode; mirror?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} style={mirror && layoutIsRtl() ? { transform: [{ scaleX: -1 }] } : undefined}>
      {children}
    </Svg>
  );
}

/** An address-book card with a person: "Choose from contacts". */
export const ContactsIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z" />
    <Path d="M4 7h3M4 12h3M4 17h3" />
    <Circle cx={12.5} cy={10} r={2.5} />
    <Path d="M8.5 17c.7-2 2.2-3 4-3s3.3 1 4 3" />
  </Icon>
);
export const CloseIcon = (p: IconProps) => <Icon {...p}><Path d="M6 6l12 12M18 6L6 18" /></Icon>;
export const PlusIcon = (p: IconProps) => <Icon {...p}><Path d="M12 5v14M5 12h14" /></Icon>;
export const CheckIcon = (p: IconProps) => <Icon {...p}><Path d="M5 13l4 4L19 7" /></Icon>;
export const ChevronIcon = (p: IconProps) => <Icon {...p} mirror><Path d="M9 6l6 6-6 6" /></Icon>;
export const PencilIcon = (p: IconProps) => <Icon {...p}><Path d="M4 20l1-4L16 5l3 3L8 19z" /></Icon>;
export const CameraIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <Circle cx={12} cy={13} r={3.5} />
  </Icon>
);
export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx={11} cy={11} r={7} />
    <Path d="M20 20l-4-4" />
  </Icon>
);
export const ShareIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx={18} cy={5} r={2.5} />
    <Circle cx={6} cy={12} r={2.5} />
    <Circle cx={18} cy={19} r={2.5} />
    <Path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" />
  </Icon>
);
export const CommentIcon = (p: IconProps) => <Icon {...p}><Path d="M4 5h16v12H9l-5 4z" /></Icon>;
export const HistoryIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M4 12a8 8 0 1 0 2.5-5.8L4 8.5" />
    <Path d="M4 4v4.5h4.5M12 8v4.5l3 2" />
  </Icon>
);
export const DownloadIcon = (p: IconProps) => <Icon {...p}><Path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></Icon>;
export const LinkedPeopleIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx={12} cy={7} r={3} />
    <Path d="M12 10v5M7 20v-5h10v5" />
  </Icon>
);
export const RingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx={8} cy={12} r={5} />
    <Circle cx={16} cy={12} r={5} />
  </Icon>
);
export const ChatIcon = (p: IconProps) => <Icon {...p}><Path d="M4 5h16v11H8l-4 4z" /></Icon>;
export const PhotoIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z" />
    <Circle cx={9} cy={10} r={2} />
    <Path d="M21 16l-5-5-8 8" />
  </Icon>
);
export const InviteIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M5 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
    <Path d="M3 9l9 6 9-6M8 7V4h8v3" />
  </Icon>
);
export const BellIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z" />
    <Path d="M10 20a2 2 0 0 0 4 0" />
  </Icon>
);
export const FriendsIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx={9} cy={8} r={3.5} />
    <Path d="M2.5 20c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5" />
    <Path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.8 3 2.6 3.5 5.2" />
  </Icon>
);
/** A door with an arrow out: sign out. */
export const SignOutIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
    <Path d="M10 16l-4-4 4-4M6 12h10" />
  </Icon>
);

/** A shield: the admin panel. */
export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
  </Icon>
);

/** A microphone: speak instead of typing. */
export const MicIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z" />
    <Path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Icon>
);

/** A page of a wall calendar: the family calendar. */
export const CalendarIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
    <Path d="M3 10h18M8 3v4M16 3v4" />
  </Icon>
);
export const PartyIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M4 20l5-14 9 9z" />
    <Path d="M14 4l1 2M19 5l-2 2M20 10l-2-.5" />
  </Icon>
);
export const UpIcon =(p: IconProps) => <Icon {...p}><Path d="M12 20V5M6 11l6-6 6 6" /></Icon>;
export const DownIcon = (p: IconProps) => <Icon {...p}><Path d="M12 4v15M6 13l6 6 6-6" /></Icon>;
export const RightIcon = (p: IconProps) => <Icon {...p} mirror><Path d="M4 12h15M13 6l6 6-6 6" /></Icon>;
