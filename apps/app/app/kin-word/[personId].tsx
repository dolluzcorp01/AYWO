// S-18 Relationship word: 'We use a different word'. Type your own, with suggestions; report a wrong one.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Avatar } from '@/components/Avatar';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, ErrorText, Field, Loading, LoadFailed, Muted, PrimaryButton, SectionTitle, TextButton, TopBar } from '@/components/ui';
import { useErrorText } from '@/lib/errors';
import { useAddKinTerm, useKinSuggest, useReportKinTerm } from '@/tree/useEdit';
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
  const add = useAddKinTerm(treeId);
  const report = useReportKinTerm();

  const data = tree.data;
  const node = data?.nodes.find((n) => n.id === personId);
  const label = data?.labels[personId];
  const shown = label?.label ?? null;
  const pathCode = label?.pathCode ?? null;
  const kinTermId = label?.kinTermId ?? null;

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
        <Loading label={t('tree.loading')} />
      </Screen>
    );
  }

  // One chip per word: the same word can be on record in more than one language of the chain.
  const suggestions = (suggest.data ?? []).filter((s, i, all) => all.findIndex((o) => o.term.toLowerCase() === s.term.toLowerCase()) === i);

  function save() {
    if (!pathCode) return;
    add.mutate(
      { path_code: pathCode, language_code: i18n.language, term: term.trim() },
      { onSuccess: () => setDone(t('kinWord.saved', { word: term.trim() })) },
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
            <Text style={styles.whoName}>{node.nameUnknown ? t('tree.nameNotKnown') : node.name}</Text>
            {shown ? <Text style={styles.whoWord}>{t('kinWord.nowShows', { word: shown })}</Text> : null}
          </View>
        </View>
        <Muted>{t('kinWord.explain')}</Muted>
        <Field label={t('kinWord.yourWord')} value={term} onChangeText={setTerm} autoCorrect={false} style={styles.input} />

        {suggestions.length > 0 ? (
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

        <Card>
          <Text style={styles.note}>{t('kinWord.reviewNote')}</Text>
        </Card>

        {add.isError ? <ErrorText>{errorText(add.error)}</ErrorText> : null}
        {report.isError ? <ErrorText>{errorText(report.error)}</ErrorText> : null}
      </ScrollView>
      <PrimaryButton label={t('kinWord.useWord')} onPress={save} disabled={!term.trim() || !pathCode || add.isPending} />
      {kinTermId ? (
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
  input: { borderWidth: 2, borderColor: colors.logoPurple },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: minTapSize, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card, justifyContent: 'center' },
  chipText: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  note: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  doneBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  doneText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
