// Crash reports, sent to AYWO's own server only (admin App health). No outside company gets them.
// The server removes numbers, emails and ids before saving. At most a few per session, so a loop cannot flood it.
import { router } from 'expo-router';
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { LogoMark } from '@/components/Loaders';
import { Text } from '@/components/Text';
import { PrimaryButton, SecondaryButton } from '@/components/ui';
import i18n from '@/i18n';
import { restartApp } from '@/i18n/rtl';
import { accessToken, API_URL } from '@/lib/api';
import { QUICK_TIMEOUT_MS, timedFetch } from '@/lib/timedFetch';
import { colors, fonts } from '@/theme/tokens';
import { appVersion } from './appConfig';
import { safeRoute } from './crashRoute';

const MAX_PER_SESSION = 8;
let sent = 0;
let currentRoute = '';

/** Kept without its secret parts (share, invite and group-join tokens), so a report can never carry one. */
export function setCrashRoute(route: string): void {
  currentRoute = safeRoute(route);
}

export async function reportCrash(error: unknown): Promise<void> {
  // Crashes while developing are seen on screen; only real apps report.
  if (sent >= MAX_PER_SESSION || process.env.NODE_ENV === 'development') return;
  sent += 1;
  const e = error instanceof Error ? error : new Error(String(error));
  try {
    const token = await accessToken();
    await timedFetch(
      `${API_URL}/client-errors`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web',
          app_version: appVersion(),
          route: currentRoute,
          message: `${e.name}: ${e.message}`.slice(0, 2000),
          stack: e.stack?.slice(0, 8000),
        }),
      },
      QUICK_TIMEOUT_MS,
    );
  } catch {
    // Reporting must never cause a second failure.
  }
}

/** Catches errors no screen handled: the phone's global handler, and the browser's. */
export function installCrashReporter(): void {
  const g = globalThis as unknown as {
    ErrorUtils?: { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void };
    addEventListener?: (name: string, handler: (event: { error?: unknown; reason?: unknown }) => void) => void;
  };
  if (g.ErrorUtils) {
    const previous = g.ErrorUtils.getGlobalHandler();
    g.ErrorUtils.setGlobalHandler((error, fatal) => {
      void reportCrash(error);
      previous(error, fatal);
    });
  }
  if (Platform.OS === 'web' && g.addEventListener) {
    g.addEventListener('error', (event) => void reportCrash(event.error));
    g.addEventListener('unhandledrejection', (event) => void reportCrash(event.reason));
  }
}

/**
 * A screen that crashed shows a calm message with a way out, instead of a blank screen.
 * A screen that crashes every time would crash again on "try again", so there are always two more ways out:
 * Home, and starting AYWO afresh. On the web both are real page loads, which cannot loop.
 */
export class CrashBoundary extends Component<{ children: ReactNode }, { failed: boolean; times: number; restartFailed: boolean }> {
  state = { failed: false, times: 0, restartFailed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.setState((old) => ({ times: old.times + 1 }));
    void reportCrash(error);
  }

  goHome = () => {
    if (Platform.OS === 'web') {
      globalThis.location?.assign('/home');
      return;
    }
    // Leave the broken screen first, then show the app again.
    try {
      router.replace('/home');
    } catch {
      // No navigator to ask: Restart below still works.
    }
    this.setState({ failed: false });
  };

  restart = () => {
    if (Platform.OS === 'web') {
      globalThis.location?.reload();
      return;
    }
    this.setState({ restartFailed: false });
    restartApp().catch(() => this.setState({ restartFailed: true }));
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.page}>
        <LogoMark size={64} />
        <Text accessibilityRole="header" style={styles.title}>{i18n.t('ops.crash.title')}</Text>
        <Text style={styles.text}>{i18n.t('ops.crash.text')}</Text>
        {this.state.times > 1 ? <Text style={styles.text}>{i18n.t('ops.crash.stuck')}</Text> : null}
        <View style={styles.actions}>
          <PrimaryButton label={i18n.t('ops.crash.again')} onPress={this.goHome} />
          <SecondaryButton label={i18n.t(Platform.OS === 'web' ? 'ops.crash.reload' : 'ops.crash.restart')} onPress={this.restart} />
        </View>
        {this.state.restartFailed ? <Text style={styles.text}>{i18n.t('ops.crash.restartFailed')}</Text> : null}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 28, backgroundColor: colors.background },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 24, textAlign: 'center' },
  text: { color: colors.muted, fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 380 },
  actions: { alignSelf: 'stretch', gap: 10, maxWidth: 380, width: '100%' },
});
