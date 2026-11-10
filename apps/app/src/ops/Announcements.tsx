// Banners staff write in admin Offers: a slim scrolling strip at the top of the app or the website, and offer cards on
// Home. Scrolling stops for people who asked their phone for less motion; then the banners take turns instead.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { useReducedMotion } from '@/components/Loaders';
import { Text } from '@/components/Text';
import { api, API_URL } from '@/lib/api';
import { colors, fonts, radius, shadows } from '@/theme/tokens';

export interface Banner {
  id: string;
  title: string;
  body: string | null;
  link_url: string | null;
  link_label: string | null;
  style: 'info' | 'offer' | 'celebration' | 'warning';
  dismissible: boolean;
}

const TONES: Record<Banner['style'], { bg: string; fg: string }> = {
  offer: { bg: colors.logoIndigo, fg: colors.white },
  info: { bg: colors.tint, fg: colors.text },
  celebration: { bg: '#FFF1E6', fg: colors.text },
  warning: { bg: '#FDECEC', fg: colors.alert },
};
const SPEED = 40; // points a second: slow enough to read.

function useOpenLink() {
  const router = useRouter();
  return (url: string | null) => {
    if (!url) return;
    if (url.startsWith('/')) router.push(url as Href);
    else if (url.startsWith('https://')) void Linking.openURL(url);
  };
}

/** One line that scrolls when it is longer than the space, and stands still when it fits. */
function Marquee({ text, color, still }: { text: string; color: string; still: boolean }) {
  const x = useRef(new Animated.Value(0)).current;
  const [box, setBox] = useState(0);
  const [line, setLine] = useState(0);
  const moves = !still && line > box && box > 0;
  useEffect(() => {
    if (!moves) {
      x.setValue(0);
      return;
    }
    const distance = line + 48;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(1200),
        Animated.timing(x, { toValue: -distance, duration: (distance / SPEED) * 1000, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(x, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [moves, line, x]);
  return (
    <View style={styles.marquee} onLayout={(e: LayoutChangeEvent) => setBox(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.track, { transform: [{ translateX: x }] }]}>
        {/* No line limit: the text keeps its full width on one line, so it can scroll instead of being cut. */}
        <Text style={[styles.line, { color }]} onLayout={(e: LayoutChangeEvent) => setLine(e.nativeEvent.layout.width)}>
          {text}
        </Text>
        {moves ? <Text style={[styles.line, styles.gap, { color }]}>{text}</Text> : null}
      </Animated.View>
    </View>
  );
}

function Strip({ items, onDismiss, onTap }: { items: Banner[]; onDismiss?: (b: Banner) => void; onTap: (b: Banner) => void }) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (items.length < 2) return;
    const turn = setInterval(() => setIndex((i) => (i + 1) % items.length), 9_000);
    return () => clearInterval(turn);
  }, [items.length]);
  const banner = items[index % items.length];
  if (!banner) return null;
  const tone = TONES[banner.style];
  return (
    <View style={[styles.strip, { backgroundColor: tone.bg }]} accessibilityRole="summary">
      <Pressable
        accessibilityRole={banner.link_url ? 'link' : 'text'}
        accessibilityLabel={banner.title}
        onPress={() => onTap(banner)}
        style={styles.stripTap}
      >
        <Marquee text={banner.link_label ? `${banner.title}  ·  ${banner.link_label}` : banner.title} color={tone.fg} still={reduced} />
      </Pressable>
      {banner.dismissible && onDismiss ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('ops.banner.close')} onPress={() => onDismiss(banner)} style={styles.close} hitSlop={10}>
          <Text style={[styles.closeText, { color: tone.fg }]}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** For signed-in screens. */
export function AnnouncementBar({ placement = 'app_banner' }: { placement?: 'app_banner' }) {
  const client = useQueryClient();
  const open = useOpenLink();
  const query = useQuery({
    queryKey: ['announcements', placement],
    queryFn: () => api.rpc<Banner[]>('announcements_for_me', { p_placement: placement }),
    staleTime: 5 * 60_000,
  });
  const items = query.data ?? [];
  if (items.length === 0) return null;
  return (
    <Strip
      items={items}
      onTap={(b) => {
        void api.rpc('announcement_event', { p_id: b.id, p_event: 'click' }).catch(() => undefined);
        open(b.link_url);
      }}
      onDismiss={(b) => {
        client.setQueryData<Banner[]>(['announcements', placement], (old) => (old ?? []).filter((x) => x.id !== b.id));
        void api.rpc('announcement_event', { p_id: b.id, p_event: 'dismiss' }).catch(() => undefined);
      }}
    />
  );
}

/** For the public website: no account, so nothing is recorded per person and nothing can be closed for good. */
export function PublicAnnouncementBar() {
  const open = useOpenLink();
  const [closed, setClosed] = useState<string[]>([]);
  const query = useQuery({
    queryKey: ['announcements', 'public'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/announcements/public`);
      return response.ok ? ((await response.json()) as Banner[]) : [];
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const items = (query.data ?? []).filter((b) => !closed.includes(b.id));
  if (items.length === 0) return null;
  return <Strip items={items} onTap={(b) => open(b.link_url)} onDismiss={(b) => setClosed((c) => [...c, b.id])} />;
}

/** Offer cards on Home. */
export function HomeOfferCards() {
  const open = useOpenLink();
  const query = useQuery({
    queryKey: ['announcements', 'home_card'],
    queryFn: () => api.rpc<Banner[]>('announcements_for_me', { p_placement: 'home_card' }),
    staleTime: 5 * 60_000,
  });
  return (
    <>
      {(query.data ?? []).slice(0, 2).map((b) => {
        const tone = TONES[b.style];
        return (
          <Pressable
            key={b.id}
            accessibilityRole={b.link_url ? 'link' : 'text'}
            onPress={() => {
              void api.rpc('announcement_event', { p_id: b.id, p_event: 'click' }).catch(() => undefined);
              open(b.link_url);
            }}
            style={[styles.card, { backgroundColor: tone.bg }]}
          >
            <Text style={[styles.cardTitle, { color: tone.fg }]}>{b.title}</Text>
            {b.body ? <Text style={[styles.cardBody, { color: tone.fg }]}>{b.body}</Text> : null}
            {b.link_label ? <Text style={[styles.cardLink, { color: tone.fg }]}>{b.link_label} ›</Text> : null}
          </Pressable>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  strip: { minHeight: 40, flexDirection: 'row', alignItems: 'center', borderRadius: 14, overflow: 'hidden' },
  stripTap: { flex: 1, minHeight: 40, justifyContent: 'center', paddingHorizontal: 14 },
  marquee: { overflow: 'hidden' },
  track: { flexDirection: 'row', alignSelf: 'flex-start' },
  // On the web a line also needs nowrap; phones keep a row child on one line by themselves.
  line: { fontFamily: fonts.bold, fontSize: 14, flexShrink: 0, ...(Platform.OS === 'web' ? ({ whiteSpace: 'nowrap' } as object) : {}) },
  gap: { marginLeft: 48 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 24 },
  card: { borderRadius: radius.card, padding: 18, gap: 6, ...shadows.card },
  cardTitle: { fontFamily: fonts.extrabold, fontSize: 17 },
  cardBody: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, opacity: 0.92 },
  cardLink: { fontFamily: fonts.bold, fontSize: 14, marginTop: 2 },
});
