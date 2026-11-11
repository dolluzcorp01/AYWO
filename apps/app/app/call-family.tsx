// Elder mode: "Call family". Everyone in the family with a number, big photo, big Call and WhatsApp buttons.
// A locked number opens the person's card, which explains how to see it.
import { relationText } from '@aywo/layout';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { ContactIcon } from '@/components/ContactIcon';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { EmptyState, LoadFailed, Loading, SecondaryButton, TopBar } from '@/components/ui';
import { callList } from '@/elder/callList';
import { mainTree, useTrees } from '@/lib/account';
import { useErrorText } from '@/lib/errors';
import { goBack } from '@/lib/nav';
import { callNow } from '@/social/call';
import { useTreeView } from '@/tree/useTreeView';
import { colors, fonts, radius, shadows } from '@/theme/tokens';

export default function CallFamily() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const trees = useTrees();
  const main = mainTree(trees.data);
  const tree = useTreeView(main?.id ?? '', 'mine', i18n.language, null);

  const failed = trees.error ?? tree.error;
  const people = tree.data ? callList(tree.data.nodes, tree.data.contacts, tree.data.viewer_person_id) : [];

  return (
    <Screen>
      <TopBar title={t('elder.callTitle')} subtitle={t('elder.callSubtitle')} onBack={() => goBack(router)} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {failed ? (
          <LoadFailed message={errorText(failed)} onRetry={() => (trees.error ? trees.refetch() : tree.refetch())} />
        ) : !tree.data ? (
          <Loading />
        ) : people.length === 0 ? (
          <>
            <EmptyState message={t('elder.callEmpty')} />
            {main ? <SecondaryButton label={t('elder.openTree')} onPress={() => router.push({ pathname: '/tree/[id]', params: { id: main.id } })} /> : null}
          </>
        ) : (
          people.map((person) => {
            const relation = relationText(tree.data?.labels[person.id]);
            const openCard = () => router.push({ pathname: '/person/[personId]', params: { personId: person.id, treeId: main?.id ?? '' } });
            return (
              <View key={person.id} style={styles.card}>
                <Pressable accessibilityRole="button" onPress={openCard} style={styles.who}>
                  <Avatar personId={person.id} size={64} photoUrl={person.photoUrl} name={person.name} />
                  <View style={styles.whoText}>
                    <Text style={styles.name} numberOfLines={2}>{person.name}</Text>
                    {relation.kind === 'word' ? <Text style={styles.relation}>{relation.word}</Text> : null}
                  </View>
                </Pressable>
                {person.locked ? (
                  <Pressable accessibilityRole="button" onPress={openCard} style={[styles.button, styles.locked]}>
                    <Text style={styles.lockedText}>{t('elder.howToCall')}</Text>
                  </Pressable>
                ) : (
                  <View style={styles.buttons}>
                    {person.call ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('elder.callName', { name: person.name })}
                        onPress={() => void callNow(person.call!.replace(/^tel:/, ''))}
                        style={[styles.button, styles.call]}
                      >
                        <ContactIcon kind="mobile" color={colors.white} size={26} />
                        <Text style={styles.buttonText}>{t('elder.call')}</Text>
                      </Pressable>
                    ) : null}
                    {person.whatsapp ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('elder.whatsappName', { name: person.name })}
                        onPress={() => void Linking.openURL(person.whatsapp!)}
                        style={[styles.button, styles.whatsapp]}
                      >
                        <ContactIcon kind="whatsapp" color={colors.white} size={26} />
                        <Text style={styles.buttonText}>WhatsApp</Text>
                      </Pressable>
                    ) : null}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 14, paddingBottom: 24 },
  card: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    gap: 14,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.card,
  },
  who: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  whoText: { flex: 1, gap: 2 },
  name: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 20 },
  relation: { color: colors.relation, fontFamily: fonts.bold, fontSize: 16 },
  // One full-width button per line: large text never squeezes a label or its icon.
  buttons: { gap: 10 },
  button: { minHeight: 64, borderRadius: radius.button, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 12 },
  call: { backgroundColor: colors.logoIndigo },
  whatsapp: { backgroundColor: colors.whatsapp },
  buttonText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 18 },
  locked: { backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.dashed },
  lockedText: { color: colors.logoIndigo, fontFamily: fonts.bold, fontSize: 16, textAlign: 'center' },
});
