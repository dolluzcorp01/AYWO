import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useQuery } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import type { Href } from 'expo-router';
import { Stack, useGlobalSearchParams, usePathname, useSegments } from 'expo-router';
import { useRouter } from '@/lib/router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { useEffect, useRef, useState } from 'react';
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
import { startOfflineChecks } from '@/lib/offline';
import { track } from '@/lib/track';
import { KEEP_DAYS, shouldKeep } from '@/lib/offlineKeep';
import { offlinePersister } from '@/lib/offlineStore';
import { makeClient } from '@/lib/queryClient';
import { AppGate } from '@/ops/appConfig';
import { CrashBoundary, installCrashReporter, setCrashRoute } from '@/ops/crash';
import { listenForPushTaps } from '@/pay/registerPush';
import { MessageWatch } from '@/social/MessageWatch';

installCrashReporter();

// A link like aywo.in/?ref=CODE remembers who invited this person, and says so once they have an account.
const REFERRAL = 'aywo.referral';

// Screens that work without an account. Everything else needs a session.
// admin has its own gate, which says why someone cannot come in and offers sign-in.
const PUBLIC_ROUTES = new Set(['welcome', 'phone', 'otp', 'link', 'invite', 'outsider', 'terms', 'privacy', 'refunds', 'faq', 'roles', 'contact', 'takedown', 'admin']);

// Before the app proper: welcome and the first steps after signing in. On a computer these stay a centred column.
const ONBOARDING = new Set(['index', 'welcome', 'after-login', 'profile', 'is-this-you', 'start', 'import']);
// Signed in, these keep the side menu (help pages, bringing in another tree, editing your name): nobody should lose
// their way back by opening the FAQ or the Contact page.
const IN_APP_WHEN_SIGNED_IN = new Set(['terms', 'privacy', 'refunds', 'faq', 'roles', 'contact', 'takedown', 'import', 'profile']);

function AppFrame({ children, signedIn }: { children: ReactNode; signedIn: boolean }) {
  const first = (useSegments() as string[])[0];
  const pathname = usePathname();
  useEffect(() => setCrashRoute(pathname), [pathname]);
  const search = useGlobalSearchParams<{ edit?: string }>();
  const editingProfile = first === 'profile' && search.edit === '1';
  // The Start page is the first step for someone with no tree, and also "add another tree" for someone who has
  // one. The second kind came from Home or Me and must keep the side menu. Asked only on that page; the page
  // itself asks the same question, so this is one request, not two.
  const trees = useQuery({ queryKey: ['trees'], queryFn: () => api.get<{ id: string }[]>('/trees'), enabled: signedIn && first === 'start' });
  const startWithTree = first === 'start' && (trees.data?.length ?? 0) > 0;
  const keepMenu = signedIn && (startWithTree || (IN_APP_WHEN_SIGNED_IN.has(first ?? '') && (first !== 'profile' || editingProfile)));
  // The website's front page (the landing page) uses the whole window. In the phone apps the same route is Welcome.
  const landing = Platform.OS === 'web' && (first === undefined || first === 'index');
  const section =
    landing ? 'landing' : first === 'admin' ? 'admin' : keepMenu ? 'app' : first === undefined || PUBLIC_ROUTES.has(first) || ONBOARDING.has(first) ? 'public' : 'app';
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
  // Links that open straight into the app (a group link, a relative's SOS, a help ticket, an offer) need an account,
  // and come back here after sign-in. Without this the person signs in and lands on Home, with the link forgotten.
  const onJoinLink =
    (first === 'social' && segments[1] === 'groups' && segments[2] === 'join') ||
    (first === 'social' && segments[1] === 'sos' && segments[2] === 'watch') ||
    (first === 'help' && segments[1] !== undefined) ||
    first === 'offers' ||
    // What an email or a notification opens: an invitation, a memory, a chat, the alerts, an order, a request.
    // Signed out, these used to end on Home after sign-in, and the person had to find the thing again.
    (first === 'social' && segments[1] !== undefined) ||
    ((first === 'person' || first === 'tree') && segments[1] !== undefined) ||
    first === 'orders' ||
    first === 'family-plan' ||
    first === 'calendar' ||
    first === 'activity';

  // Someone who was signed in on this screen and now is not has signed out (or their session ended). They go to the
  // start, not to "sign in to come back here": the next person to sign in must not land on the last person's page.
  const wasSignedIn = useRef(signedIn);
  useEffect(() => {
    const onWelcome = first === undefined || first === 'index' || first === 'welcome';
    if (signedIn) wasSignedIn.current = true;
    else if (onWelcome) wasSignedIn.current = false;
    // Waits a tick: on the first render the Stack beside this gate has only just mounted, and navigating then can throw.
    const timer = setTimeout(() => {
      if (!signedIn && onJoinLink && !wasSignedIn.current) {
        router.replace({ pathname: '/phone', params: { next: pathname } });
        return;
      }
      // On the website the front page is for visitors; someone sent away from an app page wants the sign-in start.
      if (!signedIn && !onWelcome && !PUBLIC_ROUTES.has(first)) router.replace(Platform.OS === 'web' ? '/welcome' : '/');
      // The website's front page stays open for someone signed in too: its button then says "Open AYWO".
      const onLanding = Platform.OS === 'web' && first !== 'welcome';
      if (signedIn && onWelcome && !onLanding) router.replace('/after-login');
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

// The family, saved on the phone for offline use (see offlineKeep.ts for what is kept and what never is).
const PERSIST = {
  persister: offlinePersister,
  maxAge: KEEP_DAYS * 24 * 60 * 60_000,
  buster: 'v1',
  dehydrateOptions: { shouldDehydrateQuery: (q: { queryKey: readonly unknown[]; state: { status: string } }) => shouldKeep(q.queryKey, q.state.status) },
};

export default function RootLayout() {
  const [queryClient] = useState(makeClient);
  const [fontsReady, fontError] = useFonts({ PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold });
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    startOfflineChecks();
    track('app_opened');
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const code = new URLSearchParams(globalThis.location?.search ?? '').get('ref');
    if (code && /^[A-Za-z0-9]{6,12}$/.test(code)) void deviceStore.set(REFERRAL, code.toUpperCase());
  }, []);

  // The session check on start. Language and large text load with it, so the first screen is already right.
  useEffect(() => {
    let live = true;
    // What the session was a moment ago, to tell a fresh sign-in from a renewed one.
    let before: boolean | null = null;
    Promise.all([hasSession(), loadPrefs().catch(() => undefined)])
      .then(([session]) => {
        before ??= session;
        // Signed out (for example the session ended while the app was closed): no family stays on the phone.
        if (!session) void offlinePersister.removeClient();
        if (live) setSignedIn(session);
      })
      .catch(() => {
        if (live) setSignedIn(false);
      });
    const stop = onSessionChange((now) => {
      const fresh = now && before === false;
      before = now;
      // Whatever was asked for while signed out was refused, and a refusal is kept and not asked again. Without this,
      // Home opened on "Please log in again" straight after signing in. Cleared before the screens change.
      if (fresh) queryClient.clear();
      setSignedIn(now);
      // The next person on this phone must not see the last person's family.
      if (!now) {
        queryClient.clear();
        void offlinePersister.removeClient();
      }
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
        <PersistQueryClientProvider client={queryClient} persistOptions={PERSIST}>
          <StatusBar style="dark" />
          <AppFrame signedIn={!!signedIn}>
            <Stack screenOptions={{ headerShown: false }} />
          </AppFrame>
          <SignInGate signedIn={signedIn} />
          {signedIn ? <MessageWatch /> : null}
          <RestartPrompt />
          <ToastHost />
        </PersistQueryClientProvider>
      ) : null}
      <Launch ready={ready} />
    </>
  );
}
