// D4: 'Akka or Thangai?'. The answer is a fact about the family, so it fixes the word for every cousin too.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Spinner } from '@/components/Loaders';
import { goBack } from '@/lib/nav';
import { Avatar } from '@/components/Avatar';
import { BackIcon } from '@/components/ContactIcon';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, Heading, Muted, NeonPanel, PrimaryButton } from '@/components/ui';
import { useSetElderYounger } from '@/tree/useCard';
import { useTreeView } from '@/tree/useTreeView';
import type { TreeMode } from '@/tree/useTreeView';
import { colors, fonts, minTapSize } from '@/theme/tokens';

type Choice = 'elder' | 'younger';

export default function WordConfirm() {
  const params = useLocalSearchParams<{ personId: string; treeId: string; mode?: TreeMode; seeAs?: string }>();
  const { personId, treeId } = params;
  const mode: TreeMode = params.mode === 'see_as' ? 'see_as' : 'mine';
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [choice, setChoice] = useState<Choice | null>(null);
  const save = useSetElderYounger(treeId);

  const tree = useTreeView(treeId, mode, i18n.language, params.seeAs ?? null);
  const data = tree.data;
  const label = data?.labels[personId];
  const node = data?.nodes.find((n) => n.id === personId);
  const about = label?.askAbout;
  const words = label?.ask;

  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel={t('card.goBack')} onPress={() => goBack(router)} style={styles.round}>
      <BackIcon color={colors.text} />
    </Pressable>
  );

  if (!data || !node) {
    return (
      <Screen>
        {back}
        <View style={styles.centre}>
          {tree.isError ? (
            <Text style={styles.message}>{t('tree.loadFailed')}</Text>
          ) : data ? (
            <Text style={styles.message}>{t('errors.person_not_found')}</Text>
          ) : (
            <Spinner />
          )}
        </View>
      </Screen>
    );
  }

  // Already answered, by this person or a relative, in the moments since the screen opened.
  if (!about || !words || words.length !== 2) {
    return (
      <Screen>
        {back}
        <View style={styles.centre}>
          <Text style={styles.message}>{t('word.alreadyKnown')}</Text>
        </View>
      </Screen>
    );
  }

  if (save.data?.status === 'requested') {
    return (
      <Screen>
        {back}
        <View style={styles.centre}>
          <Text style={styles.message}>{t('word.sentForApproval')}</Text>
        </View>
      </Screen>
    );
  }

  const isMeLink = about.linkId === data.viewer_person_id;
  const thanRelation = data.labels[about.linkId]?.label;
  const thanNode = data.nodes.find((n) => n.id === about.linkId);
  const than = isMeLink ? t('word.you') : (thanRelation ?? thanNode?.name ?? '');
  const person = node.name.split(' ')[0];
  const options: { key: Choice; word: string; native?: string | null; help: string }[] = [
    { key: 'elder', word: words[0].term, native: words[0].native, help: t('word.olderThan', { than }) },
    { key: 'younger', word: words[1].term, native: words[1].native, help: t('word.youngerThan', { than }) },
  ];
  const picked = options.find((o) => o.key === choice);

  function confirm() {
    if (!choice || !about) return;
    save.mutate(
      { personId: about.siblingId, thanId: about.linkId, elder: choice === 'elder' },
      {
        onSuccess: (result) => {
          if (result.status === 'saved') goBack(router);
        },
      },
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.top}>
          {back}
          <Avatar personId={node.id} size={44} photoUrl={node.photoUrl} />
          <Text style={styles.person}>{node.name}</Text>
        </View>
        <Heading>{t('word.title', { name: person })}</Heading>
        <Muted>{t('word.explain', { than })}</Muted>

        {options.map((o) => (
          <Pressable
            key={o.key}
            accessibilityRole="radio"
            accessibilityState={{ checked: o.key === choice }}
            onPress={() => setChoice(o.key)}
          >
            {o.key === choice ? (
              <NeonPanel>
                <Text style={[styles.word, styles.wordOn]}>{o.word}</Text>
                {o.native ? <Text style={[styles.native, styles.nativeOn]}>{o.native}</Text> : null}
                <Text style={[styles.help, styles.helpOn]}>{o.help}</Text>
              </NeonPanel>
            ) : (
              <Card>
                <Text style={styles.word}>{o.word}</Text>
                {o.native ? <Text style={styles.native}>{o.native}</Text> : null}
                <Text style={styles.help}>{o.help}</Text>
              </Card>
            )}
          </Pressable>
        ))}

        <Muted>{t('word.alsoSaves')}</Muted>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/kin-word/[personId]', params: { personId, treeId, mode, ...(params.seeAs ? { seeAs: params.seeAs } : {}) } })}
          style={styles.different}
        >
          <Text style={styles.differentText}>{t('kinWord.different')}</Text>
        </Pressable>
        {save.isError ? <Text accessibilityRole="alert" style={styles.error}>{t('word.saveFailed')}</Text> : null}
      </ScrollView>
      <PrimaryButton
        label={picked ? t('word.useWord', { word: picked.word }) : t('word.pickOne')}
        onPress={confirm}
        disabled={!picked || save.isPending}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 14, paddingBottom: 16 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
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
  person: { flex: 1, color: colors.text, fontFamily: fonts.extrabold, fontSize: 16 },
  word: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 24, letterSpacing: -0.4 },
  wordOn: { color: colors.white },
  native: { color: colors.relation, fontFamily: fonts.bold, fontSize: 17 },
  nativeOn: { color: colors.logoYellow },
  help: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 14 },
  helpOn: { color: colors.onNeon },
  error: { color: colors.alert, fontFamily: fonts.bold, fontSize: 14 },
  different: { minHeight: minTapSize, justifyContent: 'center', alignSelf: 'flex-start' },
  differentText: { color: colors.relation, fontFamily: fonts.bold, fontSize: 14, textDecorationLine: 'underline' },
});
