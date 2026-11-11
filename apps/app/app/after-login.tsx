// Decides where a person goes once signed in: 'Is this you?' when their number matched someone,
// the profile step when the account has no name yet, otherwise Home (or the link they came from).
import type { Href } from 'expo-router';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/Screen';
import { Loading, LoadFailed } from '@/components/ui';
import { claimCandidates, safeNext } from '@/lib/account';
import type { Me } from '@/lib/account';
import { api, deviceStore } from '@/lib/api';
import { errorCode, useErrorText } from '@/lib/errors';
import { isLargeText, isSimpleMode, setLanguage, setLargeText, setSimpleMode } from '@/lib/prefs';
import { registerForPush } from '@/pay/registerPush';
import { LEGAL_VERSION } from '@/legal/publisher';

export default function AfterLogin() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const params = useLocalSearchParams<{ next?: string; name?: string }>();
  const next = safeNext(params.next);
  const name = params.name;
  const [failure, setFailure] = useState<unknown>(null);

  const decide = useCallback(async () => {
    setFailure(null);
    try {
      const me = await api.get<Me>('/me');
      const isNew = !me.display_name;

      if (isNew) {
        // A new account takes what was chosen on Welcome.
        await api.patch('/me', { language_code: i18n.language, large_text: isLargeText(), simple_mode: isSimpleMode() });
      } else {
        // A returning person gets their saved choices on this phone too.
        if (me.language_code && me.language_code !== i18n.language && me.language_code !== 'en') await setLanguage(me.language_code);
        if (me.large_text !== isLargeText()) await setLargeText(me.large_text);
        if (!!me.simple_mode !== isSimpleMode()) await setSimpleMode(!!me.simple_mode);
      }

      // The phone screen says signing in accepts the Terms and Privacy policy; this records that (LLD S-02).
      // Once per version for each account on this phone, so a new version is recorded for returning people too.
      const consentKey = `aywo.consent.${me.id}.${LEGAL_VERSION}`;
      if (!(await deviceStore.get(consentKey))) {
        await Promise.all(
          ['terms', 'privacy'].map((kind) =>
            api.post('/me/consents', { kind, version: LEGAL_VERSION }).catch((error) => {
              // Trying again after a failed step: the consent is already on record.
              if (errorCode(error) !== 'already_exists') throw error;
            }),
          ),
        );
        await deviceStore.set(consentKey, '1');
      }

      // Push is optional and never holds the person up.
      registerForPush();

      const candidates = await claimCandidates();
      const onward = { ...(next ? { next } : {}), ...(name ? { name } : {}) };
      if (candidates.length > 0) {
        router.replace({ pathname: '/is-this-you', params: onward });
      } else if (isNew) {
        router.replace({ pathname: '/profile', params: onward });
      } else {
        router.replace((next ?? '/home') as Href);
      }
    } catch (error) {
      setFailure(error);
    }
  }, [i18n.language, name, next, router]);

  useEffect(() => {
    decide();
    // One decision per arrival; a language change must not send the person somewhere else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen>
      {failure ? <LoadFailed message={errorText(failure)} onRetry={decide} /> : <Loading label={t('tree.loading')} />}
    </Screen>
  );
}
