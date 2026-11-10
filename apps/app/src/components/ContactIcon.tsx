import type { ContactKind } from '@aywo/shared';
import Svg, { Path, Rect } from 'react-native-svg';
import { layoutIsRtl } from '@/i18n/rtl';

export function ContactIcon({ kind, color, size = 24 }: { kind: ContactKind; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      {kind === 'mobile' ? <Path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /> : null}
      {kind === 'whatsapp' ? <Path d="M4 20l1.5-4A8 8 0 1 1 8 19z" /> : null}
      {kind === 'email' ? (
        <>
          <Rect x={3} y={5} width={18} height={14} rx={2} />
          <Path d="M3 7l9 6 9-6" />
        </>
      ) : null}
    </Svg>
  );
}

export function LockIcon({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4}>
      <Rect x={5} y={11} width={14} height={10} rx={2} />
      <Path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Svg>
  );
}

export function BackIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} style={layoutIsRtl() ? { transform: [{ scaleX: -1 }] } : undefined}>
      <Path d="M15 18l-6-6 6-6" />
    </Svg>
  );
}
