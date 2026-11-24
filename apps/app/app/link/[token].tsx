// C1: the tree seen through a shared link by someone who is not in the family. Names and photos only.
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/lib/router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { PageLoader } from '@/components/Loaders';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, LoadFailed, PrimaryButton, SecondaryButton, TextButton } from '@/components/ui';
import { ApiFailure, hasSession } from '@/lib/api';
import { useErrorText } from '@/lib/errors';
import { goBack } from '@/lib/nav';
import { NamesTree } from '@/tree/NamesTree';
import { useLinkView } from '@/tree/useLinkView';
import { colors, fonts } from '@/theme/tokens';

export default function LinkTree() {
  const { token, look } = useLocalSearchParams<{ token: string; look?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const link = useLinkView(token);
  const data = link.data;
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    hasSession().then(setSignedIn).catch(() => setSignedIn(false));
  }, []);

  if (link.isError) {
    return (
      <Screen>
        {/* Only an answer from the server says the link is wrong. No internet, or a server fault, says so instead:
            the link was blamed for every failure, and people asked relatives for new links they did not need. */}
        <LoadFailed message={link.error instanceof ApiFailure && link.error.status < 500 ? t('link.notFound') : errorText(link.error)} onRetry={() => link.refetch()} />
        <TextButton label={t(signedIn ? 'link.goHome' : 'card.goBack')} onPress={() => (signedIn ? router.replace('/home') : goBack(router))} />
      </Screen>
    );
  }
  // After signing in, an answer kept from before may be out of date: family get their own view instead.
  if (!data || signedIn === null || (signedIn && data.mode === 'outsider' && link.isFetching)) {
    return (
      <Screen>
        <View style={styles.centre}>
          <PageLoader label={t('tree.loading')} />
        </View>
      </Screen>
    );
  }
  // Family who are signed in go to their own view.
  if (data.mode === 'member') {
    return <Redirect href={{ pathname: '/tree/[id]', params: { id: data.tree_id } }} />;
  }
  // Someone signed out meets the invitation (B1) first. 'Just have a look' comes back here.
  if (!signedIn && look !== '1') {
    return <Redirect href={{ pathname: '/invite/[token]', params: { token } }} />;
  }

  return (
    <Screen flush>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>{data.tree_name}</Text>
        <Card>
          <Text style={styles.note}>{data.shared_by?.trim() ? t('link.sharedBy', { name: data.shared_by }) : t('link.sharedNoName')}</Text>
          {/* Signed in and still outside: say why, and what gets them in. */}
          {signedIn ? <Text style={styles.note}>{t('link.outsiderHelp')}</Text> : null}
        </Card>
      </View>
      <View style={styles.tree}>
        <NamesTree
          data={data}
          viewerId={null}
          bottomSpace={0}
          onOpenPerson={(personId) => router.push({ pathname: '/outsider/[personId]', params: { personId, token } })}
        />
      </View>
      <View style={styles.footer}>
        {signedIn ? (
          <SecondaryButton label={t('link.goHome')} onPress={() => router.replace('/home')} />
        ) : (
          <SecondaryButton label={t('link.inThisFamily')} onPress={() => router.push({ pathname: '/phone', params: { next: `/link/${token}` } })} />
        )}
        <View style={styles.primary}>
          <PrimaryButton label={t('link.makeOwn')} onPress={() => router.push(signedIn ? '/start' : '/')} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15, textAlign: 'center' },
  header: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 22, letterSpacing: -0.4 },
  note: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  tree: { flex: 1 },
  footer: { flexDirection: 'row', gap: 10, padding: 16, alignItems: 'center' },
  primary: { flex: 1 },
});
