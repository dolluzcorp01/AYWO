// The floating tab bar (Warm Daylight): Home, Family, the gold +, Chat, Me. Activity is the bell on Home.
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from '@/lib/router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { PlusIcon } from '@/components/Icons';
import { Bouncy, Pop } from '@/components/Motion';
import { Text } from '@/components/Text';
import { api } from '@/lib/api';
import { mainTree, useTrees } from '@/lib/account';
import { useDesktop } from '@/components/WebFrame';
import type { HomeCounts } from '@/social/types';
import { colors, fonts, gradients, minTapSize, shadows } from '@/theme/tokens';

const IDLE = colors.idleTab;

function HomeIcon({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 11l8-7 8 7v9H4z" />
      <Path d="M10 20v-6h4v6" />
    </Svg>
  );
}
function FamilyIcon({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round">
      <Circle cx={12} cy={5} r={2.5} />
      <Circle cx={6} cy={18} r={2.5} />
      <Circle cx={18} cy={18} r={2.5} />
      <Path d="M12 7.5v4M6 15.5v-2h12v2" />
    </Svg>
  );
}
function ChatIcon({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round">
      <Path d="M4 5h16v11H8l-4 4z" />
    </Svg>
  );
}
function MeIcon({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round">
      <Circle cx={12} cy={8} r={4} />
      <Path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </Svg>
  );
}

interface TabProps {
  label: string;
  active?: boolean;
  badge?: number;
  onPress: () => void;
  icon: (color: string) => ReactNode;
}

function Tab({ label, active, badge, onPress, icon }: TabProps) {
  const color = active ? colors.activeTab : IDLE;
  return (
    <Bouncy
      accessibilityRole="tab"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      onPress={onPress}
      to={0.9}
      style={styles.tab}
    >
      <View style={styles.iconBox}>
        {/* A soft mark under the tab you are on, so the place you are is seen at a glance and not only by colour. */}
        {active ? <Pop style={styles.here} /> : null}
        {/* In its own box so it is drawn over the mark, not under it. */}
        <View>{icon(color)}</View>
        {badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.tabText, { color }, active && styles.tabTextOn]}>{label}</Text>
    </Bouncy>
  );
}

interface TabBarProps {
  active: 'home' | 'family' | 'chat' | 'me' | 'activity' | 'none';
  /** The tree on screen, so Family and + stay in it. Without one they use the person's first tree. */
  treeId?: string;
  /** The person the gold + adds a relative to. */
  anchorId?: string | null;
}

export function TabBar({ active, treeId, anchorId }: TabBarProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const trees = useTrees();
  const counts = useQuery({ queryKey: ['social-home'], queryFn: () => api.rpc<HomeCounts>('social_home_counts'), refetchInterval: 60_000 });
  const target = treeId ?? mainTree(trees.data)?.id;
  // A computer shows the side menu instead.
  const desktop = useDesktop();

  function openFamily() {
    if (target) router.replace({ pathname: '/tree/[id]', params: { id: target } });
    else router.replace('/start');
  }

  function openAdd() {
    if (target) router.push({ pathname: '/add/[treeId]', params: { treeId: target, ...(anchorId ? { anchor: anchorId } : {}) } });
    else router.push('/start');
  }

  if (desktop) return null;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bar}>
        <Tab label={t('tabs.home')} active={active === 'home'} onPress={() => active !== 'home' && router.replace('/home')} icon={(c) => <HomeIcon color={c} />} />
        <Tab label={t('tabs.family')} active={active === 'family'} onPress={() => active !== 'family' && openFamily()} icon={(c) => <FamilyIcon color={c} />} />
        <View style={styles.tab}>
          <Bouncy accessibilityRole="button" accessibilityLabel={t('add.title')} onPress={openAdd} to={0.88} style={styles.fabGlow}>
            <LinearGradient colors={gradients.highlight} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fab}>
              <PlusIcon color={colors.text} size={24} width={2.6} />
            </LinearGradient>
          </Bouncy>
        </View>
        <Tab
          label={t('tabs.chat')}
          active={active === 'chat'}
          badge={counts.data?.unread_chats || undefined}
          onPress={() => active !== 'chat' && router.push('/social/chat')}
          icon={(c) => <ChatIcon color={c} />}
        />
        <Tab label={t('tabs.me')} active={active === 'me'} onPress={() => active !== 'me' && router.replace('/me')} icon={(c) => <MeIcon color={c} />} />
      </View>
    </View>
  );
}

export const TAB_BAR_SPACE = 108;

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, bottom: 18 },
  bar: {
    height: 68,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: colors.barEdge,
    backgroundColor: colors.card,
    ...shadows.raised,
  },
  tab: { flex: 1, minHeight: minTapSize, alignItems: 'center', justifyContent: 'center', gap: 2 },
  iconBox: { width: 52, height: 30, alignItems: 'center', justifyContent: 'center' },
  here: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 15, backgroundColor: colors.tint },
  // The gold + sits a little above the bar with a warm glow of its own colour.
  fabGlow: {
    borderRadius: 18,
    marginTop: -14,
    ...Platform.select({
      web: { boxShadow: '0 8px 18px rgba(253,142,73,0.38)' },
      default: { shadowColor: colors.logoOrange, shadowOpacity: 0.38, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
    }),
  },
  tabText: { fontFamily: fonts.semibold, fontSize: 11 },
  tabTextOn: { fontFamily: fonts.bold },
  fab: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: -5,
    end: -9,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.alert,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 11 },
});
