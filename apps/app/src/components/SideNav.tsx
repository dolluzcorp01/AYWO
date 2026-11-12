// The side menu on a computer, in place of the floating tab bar. Same places, plus the family areas Home links to.
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import type { Href } from 'expo-router';
import { usePathname, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { BellIcon, CalendarIcon, ChatIcon, FriendsIcon, InviteIcon, PartyIcon, PhotoIcon, PlusIcon, ShieldIcon, SignOutIcon } from '@/components/Icons';
import { ConfirmDialog } from '@/components/ui';
import { Text } from '@/components/Text';
import { api } from '@/lib/api';
import { mainTree, useMe, useTrees } from '@/lib/account';
import { logOut } from '@/lib/logout';
import { SosBar } from '@/ops/SosBar';
import type { HomeCounts } from '@/social/types';
import { useActivity } from '@/tree/useEdit';
import { colors, fonts, gradients } from '@/theme/tokens';

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

// Every item fits above the SOS button on a 900 px tall window; below SHORT the menu tightens again, so a
// 1366 x 768 laptop still shows all of it. SOS stays pinned at the bottom whatever the height.
const SHORT = 860;

function Item({ label, active, badge, onPress, icon, tight }: { label: string; active: boolean; badge?: number; onPress: () => void; icon: (c: string) => ReactNode; tight?: boolean }) {
  const color = active ? colors.logoIndigo : colors.muted;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      onPress={onPress}
      style={[styles.item, tight && styles.itemTight, active && styles.itemOn]}
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
  const tight = useWindowDimensions().height < SHORT;
  const me = useMe();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <View style={styles.nav}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.navInner, tight && styles.navInnerTight]}>
        <Pressable accessibilityRole="link" accessibilityLabel={t('tabs.home')} onPress={() => go('/home')} style={styles.logoLink}>
          {/* The image itself must not take the click (a browser starts dragging an image on press), so the link gets it. */}
          <Image source={require('../../assets/aywo_logo_app.png')} style={[styles.logo, tight && styles.logoTight, styles.noPointer]} resizeMode="contain" accessibilityLabel="AYWO" />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => (target ? router.push({ pathname: '/add/[treeId]', params: { treeId: target } }) : router.push('/start'))}
        >
          <LinearGradient colors={gradients.highlight} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.add, tight && styles.addTight]}>
            <PlusIcon color={colors.text} size={18} width={2.6} />
            <Text style={styles.addText}>{t('card.addRelative')}</Text>
          </LinearGradient>
        </Pressable>

        <Item tight={tight} label={t('tabs.home')} active={on('/home')} onPress={() => go('/home')} icon={(c) => <HomeIcon color={c} />} />
        <Item
          tight={tight}
          label={t('tabs.family')}
          active={on('/tree') || on('/person')}
          onPress={() => (target ? go({ pathname: '/tree/[id]', params: { id: target } }) : go('/start'))}
          icon={(c) => <FamilyIcon color={c} />}
        />
        <Item tight={tight} label={t('tabs.activity')} active={on('/activity')} badge={waiting} onPress={() => go('/activity')} icon={(c) => <BellIcon color={c} size={20} width={1.8} />} />

        <Text style={[styles.group, tight && styles.groupTight]}>{t('nav.together')}</Text>
        <Item tight={tight} label={t('social.home.chat')} active={on('/social/chat')} badge={counts.data?.unread_chats} onPress={() => go('/social/chat')} icon={(c) => <ChatIcon color={c} size={20} width={1.8} />} />
        <Item tight={tight} label={t('social.home.memories')} active={on('/social/memories')} onPress={() => go('/social/memories')} icon={(c) => <PhotoIcon color={c} size={20} width={1.8} />} />
        <Item tight={tight} label={t('social.home.invites')} active={on('/social/invites') || on('/social/pop')} badge={counts.data?.open_invites} onPress={() => go('/social/invites')} icon={(c) => <InviteIcon color={c} size={20} width={1.8} />} />
        <Item tight={tight} label={t('calendar.short')} active={on('/calendar')} onPress={() => go('/calendar')} icon={(c) => <CalendarIcon color={c} size={20} width={1.8} />} />
        <Item tight={tight} label={t('social.home.alerts')} active={on('/social/alerts')} badge={counts.data?.unseen_alerts} onPress={() => go('/social/alerts')} icon={(c) => <BellIcon color={c} size={20} width={1.8} />} />
        <Item tight={tight} label={t('social.home.groups')} active={on('/social/groups')} onPress={() => go('/social/groups')} icon={(c) => <FriendsIcon color={c} size={20} width={1.8} />} />
        <Item tight={tight} label={t('social.home.pop')} active={false} onPress={() => router.push('/social/pop/new')} icon={(c) => <PartyIcon color={c} size={20} width={1.8} />} />

        <Text style={[styles.group, tight && styles.groupTight]}>{t('nav.you')}</Text>
        <Item tight={tight} label={t('tabs.me')} active={on('/me') || on('/settings')} onPress={() => go('/me')} icon={(c) => <MeIcon color={c} />} />
        <Item tight={tight} label="AYWO Plus" active={on('/plus') || on('/family-plan')} onPress={() => go('/family-plan')} icon={(c) => <PlusIcon color={c} size={20} width={1.8} />} />
        <Item tight={tight} label={t('ops.nav.offers')} active={on('/offers') || on('/shop') || on('/orders')} onPress={() => go('/offers')} icon={(c) => <PartyIcon color={c} size={20} width={1.8} />} />
        <Item tight={tight} label={t('ops.nav.help')} active={on('/help')} onPress={() => go('/help')} icon={(c) => <ChatIcon color={c} size={20} width={1.8} />} />
        {/* Staff only: the way into the staff panel (it used to need typing /admin). */}
        {me.data?.admin_role ? (
          <Item tight={tight} label={t('nav.staffPanel')} active={on('/admin')} onPress={() => go('/admin')} icon={(c) => <ShieldIcon color={c} size={20} width={1.8} />} />
        ) : null}
        <Item tight={tight} label={t('settings.signOut')} active={false} onPress={() => setSigningOut(true)} icon={(c) => <SignOutIcon color={c} size={20} width={1.8} />} />
      </ScrollView>
      <ConfirmDialog
        visible={signingOut}
        title={t('nav.signOutTitle')}
        message={t('nav.signOutMessage')}
        confirmLabel={t('settings.signOut')}
        onConfirm={() => {
          setSigningOut(false);
          void logOut();
        }}
        onCancel={() => setSigningOut(false)}
      />
      <View style={styles.sos}>
        <SosBar compact />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { width: 256, backgroundColor: colors.card, borderRightWidth: 1, borderRightColor: colors.cardBorder, paddingBottom: 14 },
  scroll: { flex: 1 },
  navInner: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8, gap: 2 },
  navInnerTight: { paddingTop: 12, gap: 0 },
  logoLink: { alignSelf: 'flex-start' },
  noPointer: { pointerEvents: 'none' },
  logo: { height: 30, width: 104, marginBottom: 14, marginLeft: 6 },
  logoTight: { height: 26, marginBottom: 8 },
  add: { minHeight: 44, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 },
  addTight: { minHeight: 40, marginBottom: 6 },
  addText: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  group: { color: colors.muted, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 12, marginBottom: 2, marginLeft: 12 },
  groupTight: { marginTop: 8, marginBottom: 0 },
  // A mouse needs less room than a finger: 40 px rows on a computer (the phone tab bar keeps 44+).
  item: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, borderRadius: 12 },
  itemTight: { minHeight: 34 },
  itemOn: { backgroundColor: colors.tint },
  itemText: { flex: 1, color: colors.muted, fontFamily: fonts.semibold, fontSize: 15 },
  itemTextOn: { color: colors.logoIndigo, fontFamily: fonts.bold },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.alert, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 11 },
  sos: { marginHorizontal: 14, marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.cardBorder },
});
