import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { QueryClientProvider } from '@tanstack/react-query';
import type { Href } from 'expo-router';
import { Stack, usePathname, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import '@/i18n';
// F-SOS-03: the background location task must be defined whenever the app starts, even if the system starts it just for this.
import '@/social/sosTask';
import { Launch } from '@/components/Launch';
import { WebFrame } from '@/components/WebFrame';
import { RestartPrompt } from '@/i18n/RestartPrompt';
import { ToastHost } from '@/components/Toast';
import { safeNext } from '@/lib/account';
import { api, deviceStore, hasSession, onSessionChange } from '@/lib/api';
import { loadPrefs } from '@/lib/prefs';
import { makeClient } from '@/lib/queryClient';
import { AppGate } from '@/ops/appConfig';
import { CrashBoundary, installCrashReporter, setCrashRoute } from '@/ops/crash';
import { listenForPushTaps } from '@/pay/registerPush';

installCrashReporter();

// A link like aywo.in/?ref=CODE remembers who invited this person, and says so once they have an account.
const REFERRAL = 'aywo.referral';

// Screens that work without an account. Everything else needs a session.
// admin has its own gate, which says why someone cannot come in and offers sign-in.
const PUBLIC_ROUTES = new Set(['phone', 'otp', 'link', 'invite', 'outsider', 'terms', 'privacy', 'refunds', 'faq', 'contact', 'takedown', 'admin']);

// Before the app proper: welcome and the first steps after signing in. On a computer these stay a centred column.
const ONBOARDING = new Set(['index', 'after-login', 'profile', 'is-this-you', 'start', 'import']);

function AppFrame({ children }: { children: ReactNode }) {
  const first = (useSegments() as string[])[0];
  const pathname = usePathname();
  useEffect(() => setCrashRoute(pathname), [pathname]);
  const section = first === 'admin' ? 'admin' : first === undefined || PUBLIC_ROUTES.has(first) || ONBOARDING.has(first) ? 'public' : 'app';
  return (
    <WebFrame section={section} route={first}>
      <AppGate staffArea={section === 'admin'}>
        <CrashBoundary>{children}</CrashBoundary>
      </AppGate>
    </WebFrame>
  );
}

function SignInGate({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const segments = useSegments() as string[];
  const first = segments[0];
  const pathname = usePathname();
  // A shared group link needs an account, and comes back here after sign-in.
  const onJoinLink = first === 'social' && segments[1] === 'groups' && segments[2] === 'join';

  useEffect(() => {
    const onWelcome = first === undefined || first === 'index';
    // Waits a tick: on the first render the Stack beside this gate has only just mounted, and navigating then can throw.
    const timer = setTimeout(() => {
      if (!signedIn && onJoinLink) {
        router.replace({ pathname: '/phone', params: { next: pathname } });
        return;
      }
      if (!signedIn && !onWelcome && !PUBLIC_ROUTES.has(first)) router.replace('/');
      if (signedIn && onWelcome) router.replace('/after-login');
    }, 0);
    return () => clearTimeout(timer);
  }, [signedIn, first, onJoinLink, pathname, router]);

  // An invite code from a shared link counts once this person is signed in. A wrong or late code is simply dropped.
  useEffect(() => {
    if (!signedIn) return;
    void deviceStore.get(REFERRAL).then(async (code) => {
      if (!code) return;
      await deviceStore.remove(REFERRAL);
      await api.rpc('referral_claim', { p_code: code }).catch(() => undefined);
    });
  }, [signedIn]);

  // Tapping a notification opens the screen it is about, such as a relative's SOS.
  useEffect(
    () =>
      listenForPushTaps((url) => {
        const path = safeNext(url);
        if (path) router.push(path as Href);
      }),
    [router],
  );

  return null;
}

export default function RootLayout() {
  const [queryClient] = useState(makeClient);
  const [fontsReady, fontError] = useFonts({ PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold });
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const code = new URLSearchParams(globalThis.location?.search ?? '').get('ref');
    if (code && /^[A-Za-z0-9]{6,12}$/.test(code)) void deviceStore.set(REFERRAL, code.toUpperCase());
  }, []);

  // The session check on start. Language and large text load with it, so the first screen is already right.
  useEffect(() => {
    let live = true;
    Promise.all([hasSession(), loadPrefs().catch(() => undefined)])
      .then(([session]) => {
        if (live) setSignedIn(session);
      })
      .catch(() => {
        if (live) setSignedIn(false);
      });
    const stop = onSessionChange((now) => {
      setSignedIn(now);
      // The next person on this phone must not see the last person's family.
      if (!now) queryClient.clear();
    });
    return () => {
      live = false;
      stop();
    };
  }, [queryClient]);

  // A font that cannot load must not leave a blank screen: the system font takes over.
  const ready = (fontsReady || !!fontError) && signedIn !== null;
  return (
    <>
      {ready ? (
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          <AppFrame>
            <Stack screenOptions={{ headerShown: false }} />
          </AppFrame>
          <SignInGate signedIn={signedIn} />
          <RestartPrompt />
          <ToastHost />
        </QueryClientProvider>
      ) : null}
      <Launch ready={ready} />
    </>
  );
}
