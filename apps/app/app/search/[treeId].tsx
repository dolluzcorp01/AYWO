// F2 Search: names in this tree, in any script. Recent people stay as chips on this device.
import { relationText } from '@aywo/layout';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Avatar } from '@/components/Avatar';
import { SearchIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Text, TextInput } from '@/components/Text';
import { useVoiceInput } from '@/voice/useVoiceInput';
import { VoiceButton } from '@/voice/VoiceButton';
import { BackButton, Card, ErrorText, Loading, Muted, SectionTitle } from '@/components/ui';
import { deviceStore } from '@/lib/api';
import { useErrorText } from '@/lib/errors';
import { useTreeSearch } from '@/tree/useEdit';
import { useTreeView } from '@/tree/useTreeView';
import { colors, fonts, minTapSize } from '@/theme/tokens';

const RECENT_MAX = 6;

interface Recent {
  id: string;
  name: string;
}

export default function Search() {
  const { treeId } = useLocalSearchParams<{ treeId: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const [text, setText] = useState('');
  // Say the name to find them. A search starts fresh, so speech replaces what was typed.
  const searchVoice = useVoiceInput('', setText);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<Recent[]>([]);
  const recentKey = `aywo.recent.${treeId}`;

  // Wait for a pause in typing, so each key press is not a request.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    deviceStore
      .get(recentKey)
      .then((raw) => {
        if (raw) setRecent(JSON.parse(raw) as Recent[]);
      })
      .catch(() => undefined);
  }, [recentKey]);

  const search = useTreeSearch(treeId, query);
  // Photos come from the tree already on this phone.
  const tree = useTreeView(treeId, 'mine', i18n.language, null);
  const nodes = useMemo(() => new Map((tree.data?.nodes ?? []).map((n) => [n.id, n])), [tree.data]);

  function open(person: Recent) {
    const next = [person, ...recent.filter((r) => r.id !== person.id)].slice(0, RECENT_MAX);
    setRecent(next);
    deviceStore.set(recentKey, JSON.stringify(next)).catch(() => undefined);
    router.push({ pathname: '/person/[personId]', params: { personId: person.id, treeId, mode: 'mine' } });
  }

  return (
    <Screen>
      <View style={styles.top}>
        <BackButton onPress={() => goBack(router)} />
        <View style={styles.box}>
          <SearchIcon color={colors.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            autoFocus
            autoCorrect={false}
            placeholder={t('search.placeholder')}
            placeholderTextColor={colors.muted}
            accessibilityLabel={t('search.placeholder')}
            style={styles.input}
          />
          <VoiceButton voice={searchVoice} size={40} />
        </View>
      </View>
      <View style={styles.help}>
        <Muted>{t('search.help')}</Muted>
      </View>

      {search.isError ? <ErrorText>{errorText(search.error)}</ErrorText> : null}
      {query ? (
        search.data ? (
          <FlatList
            data={search.data}
            keyExtractor={(hit) => hit.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            ListHeaderComponent={<SectionTitle>{t('search.people')}</SectionTitle>}
            ListEmptyComponent={<Muted>{t('search.nothing')}</Muted>}
            renderItem={({ item }) => {
              const node = nodes.get(item.id);
              const relation = relationText(tree.data?.labels[item.id]);
              return (
                <Pressable accessibilityRole="button" onPress={() => open({ id: item.id, name: item.name })}>
                  <Card style={styles.hit}>
                    <Avatar personId={item.id} size={50} photoUrl={node?.photoUrl} nameUnknown={node?.nameUnknown} />
                    <View style={styles.hitText}>
                      <Text style={styles.hitName}>{item.name}</Text>
                      {relation.kind === 'word' ? <Text style={styles.hitRelation}>{relation.word}</Text> : null}
                    </View>
                  </Card>
                </Pressable>
              );
            }}
          />
        ) : search.isError ? null : (
          <Loading label={t('tree.loading')} />
        )
      ) : recent.length > 0 ? (
        <View style={styles.recent}>
          <SectionTitle>{t('search.recent')}</SectionTitle>
          <View style={styles.chips}>
            {recent.map((r) => (
              <Pressable key={r.id} accessibilityRole="button" onPress={() => open(r)} style={styles.chip}>
                <Text style={styles.chipText}>{r.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  box: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: colors.logoPurple,
    backgroundColor: colors.card,
  },
  input: { flex: 1, minHeight: minTapSize, color: colors.text, fontFamily: fonts.bold, fontSize: 16 },
  help: { marginTop: 10, marginBottom: 6 },
  list: { gap: 10, paddingVertical: 8 },
  hit: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  hitText: { flex: 1, minWidth: 0 },
  hitName: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 16 },
  hitRelation: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 13 },
  recent: { gap: 10, marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: minTapSize, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card, justifyContent: 'center' },
  chipText: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
});
