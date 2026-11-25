// S-18 Relationship word: 'We use a different word'. Type your own, with suggestions; report a wrong one.
// Your word goes on this one card at once, for you only, and can be taken off again. Staff approval only decides
// whether other families are offered the word; it never decides what your own card shows.
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/lib/router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Avatar } from '@/components/Avatar';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, ErrorText, Field, Loading, LoadFailed, Muted, PrimaryButton, SectionTitle, TextButton, TopBar } from '@/components/ui';
import { useErrorText } from '@/lib/errors';
import { useClearOwnWord, useKinSuggest, useReportKinTerm, useSetOwnWord } from '@/tree/useEdit';
import { useTreeView } from '@/tree/useTreeView';
import type { TreeMode } from '@/tree/useTreeView';
import { colors, fonts, minTapSize } from '@/theme/tokens';

export default function KinWord() {
  const params = useLocalSearchParams<{ personId: string; treeId: string; mode?: TreeMode; seeAs?: string }>();
  const { personId, treeId } = params;
  const mode: TreeMode = params.mode === 'see_as' ? 'see_as' : 'mine';
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();

  const tree = useTreeView(treeId, mode, i18n.language, params.seeAs ?? null);
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const suggest = useKinSuggest(i18n.language, query, tree.data?.labels[personId]?.pathCode ?? null);
  const add = useSetOwnWord(treeId);
  const clear = useClearOwnWord(treeId);
  const report = useReportKinTerm();

  const data = tree.data;
  const node = data?.nodes.find((n) => n.id === personId);
  const label = data?.labels[personId];
  const shown = label?.label ?? null;
  const pathCode = label?.pathCode ?? null;
  const kinTermId = label?.kinTermId ?? null;
  const own = label?.own === true;
  // The dictionary's word for this relative: what the card shows without a word of your own.
  const usual = own ? (label?.usual ?? null) : shown;

  if (tree.isError) {
    return (
      <Screen>
        <LoadFailed message={errorText(tree.error)} onRetry={() => tree.refetch()} />
      </Screen>
    );
  }
  if (data && !node) {
    return (
      <Screen>
        <TopBar title={t('kinWord.title')} onBack={() => goBack(router)} />
        <LoadFailed message={t('errors.person_not_found')} />
      </Screen>
    );
  }
  if (!data || !node) {
    return (
      <Screen>
        <TopBar title={t('kinWord.title')} onBack={() => goBack(router)} />
        <Loading label={t('tree.loading')} />
      </Screen>
    );
  }

  // One chip per word: the same word can be on record in more than one language of the chain.
  const suggestions = (suggest.data ?? []).filter((s, i, all) => all.findIndex((o) => o.term.toLowerCase() === s.term.toLowerCase()) === i);

  const name = node.nameUnknown ? t('tree.nameNotKnown') : node.name;
  const typed = term.trim();
  const same = (a: string | null, b: string) => !!a && a.trim().toLowerCase() === b.toLowerCase();
  // Typing the word the card already shows changes nothing; typing the dictionary's word takes your own word off.
  const alreadyShown = typed.length > 0 && same(shown, typed);
  const busy = add.isPending || clear.isPending;

  function goUsual() {
    clear.mutate(personId, { onSuccess: () => setDone(t('kinWord.wentBack', { name, word: usual ?? '' })) });
  }

  function save() {
    if (!pathCode || !typed || alreadyShown) return;
    if (own && same(usual, typed)) return goUsual();
    add.mutate(
      { person_id: personId, path_code: pathCode, language_code: i18n.language, term: typed },
      { onSuccess: (result) => setDone(t(result.sent ? 'kinWord.savedSent' : 'kinWord.saved', { name, word: typed })) },
    );
  }

  function sendReport() {
    if (!kinTermId) return;
    report.mutate(
      { kin_term_id: kinTermId, suggestion: term.trim() || null },
      { onSuccess: () => setDone(t('kinWord.reported')) },
    );
  }

  if (done) {
    return (
      <Screen>
        <TopBar title={t('kinWord.title')} onBack={() => goBack(router)} />
        <View style={styles.doneBox}>
          <Text style={styles.doneText}>{done}</Text>
          <TextButton label={t('common.done')} onPress={() => goBack(router)} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TopBar title={t('kinWord.title')} onBack={() => goBack(router)} />
        <View style={styles.who}>
          <Avatar personId={node.id} size={44} photoUrl={node.photoUrl} nameUnknown={node.nameUnknown} />
          <View style={styles.whoText}>
            <Text style={styles.whoName}>{name}</Text>
            {shown ? <Text style={styles.whoWord}>{t('kinWord.nowShows', { word: shown })}</Text> : null}
            {own ? <Text style={styles.whoOwn}>{t('kinWord.ownNow')}</Text> : null}
          </View>
        </View>
        {mode === 'see_as' ? (
          <Card>
            <Text style={styles.note}>{t('kinWord.seeAsNote')}</Text>
          </Card>
        ) : (
          <>
            <Muted>{t('kinWord.explain')}</Muted>
            <Field label={t('kinWord.yourWord')} value={term} onChangeText={setTerm} autoCorrect={false} style={styles.input} />
          </>
        )}

        {mode !== 'see_as' && suggestions.length > 0 ? (
          <>
            <SectionTitle>{t('kinWord.suggestions')}</SectionTitle>
            <View style={styles.chips}>
              {suggestions.slice(0, 12).map((s) => (
                <Pressable key={s.id} accessibilityRole="button" onPress={() => setTerm(s.term)} style={styles.chip}>
                  <Text style={styles.chipText}>{s.term_native ? `${s.term} · ${s.term_native}` : s.term}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {mode !== 'see_as' ? (
          <Card>
            <Text style={styles.note}>{t('kinWord.reviewNote')}</Text>
          </Card>
        ) : null}

        {alreadyShown ? <Muted>{t('kinWord.sameWord')}</Muted> : null}
        {add.isError ? <ErrorText>{errorText(add.error)}</ErrorText> : null}
        {clear.isError ? <ErrorText>{errorText(clear.error)}</ErrorText> : null}
        {report.isError ? <ErrorText>{errorText(report.error)}</ErrorText> : null}
      </ScrollView>
      {mode !== 'see_as' ? <PrimaryButton label={t('kinWord.useWord')} onPress={save} disabled={!typed || !pathCode || alreadyShown || busy} /> : null}
      {own && mode !== 'see_as' ? <TextButton label={t('kinWord.backTo', { word: usual ?? '' })} onPress={goUsual} disabled={busy} /> : null}
      {kinTermId && !own ? (
        <TextButton label={t('kinWord.report', { word: shown ?? '' })} onPress={sendReport} disabled={report.isPending} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 12, paddingBottom: 12 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  whoText: { flex: 1, minWidth: 0 },
  whoName: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 16 },
  whoWord: { color: colors.relation, fontFamily: fonts.bold, fontSize: 13 },
  whoOwn: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  input: { borderWidth: 2, borderColor: colors.logoPurple },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: minTapSize, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card, justifyContent: 'center' },
  chipText: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  note: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  doneBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  doneText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
