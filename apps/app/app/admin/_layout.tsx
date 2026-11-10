// S-19 to S-21 frame. AYWO's own staff only, and only on the web. Sidebar shows what this person is granted.
import { useQuery } from '@tanstack/react-query';
import { Slot, usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { PageLoader } from '@/components/Loaders';
import { accessFrom, AdminAccessProvider, MENU } from '@/admin/access';
import '@/admin/i18n';
import { TwoStepCode, TwoStepSetup } from '@/admin/TwoStep';
import type { AdminMe } from '@/admin/types';
import { PrimaryButton } from '@/components/ui';
import { ApiFailure, api } from '@/lib/api';
import { colors, fonts, minTapSize } from '@/theme/tokens';

const NARROW = 820;

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
  const { width } = useWindowDimensions();
  const narrow = width < NARROW;
  const items = MENU.filter((item) => can(item.gates));

  const menu = items.map((item, index) => {
    const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(String(item.href));
    const firstOfGroup = !narrow && index > 0 && items[index - 1].group !== item.group;
    return (
      <View key={item.key}>
        {firstOfGroup ? <Text style={styles.group}>{t(`admin.menuGroup.${item.group}`)}</Text> : null}
        <Pressable
          accessibilityRole="link"
          accessibilityState={{ selected: active }}
          accessibilityLabel={item.key === 'work' && openWork ? `${t('admin.menu.work')}, ${openWork}` : undefined}
          onPress={() => router.navigate(item.href)}
          style={[styles.item, active && styles.itemOn]}
        >
          <Text style={[styles.itemText, active && styles.itemTextOn]}>{t(`admin.menu.${item.key}`)}</Text>
          {item.key === 'work' && openWork ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{openWork > 99 ? '99+' : openWork}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
    );
  });

  return (
    <View style={[styles.shell, narrow && styles.shellNarrow]}>
      <View style={narrow ? styles.barNarrow : styles.bar}>
        <View style={styles.brand}>
          <Image source={require('../../assets/aywo_logo_app.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="AYWO" />
          <Text style={styles.brandRole}>{teamRole ?? t(`admin.roles.${role}`)}</Text>
        </View>
        {narrow ? (
          <ScrollView horizontal contentContainerStyle={styles.menuNarrow}>
            {menu}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.menu}>{menu}</ScrollView>
        )}
      </View>
      <View style={styles.main}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24, backgroundColor: colors.background },
  refusal: { color: colors.text, fontFamily: fonts.semibold, fontSize: 16, textAlign: 'center', maxWidth: 480 },
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  shellNarrow: { flexDirection: 'column' },
  bar: { width: 248, padding: 18, gap: 18, backgroundColor: colors.card, borderRightWidth: 1, borderRightColor: colors.cardBorder },
  barNarrow: { padding: 12, gap: 10, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  brand: { gap: 4, paddingHorizontal: 6 },
  logo: { height: 28, width: 96 },
  brandRole: { color: colors.muted, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.4 },
  menu: { gap: 2, paddingBottom: 18 },
  menuNarrow: { gap: 4 },
  group: { color: colors.muted, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 14, marginBottom: 4, marginLeft: 12 },
  item: { minHeight: minTapSize - 4, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12 },
  itemOn: { backgroundColor: colors.tint },
  itemText: { flex: 1, color: colors.muted, fontFamily: fonts.semibold, fontSize: 14 },
  itemTextOn: { color: colors.logoIndigo, fontFamily: fonts.bold },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.alert, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 11 },
  main: { flex: 1, minWidth: 0 },
});
