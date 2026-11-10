// C1: the tree seen through a shared link by someone who is not in the family. Names and photos only.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { PageLoader } from '@/components/Loaders';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, LoadFailed, PrimaryButton, TextButton } from '@/components/ui';
import { hasSession } from '@/lib/api';
import { goBack } from '@/lib/nav';
import { NamesTree } from '@/tree/NamesTree';
import { useLinkView } from '@/tree/useLinkView';
import { colors, fonts, minTapSize } from '@/theme/tokens';

export default function LinkTree() {
  const { token, look } = useLocalSearchParams<{ token: string; look?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const link = useLinkView(token);
  const data = link.data;
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    hasSession().then(setSignedIn).catch(() => setSignedIn(false));
  }, []);

  if (link.isError) {
    return (
      <Screen>
        <LoadFailed message={t('link.notFound')} onRetry={() => link.refetch()} />
        <TextButton label={t('card.goBack')} onPress={() => goBack(router)} />
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
          <Text style={styles.note}>{t('link.sharedBy', { name: data.shared_by ?? '' })}</Text>
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
        {signedIn ? null : (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/phone', params: { next: `/link/${token}` } })}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>{t('link.inThisFamily')}</Text>
          </Pressable>
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
  secondary: {
    minHeight: 56,
    paddingHorizontal: 18,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    justifyContent: 'center',
    minWidth: minTapSize,
  },
  secondaryText: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  primary: { flex: 1 },
});
