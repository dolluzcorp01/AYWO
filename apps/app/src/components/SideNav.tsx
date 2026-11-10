// The side menu on a computer, in place of the floating tab bar. Same places, plus the family areas Home links to.
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import type { Href } from 'expo-router';
import { usePathname, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { BellIcon, ChatIcon, FriendsIcon, InviteIcon, PartyIcon, PhotoIcon, PlusIcon } from '@/components/Icons';
import { Text } from '@/components/Text';
import { api } from '@/lib/api';
import { mainTree, useTrees } from '@/lib/account';
import { SosBar } from '@/ops/SosBar';
import type { HomeCounts } from '@/social/types';
import { useActivity } from '@/tree/useEdit';
import { colors, fonts, gradients, minTapSize } from '@/theme/tokens';

function HomeIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 11l8-7 8 7v9H4z" />
      <Path d="M10 20v-6h4v6" />
    </Svg>
  );
}
function FamilyIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round">
      <Circle cx={12} cy={5} r={2.5} />
      <Circle cx={6} cy={18} r={2.5} />
      <Circle cx={18} cy={18} r={2.5} />
      <Path d="M12 7.5v4M6 15.5v-2h12v2" />
    </Svg>
  );
}
function MeIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round">
      <Circle cx={12} cy={8} r={4} />
      <Path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </Svg>
  );
}

function Item({ label, active, badge, onPress, icon }: { label: string; active: boolean; badge?: number; onPress: () => void; icon: (c: string) => ReactNode }) {
  const color = active ? colors.logoIndigo : colors.muted;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      onPress={onPress}
      style={[styles.item, active && styles.itemOn]}
    >
      {icon(color)}
      <Text style={[styles.itemText, active && styles.itemTextOn]}>{label}</Text>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function SideNav() {
  const { t } = useTranslation();
  const router = useRouter();
  const path = usePathname();
  const trees = useTrees();
  const counts = useQuery({ queryKey: ['social-home'], queryFn: () => api.rpc<HomeCounts>('social_home_counts'), refetchInterval: 60_000 });
  const needs = useActivity('needs_you');
  const target = mainTree(trees.data)?.id;
  const go = (href: Href) => router.replace(href);
  const on = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  const waiting = needs.data?.filter((item) => item.needs_you).length;

  return (
    <View style={styles.nav}>
      <ScrollView contentContainerStyle={styles.navInner}>
        <Image source={require('../../assets/aywo_logo_app.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="AYWO" />

        <Pressable
          accessibilityRole="button"
          onPress={() => (target ? router.push({ pathname: '/add/[treeId]', params: { treeId: target } }) : router.push('/start'))}
        >
          <LinearGradient colors={gradients.highlight} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.add}>
            <PlusIcon color={colors.text} size={18} width={2.6} />
            <Text style={styles.addText}>{t('card.addRelative')}</Text>
          </LinearGradient>
        </Pressable>

        <Item label={t('tabs.home')} active={on('/home')} onPress={() => go('/home')} icon={(c) => <HomeIcon color={c} />} />
        <Item
          label={t('tabs.family')}
          active={on('/tree') || on('/person')}
          onPress={() => (target ? go({ pathname: '/tree/[id]', params: { id: target } }) : go('/start'))}
          icon={(c) => <FamilyIcon color={c} />}
        />
        <Item label={t('tabs.activity')} active={on('/activity')} badge={waiting} onPress={() => go('/activity')} icon={(c) => <BellIcon color={c} size={20} width={1.8} />} />

        <Text style={styles.group}>{t('nav.together')}</Text>
        <Item label={t('social.home.chat')} active={on('/social/chat')} badge={counts.data?.unread_chats} onPress={() => go('/social/chat')} icon={(c) => <ChatIcon color={c} size={20} width={1.8} />} />
        <Item label={t('social.home.memories')} active={on('/social/memories')} onPress={() => go('/social/memories')} icon={(c) => <PhotoIcon color={c} size={20} width={1.8} />} />
        <Item label={t('social.home.invites')} active={on('/social/invites') || on('/social/pop')} badge={counts.data?.open_invites} onPress={() => go('/social/invites')} icon={(c) => <InviteIcon color={c} size={20} width={1.8} />} />
        <Item label={t('social.home.alerts')} active={on('/social/alerts')} badge={counts.data?.unseen_alerts} onPress={() => go('/social/alerts')} icon={(c) => <BellIcon color={c} size={20} width={1.8} />} />
        <Item label={t('social.home.groups')} active={on('/social/groups')} onPress={() => go('/social/groups')} icon={(c) => <FriendsIcon color={c} size={20} width={1.8} />} />
        <Item label={t('social.home.pop')} active={false} onPress={() => router.push('/social/pop/new')} icon={(c) => <PartyIcon color={c} size={20} width={1.8} />} />

        <Text style={styles.group}>{t('nav.you')}</Text>
        <Item label={t('tabs.me')} active={on('/me') || on('/settings')} onPress={() => go('/me')} icon={(c) => <MeIcon color={c} />} />
        <Item label="AYWO Plus" active={on('/plus') || on('/family-plan')} onPress={() => go('/family-plan')} icon={(c) => <PlusIcon color={c} size={20} width={1.8} />} />
        <Item label={t('ops.nav.offers')} active={on('/offers') || on('/shop') || on('/orders')} onPress={() => go('/offers')} icon={(c) => <PartyIcon color={c} size={20} width={1.8} />} />
        <Item label={t('ops.nav.help')} active={on('/help')} onPress={() => go('/help')} icon={(c) => <ChatIcon color={c} size={20} width={1.8} />} />
      </ScrollView>
      <View style={styles.sos}>
        <SosBar compact />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { width: 256, backgroundColor: colors.card, borderRightWidth: 1, borderRightColor: colors.cardBorder, paddingBottom: 18 },
  navInner: { padding: 18, gap: 4 },
  logo: { height: 30, width: 104, marginBottom: 18, marginLeft: 6 },
  add: { minHeight: 46, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 14 },
  addText: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  group: { color: colors.muted, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 16, marginBottom: 4, marginLeft: 12 },
  item: { minHeight: minTapSize, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, borderRadius: 12 },
  itemOn: { backgroundColor: colors.tint },
  itemText: { flex: 1, color: colors.muted, fontFamily: fonts.semibold, fontSize: 15 },
  itemTextOn: { color: colors.logoIndigo, fontFamily: fonts.bold },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.alert, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 11 },
  sos: { marginHorizontal: 14, marginTop: 8 },
});
