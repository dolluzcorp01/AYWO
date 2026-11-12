// S-19 to S-21 frame. AYWO's own staff only, and only on the web. Sidebar shows what this person is granted,
// in groups that open and close, with the way back to the family app and sign out at the bottom.
import { useQuery } from '@tanstack/react-query';
import { Slot, usePathname, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { PageLoader } from '@/components/Loaders';
import { accessFrom, AdminAccessProvider, MENU } from '@/admin/access';
import '@/admin/i18n';
import { TwoStepCode, TwoStepSetup } from '@/admin/TwoStep';
import type { AdminMe } from '@/admin/types';
import { Avatar } from '@/components/Avatar';
import { SignOutIcon } from '@/components/Icons';
import { LogoLink } from '@/components/LogoLink';
import { ConfirmDialog, PrimaryButton } from '@/components/ui';
import { ADMIN_ICONS, backIcon, chevronDown, chevronRight, GROUP_ICONS } from '@/admin/icons';
import { useMe } from '@/lib/account';
import { logOut } from '@/lib/logout';
import { ApiFailure, api } from '@/lib/api';
import { colors, fonts, minTapSize } from '@/theme/tokens';

const NARROW = 820;
// Below this height the whole menu does not fit, so groups start closed.
const SHORT = 960;

function Refusal({ text, action }: { text: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.centre}>
      <Text accessibilityRole="alert" style={styles.refusal}>
        {text}
      </Text>
      {action ? <PrimaryButton label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <View style={styles.centre}>
      <PageLoader label={label} />
    </View>
  );
}

export default function AdminLayout() {
  const { t } = useTranslation();
  const router = useRouter();
  const isWeb = Platform.OS === 'web';

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ admin_role: string | null }>('/me'),
    enabled: isWeb,
    retry: false,
  });
  const isStaff = !!me.data?.admin_role;
  const adminMe = useQuery({
    queryKey: ['admin', 'me'],
    queryFn: () => api.get<AdminMe>('/admin/me'),
    enabled: isWeb && isStaff,
    retry: false,
  });
  const access = useMemo(() => (adminMe.data ? accessFrom(adminMe.data) : null), [adminMe.data]);

  if (!isWeb) return <Refusal text={t('admin.gate.webOnly')} action={{ label: t('admin.gate.goHome'), onPress: () => router.replace('/home') }} />;
  if (me.isError) {
    if (me.error instanceof ApiFailure && me.error.status === 401) {
      return <Refusal text={t('admin.gate.signIn')} action={{ label: t('admin.gate.signInButton'), onPress: () => router.replace({ pathname: '/phone', params: { next: '/admin' } }) }} />;
    }
    return <Refusal text={t('admin.common.failed')} action={{ label: t('admin.common.tryAgain'), onPress: () => me.refetch() }} />;
  }
  if (!me.data) return <Loading label={t('admin.common.loading')} />;

  const goHome = { label: t('admin.gate.goHome'), onPress: () => router.replace('/home') };
  if (!isStaff) return <Refusal text={t('admin.gate.notStaff')} action={goHome} />;
  if (adminMe.isError) {
    // The second sign-in step: set it up the first time, then a code every 12 hours.
    if (adminMe.error instanceof ApiFailure && adminMe.error.code === 'admin_two_step_setup') return <TwoStepSetup onDone={() => adminMe.refetch()} />;
    if (adminMe.error instanceof ApiFailure && adminMe.error.code === 'admin_two_step_required') return <TwoStepCode onDone={() => adminMe.refetch()} />;
    if (adminMe.error instanceof ApiFailure && adminMe.error.status === 403) return <Refusal text={t('admin.gate.notStaff')} action={goHome} />;
    return <Refusal text={t('admin.common.failed')} action={{ label: t('admin.common.tryAgain'), onPress: () => adminMe.refetch() }} />;
  }
  if (!access) return <Loading label={t('admin.common.loading')} />;

  return (
    <AdminAccessProvider value={access}>
      <Frame role={access.role} teamRole={access.team_role} openWork={access.open_work} can={access.can}>
        <Slot />
      </Frame>
    </AdminAccessProvider>
  );
}

type Group = (typeof MENU)[number]['group'];
const GROUPS: Group[] = ['work', 'people', 'business', 'system'];

/** One row of the admin menu. Hover shows it is clickable; the open page is highlighted. */
function NavRow({
  label,
  icon,
  active = false,
  onPress,
  badge,
  indent,
  trailing,
  role = 'link',
  expanded,
  heading,
}: {
  label: string;
  icon: (color: string) => ReactNode;
  active?: boolean;
  onPress: () => void;
  badge?: number;
  indent?: boolean;
  trailing?: (color: string) => ReactNode;
  role?: 'link' | 'button';
  expanded?: boolean;
  heading?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const color = active ? colors.logoIndigo : hover || heading ? colors.text : colors.muted;
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={role === 'link' ? { selected: active } : { expanded }}
      aria-expanded={heading ? expanded : undefined}
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={[styles.item, indent && styles.itemIndent, hover && !active && styles.itemHover, active && styles.itemOn]}
    >
      {icon(color)}
      <Text numberOfLines={1} style={[styles.itemText, { color }, heading && styles.itemTextHeading, active && styles.itemTextOn]}>
        {label}
      </Text>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
      {trailing ? trailing(color) : null}
    </Pressable>
  );
}

function Frame({
  role,
  teamRole,
  openWork,
  can,
  children,
}: {
  role: AdminMe['role'];
  teamRole: string | null;
  openWork: number;
  can: ReturnType<typeof accessFrom>['can'];
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { width, height } = useWindowDimensions();
  const narrow = width < NARROW;
  const me = useMe();
  const [signingOut, setSigningOut] = useState(false);
  const items = MENU.filter((item) => can(item.gates));
  const isOn = (item: (typeof MENU)[number]) => (item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(String(item.href)));
  const roleLabel = teamRole ?? t(`admin.roles.${role}`);

  // Every group starts open when the screen is tall enough to show them all; on a shorter screen only the group of
  // the open page does. A group the person closes stays closed, unless they open a page inside it.
  const activeGroup = items.find((item) => item.key !== 'dashboard' && isOn(item))?.group;
  const [closed, setClosed] = useState<Set<Group>>(() => new Set(height < SHORT ? GROUPS.filter((g) => g !== activeGroup) : []));
  useEffect(() => {
    if (!activeGroup) return;
    setClosed((now) => {
      if (!now.has(activeGroup)) return now;
      const next = new Set(now);
      next.delete(activeGroup);
      return next;
    });
  }, [activeGroup]);
  const toggle = (group: Group) =>
    setClosed((now) => {
      const next = new Set(now);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  const row = (item: (typeof MENU)[number], indent: boolean) => (
    <NavRow
      key={item.key}
      label={t(`admin.menu.${item.key}`)}
      icon={ADMIN_ICONS[item.key]}
      active={isOn(item)}
      indent={indent}
      badge={item.key === 'work' ? openWork : undefined}
      onPress={() => router.navigate(item.href)}
    />
  );
  const goHome = () => router.navigate('/home');
  const signOutDialog = (
    <ConfirmDialog
      visible={signingOut}
      title={t('nav.signOutTitle')}
      message={t('nav.signOutMessage')}
      confirmLabel={t('settings.signOut')}
      onConfirm={() => {
        setSigningOut(false);
        // Out of the admin panel too: back to the welcome screen, not a "sign in" notice on the same page.
        void logOut().then(() => router.replace('/'));
      }}
      onCancel={() => setSigningOut(false)}
    />
  );

  if (narrow) {
    return (
      <View style={[styles.shell, styles.shellNarrow]}>
        <View style={styles.barNarrow}>
          <View style={styles.topNarrow}>
            <LogoLink label={t('admin.menu.dashboard')} onPress={() => router.navigate('/admin')} height={26} width={90} />
            <Text style={styles.brandTitle}>{t('nav.adminPanel')}</Text>
            <View style={styles.spacer} />
            <NavRow label={t('nav.backToApp')} icon={backIcon} onPress={goHome} />
            <NavRow label={t('settings.signOut')} icon={(c) => <SignOutIcon color={c} size={18} width={1.8} />} role="button" onPress={() => setSigningOut(true)} />
          </View>
          <ScrollView horizontal contentContainerStyle={styles.menuNarrow}>
            {items.map((item) => row(item, false))}
          </ScrollView>
        </View>
        <View style={styles.main}>{children}</View>
        {signOutDialog}
      </View>
    );
  }

  return (
    <View style={styles.shell}>
      <View style={styles.bar}>
        <View style={styles.brand}>
          <LogoLink label={t('admin.menu.dashboard')} onPress={() => router.navigate('/admin')} />
          <Text style={styles.brandTitle}>{t('nav.adminPanel')}</Text>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.menu}>
          {items.filter((item) => item.key === 'dashboard').map((item) => row(item, false))}
          {GROUPS.map((group) => {
            const inGroup = items.filter((item) => item.group === group && item.key !== 'dashboard');
            if (!inGroup.length) return null;
            const open = !closed.has(group);
            return (
              <View key={group} style={styles.groupBox}>
                <NavRow
                  role="button"
                  heading
                  expanded={open}
                  label={t(`admin.menuGroup.${group}`)}
                  icon={GROUP_ICONS[group]}
                  onPress={() => toggle(group)}
                  trailing={(c) => (open ? chevronDown(c) : chevronRight(c))}
                />
                {open ? inGroup.map((item) => row(item, true)) : null}
              </View>
            );
          })}
        </ScrollView>
        <View style={styles.footer}>
          <NavRow label={t('nav.backToApp')} icon={backIcon} onPress={goHome} />
          <NavRow label={t('settings.signOut')} icon={(c) => <SignOutIcon color={c} size={18} width={1.8} />} role="button" onPress={() => setSigningOut(true)} />
          <View style={styles.account}>
            {me.data ? <Avatar personId={me.data.id} size={34} photoUrl={me.data.photo_url} name={me.data.display_name} /> : null}
            <View style={styles.accountText}>
              <Text numberOfLines={1} style={styles.accountName}>
                {me.data?.display_name ?? ''}
              </Text>
              <Text numberOfLines={1} style={styles.accountRole}>
                {roleLabel}
              </Text>
            </View>
          </View>
        </View>
      </View>
      <View style={styles.main}>{children}</View>
      {signOutDialog}
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24, backgroundColor: colors.background },
  refusal: { color: colors.text, fontFamily: fonts.semibold, fontSize: 16, textAlign: 'center', maxWidth: 480 },
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  shellNarrow: { flexDirection: 'column' },
  bar: { width: 256, paddingTop: 18, paddingHorizontal: 14, backgroundColor: colors.card, borderRightWidth: 1, borderRightColor: colors.cardBorder },
  barNarrow: { padding: 12, gap: 10, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  topNarrow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  spacer: { flex: 1 },
  brand: { gap: 6, paddingHorizontal: 8, paddingBottom: 10 },
  brandTitle: { color: colors.muted, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  scroll: { flex: 1 },
  menu: { gap: 1, paddingBottom: 10 },
  menuNarrow: { gap: 4 },
  groupBox: { gap: 1, marginTop: 4 },
  // 36 px rows: the whole menu fits a laptop screen without scrolling.
  item: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, borderRadius: 10 },
  itemIndent: { marginLeft: 18, paddingLeft: 10, borderLeftWidth: 0 },
  itemHover: { backgroundColor: colors.background },
  itemOn: { backgroundColor: colors.tint },
  itemText: { flex: 1, fontFamily: fonts.semibold, fontSize: 14 },
  itemTextHeading: { fontFamily: fonts.bold },
  itemTextOn: { color: colors.logoIndigo, fontFamily: fonts.bold },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.alert, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 11 },
  footer: { borderTopWidth: 1, borderTopColor: colors.cardBorder, paddingTop: 6, paddingBottom: 12, gap: 1 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingTop: 8, marginTop: 2, borderTopWidth: 1, borderTopColor: colors.cardBorder },
  accountText: { flex: 1, minWidth: 0 },
  accountName: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  accountRole: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  main: { flex: 1, minWidth: 0 },
});
