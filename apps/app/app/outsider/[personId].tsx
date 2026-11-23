// D3: a person's card for someone outside the family. Name, photo, grey icons. No contact data is ever sent here.
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/lib/router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Avatar } from '@/components/Avatar';
import { BackIcon, ContactIcon } from '@/components/ContactIcon';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Loading, LoadFailed, Muted, NeonPanel, TextButton } from '@/components/ui';
import { useErrorText } from '@/lib/errors';
import { shownName } from '@/tree/personName';
import { LinearGradient } from 'expo-linear-gradient';
import { useLinkView } from '@/tree/useLinkView';
import { colors, fonts, gradients, minTapSize } from '@/theme/tokens';
import type { ContactKind } from '@aywo/shared';

const KINDS: ContactKind[] = ['mobile', 'whatsapp', 'email'];
const GREY = colors.dashed;

export default function OutsiderCard() {
  const { personId, token } = useLocalSearchParams<{ personId: string; token: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const view = useLinkView(token);
  const data = view.data;
  const node = data?.mode === 'outsider' ? data.nodes.find((n) => n.id === personId) : undefined;

  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel={t('card.goBack')} onPress={() => goBack(router)} style={styles.round}>
      <BackIcon color={colors.text} />
    </Pressable>
  );

  // A reloaded page, a slow connection, a link that has ended: say which, never a page with no name on it.
  if (view.isError) {
    return (
      <Screen>
        {back}
        <LoadFailed message={errorText(view.error)} onRetry={() => view.refetch()} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen>
        {back}
        <Loading label={t('tree.loading')} />
      </Screen>
    );
  }
  if (!node || data.mode !== 'outsider') {
    return (
      <Screen>
        {back}
        <LoadFailed message={t('errors.person_not_found')} />
      </Screen>
    );
  }

  return (
    <Screen>
      {back}

      <View style={styles.who}>
        <Avatar personId={node.id} size={120} photoUrl={node.photoUrl} nameUnknown={node.nameUnknown} />
        <Text style={styles.name}>{shownName(t, node.name, node.nameUnknown)}</Text>
        <Muted>{data.tree_name}</Muted>
      </View>

      <View style={styles.icons} accessibilityLabel={t('link.contactsPrivate')}>
        {KINDS.map((kind) => (
          <View key={kind} style={styles.icon}>
            <ContactIcon kind={kind} color={GREY} />
          </View>
        ))}
      </View>
      <Text style={styles.note}>{t('link.contactsPrivate')}</Text>
      <TextButton label={t('takedown.askLink')} onPress={() => router.push({ pathname: '/takedown', params: { personId } })} />

      <View style={styles.spacer} />
      <NeonPanel>
        <Text style={styles.pitchTitle}>{t('link.pitchTitle')}</Text>
        <Text style={styles.pitchText}>{t('link.pitchText')}</Text>
        <Pressable accessibilityRole="button" onPress={() => router.push('/')}>
          <LinearGradient colors={gradients.highlight} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.start}>
            <Text style={styles.startText}>{t('link.startTree')}</Text>
          </LinearGradient>
        </Pressable>
      </NeonPanel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  round: {
    width: minTapSize,
    height: minTapSize,
    borderRadius: minTapSize / 2,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  who: { alignItems: 'center', gap: 10, marginTop: 6 },
  name: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 24, letterSpacing: -0.5, textAlign: 'center' },
  icons: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 16 },
  icon: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  note: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 14, textAlign: 'center', marginTop: 16 },
  spacer: { flex: 1 },
  pitchTitle: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 20, letterSpacing: -0.4 },
  pitchText: { color: colors.onNeon, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 12 },
  start: { minHeight: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  startText: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
});
