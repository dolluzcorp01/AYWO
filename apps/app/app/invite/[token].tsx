// B1: what someone sees first when family sends them a link. Sign in to see the tree from their own place, or just look.
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { Heading, Loading, LoadFailed, Muted, PrimaryButton, SecondaryButton, TextButton } from '@/components/ui';
import { goBack } from '@/lib/nav';
import { generationCount } from '@/tree/stats';
import { useLinkView } from '@/tree/useLinkView';
import { colors, fonts, gradients } from '@/theme/tokens';

const FACES = 4;

export default function InviteLanding() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const link = useLinkView(token);
  const data = link.data;

  if (link.isError) {
    return (
      <View style={[styles.page, { paddingBottom: insets.bottom + 22 }]}>
        <LoadFailed message={t('link.notFound')} onRetry={() => link.refetch()} />
        <TextButton label={t('card.goBack')} onPress={() => goBack(router)} />
      </View>
    );
  }
  if (!data) {
    return <View style={styles.page}><Loading label={t('tree.loading')} /></View>;
  }
  // Family who are already signed in have nothing to decide here.
  if (data.mode === 'member') {
    return <Redirect href={{ pathname: '/tree/[id]', params: { id: data.tree_id } }} />;
  }

  const faces = data.nodes.filter((n) => !n.nameUnknown).slice(0, FACES);
  const extra = data.nodes.length - faces.length;

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <LinearGradient colors={gradients.neon} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, { paddingTop: insets.top + 24 }]}>
          <View style={styles.logoChip}>
            <Image source={require('../../assets/aywo_logo_app.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="AYWO" />
          </View>
          <Avatar personId={token} size={92} ring />
          <Text accessibilityRole="header" style={styles.title}>
            {data.shared_by
              ? t('invite.invitedBy', { name: data.shared_by, tree: data.tree_name })
              : t('invite.invited', { tree: data.tree_name })}
          </Text>
          <View style={styles.faces}>
            {faces.map((node, i) => (
              <View key={node.id} style={[styles.face, i > 0 && styles.faceOverlap]}>
                <Avatar personId={node.id} size={44} photoUrl={node.photoUrl} />
              </View>
            ))}
            {extra > 0 ? (
              <View style={[styles.face, styles.faceOverlap, styles.moreFace]}>
                <Text style={styles.moreText}>{t('invite.more', { count: extra })}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.stats}>
            {t('invite.stats', { people: data.nodes.length, generations: generationCount(data.nodes, data.links) })}
          </Text>
        </LinearGradient>

        <View style={styles.body}>
          <Heading>{t('invite.areYouIn')}</Heading>
          <Muted>{t('invite.explain')}</Muted>
        </View>
      </ScrollView>

      <View style={[styles.buttons, { paddingBottom: insets.bottom + 22 }]}>
        <PrimaryButton
          label={t('invite.signIn')}
          onPress={() => router.push({ pathname: '/phone', params: { next: `/link/${token}` } })}
        />
        <SecondaryButton
          label={t('invite.justLook')}
          onPress={() => router.push({ pathname: '/link/[token]', params: { token, look: '1' } })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1 },
  hero: { borderBottomLeftRadius: 34, borderBottomRightRadius: 34, paddingHorizontal: 24, paddingBottom: 24, gap: 14, alignItems: 'center' },
  logoChip: { backgroundColor: colors.white, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
  logo: { height: 30, width: 96 },
  title: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 26, lineHeight: 32, letterSpacing: -0.6, textAlign: 'center' },
  faces: { flexDirection: 'row', alignItems: 'center' },
  face: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: colors.logoIndigo, overflow: 'hidden' },
  faceOverlap: { marginStart: -10 },
  moreFace: { backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  moreText: { color: colors.logoIndigo, fontFamily: fonts.extrabold, fontSize: 13 },
  stats: { color: colors.onNeon, fontFamily: fonts.semibold, fontSize: 14 },
  body: { padding: 24, gap: 10 },
  buttons: { gap: 10, paddingHorizontal: 24 },
});
