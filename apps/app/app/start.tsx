// A5: the first screen for someone with no tree yet. Bring a tree in, or start from yourself.
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Avatar } from '@/components/Avatar';
import { DeleteBanner } from '@/components/DeleteBanner';
import { DownloadIcon, LinkedPeopleIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { TAB_BAR_SPACE, TabBar } from '@/components/TabBar';
import { Text } from '@/components/Text';
import { Card, ErrorText, NeonPanel } from '@/components/ui';
import { firstName, useMe } from '@/lib/account';
import { api } from '@/lib/api';
import { useErrorText } from '@/lib/errors';
import { colors, fonts, gradients, minTapSize } from '@/theme/tokens';

export default function Start() {
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const errorText = useErrorText();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const name = firstName(me.data?.display_name);

  async function startFromMe() {
    setBusy(true);
    setFailure(null);
    try {
      const tree = await api.post<{ id: string }>('/trees', { name: t('start.treeName', { name: me.data?.display_name ?? '' }) });
      await client.invalidateQueries({ queryKey: ['trees'] });
      // A new tree starts with the family guide: mother, father, partner, children, one at a time.
      router.replace({ pathname: '/guide/[treeId]', params: { treeId: tree.id } });
    } catch (error) {
      setFailure(error);
      setBusy(false);
    }
  }

  return (
    <Screen flush>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.top}>
          <Image source={require('../assets/aywo_logo_app.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="AYWO" />
          <Pressable accessibilityRole="button" accessibilityLabel={t('tabs.me')} onPress={() => router.replace('/me')}>
            <Avatar personId={me.data?.id ?? 'me'} size={48} ring />
          </Pressable>
        </View>
        <DeleteBanner />
        <Text accessibilityRole="header" style={styles.title}>{name ? t('start.title', { name }) : t('start.titleNoName')}</Text>

        <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.push('/import')}>
          <NeonPanel style={styles.panel}>
            <View style={styles.panelTop}>
              <View style={styles.iconGlass}>
                <DownloadIcon color={colors.logoYellow} size={24} />
              </View>
              <LinearGradient colors={gradients.highlight} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fastest}>
                <Text style={styles.fastestText}>{t('start.fastest')}</Text>
              </LinearGradient>
            </View>
            <Text style={styles.panelTitle}>{t('start.haveTree')}</Text>
            <Text style={styles.panelHelp}>{t('start.haveTreeHelp')}</Text>
          </NeonPanel>
        </Pressable>

        <Pressable accessibilityRole="button" disabled={busy || me.isLoading} onPress={startFromMe}>
          <Card style={styles.panel}>
            <LinearGradient colors={gradients.button} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.iconSolid}>
              <LinkedPeopleIcon color={colors.white} size={24} />
            </LinearGradient>
            <Text style={styles.cardTitle}>{t('start.fromMe')}</Text>
            <Text style={styles.cardHelp}>{t('start.fromMeHelp')}</Text>
          </Card>
        </Pressable>

        {failure ? <ErrorText>{errorText(failure)}</ErrorText> : null}
      </ScrollView>
      <TabBar active="home" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: TAB_BAR_SPACE, gap: 16 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: minTapSize },
  logo: { height: 38, width: 124 },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 24, lineHeight: 30, letterSpacing: -0.5 },
  panel: { gap: 10, padding: 20 },
  panelTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconGlass: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.glass, alignItems: 'center', justifyContent: 'center' },
  fastest: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  fastestText: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 12, letterSpacing: 0.4 },
  panelTitle: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 22, letterSpacing: -0.4 },
  panelHelp: { color: colors.onNeon, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  iconSolid: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 22, letterSpacing: -0.4 },
  cardHelp: { color: colors.muted, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
});
