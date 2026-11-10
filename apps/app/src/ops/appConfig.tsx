// Settings staff change without a new release (admin App settings): forced update, maintenance, feature switches,
// what's new. Read from the public GET /config, so they work before sign-in too.
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Modal, Platform, StyleSheet, View } from 'react-native';
import { LogoMark } from '@/components/Loaders';
import { Text } from '@/components/Text';
import { PrimaryButton, SecondaryButton } from '@/components/ui';
import { API_URL, deviceStore } from '@/lib/api';
import { colors, fonts, radius } from '@/theme/tokens';

export interface AppConfig {
  min_version?: { ios?: string; android?: string };
  latest_version?: { ios?: string; android?: string };
  maintenance?: { on?: boolean; message?: string };
  features?: Record<string, boolean>;
  whats_new?: { version?: string; items?: string[] };
  support?: { hours?: string; email?: string };
}

const STORE_LINKS = {
  ios: 'https://apps.apple.com/app/idXXX',
  android: 'https://play.google.com/store/apps/details?id=in.aywo.app',
};
const SEEN_WHATS_NEW = 'aywo.whatsNewSeen';

/** Public, so a plain fetch: it must work signed out and must never trigger a session refresh. */
export function useAppConfig() {
  return useQuery({
    queryKey: ['app-config'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/config`);
      if (!response.ok) throw new Error('config');
      return (await response.json()) as AppConfig;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
}

/** A feature staff switched off disappears. Unknown or not yet loaded counts as on. */
export function useFeature(name: string): boolean {
  return useAppConfig().data?.features?.[name] !== false;
}

export function appVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

/** -1, 0 or 1, comparing 1.2.10 with 1.2.9 as numbers. */
export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

function Blocker({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <View style={styles.blocker} accessibilityViewIsModal>
      <View style={styles.card}>
        <LogoMark size={64} />
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <Text style={styles.text}>{text}</Text>
        {action}
      </View>
    </View>
  );
}

/**
 * Wraps the app. Phones below the minimum version must update; during maintenance everyone but staff sees the message.
 * Staff screens (the admin web app) are never blocked, so staff can switch maintenance off again.
 */
export function AppGate({ children, staffArea }: { children: ReactNode; staffArea: boolean }) {
  const { t } = useTranslation();
  const config = useAppConfig().data;
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;
  const min = platform ? config?.min_version?.[platform] : undefined;
  const latest = platform ? config?.latest_version?.[platform] : undefined;
  const mustUpdate = !!min && compareVersions(appVersion(), min) < 0;
  const mayUpdate = !mustUpdate && !!latest && compareVersions(appVersion(), latest) < 0;
  const [laterUpdate, setLaterUpdate] = useState(false);

  if (staffArea) return <>{children}</>;
  if (mustUpdate && platform) {
    return (
      <Blocker
        title={t('ops.update.mustTitle')}
        text={t('ops.update.mustText')}
        action={<PrimaryButton label={t('ops.update.button')} onPress={() => void Linking.openURL(STORE_LINKS[platform])} />}
      />
    );
  }
  if (config?.maintenance?.on) {
    return <Blocker title={t('ops.maintenance.title')} text={config.maintenance.message?.trim() || t('ops.maintenance.text')} />;
  }
  return (
    <>
      {children}
      {mayUpdate && platform && !laterUpdate ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setLaterUpdate(true)}>
          <View style={styles.scrim}>
            <View style={styles.card}>
              <Text accessibilityRole="header" style={styles.title}>{t('ops.update.mayTitle')}</Text>
              <Text style={styles.text}>{t('ops.update.mayText')}</Text>
              <PrimaryButton label={t('ops.update.button')} onPress={() => void Linking.openURL(STORE_LINKS[platform])} />
              <SecondaryButton label={t('ops.update.later')} onPress={() => setLaterUpdate(true)} />
            </View>
          </View>
        </Modal>
      ) : (
        <WhatsNew config={config} />
      )}
    </>
  );
}

/** Shown once after updating to the version staff wrote notes for. */
function WhatsNew({ config }: { config: AppConfig | undefined }) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const version = config?.whats_new?.version;
  const items = config?.whats_new?.items ?? [];
  useEffect(() => {
    if (!version || items.length === 0 || Platform.OS === 'web' || version !== appVersion()) return;
    void deviceStore.get(SEEN_WHATS_NEW).then((seen) => setShow(seen !== version));
  }, [version, items.length]);
  if (!show) return null;
  const close = () => {
    setShow(false);
    if (version) void deviceStore.set(SEEN_WHATS_NEW, version);
  };
  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>{t('ops.whatsNew.title')}</Text>
          {items.map((item) => (
            <Text key={item} style={styles.item}>• {item}</Text>
          ))}
          <PrimaryButton label={t('ops.whatsNew.ok')} onPress={close} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  blocker: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  scrim: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(29,26,58,0.45)' },
  card: { width: '100%', maxWidth: 420, gap: 14, padding: 26, borderRadius: radius.hero, backgroundColor: colors.card, alignItems: 'stretch' },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 24, letterSpacing: -0.5, textAlign: 'center' },
  text: { color: colors.muted, fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  item: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 },
});
