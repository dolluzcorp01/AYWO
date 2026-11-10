// S-17 Successor: who looks after a tree if its Creator goes quiet or leaves. Must already belong to the tree (tree_update).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, EmptyState, ErrorText, Loading, LoadFailed, Muted, TextButton, TopBar } from '@/components/ui';
import { useTrees } from '@/lib/account';
import type { TreeRow } from '@/lib/account';
import { api } from '@/lib/api';
import { useErrorText } from '@/lib/errors';
import { useTreeMembers } from '@/tree/useEdit';
import { colors, fonts, minTapSize } from '@/theme/tokens';

export default function Successor() {
  const { t } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const trees = useTrees();
  const created = (trees.data ?? []).filter((tree) => tree.role === 'creator');

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TopBar title={t('settings.successor')} onBack={() => goBack(router)} />
        <Muted>{t('settings.successorHelp')}</Muted>
        {trees.isError ? (
          <LoadFailed message={errorText(trees.error)} onRetry={() => trees.refetch()} />
        ) : !trees.data ? (
          <Loading label={t('tree.loading')} />
        ) : created.length === 0 ? (
          <EmptyState message={t('settings.successorNoTrees')} />
        ) : (
          created.map((tree) => <TreeSuccessor key={tree.id} tree={tree} />)
        )}
      </ScrollView>
    </Screen>
  );
}

function TreeSuccessor({ tree }: { tree: TreeRow }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const client = useQueryClient();
  const members = useTreeMembers(tree.id);
  const save = useMutation({
    mutationFn: (profileId: string | null) => api.patch<unknown>(`/trees/${tree.id}`, { successor_id: profileId }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tree-members', tree.id] }),
  });

  // Anyone who has joined the tree or had it shared with them, except the Creator, who cannot succeed themselves.
  const people = new Map<string, string>();
  for (const member of members.data?.claimed ?? []) {
    if (member.profile_id !== members.data?.creator_id) people.set(member.profile_id, member.display_name || member.person_name);
  }
  for (const grantee of members.data?.grantees ?? []) {
    if (grantee.profile_id !== members.data?.creator_id && !people.has(grantee.profile_id)) {
      people.set(grantee.profile_id, grantee.display_name || t('activity.someone'));
    }
  }
  const current = members.data?.successor ?? null;

  return (
    <Card style={styles.card}>
      <Text accessibilityRole="header" style={styles.tree}>{tree.name}</Text>
      {members.isError ? <ErrorText>{errorText(members.error)}</ErrorText> : null}
      {members.isPending ? <Loading label={t('tree.loading')} /> : null}
      {members.data ? (
        <Text style={styles.saved}>{current ? t('settings.successorSet', { name: current.display_name }) : t('settings.successorCleared')}</Text>
      ) : null}
      {members.data && people.size === 0 ? <Text style={styles.help}>{t('settings.successorNobody')}</Text> : null}
      {[...people.entries()].map(([id, name]) => {
        const on = current?.profile_id === id;
        return (
          <Pressable
            key={id}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            disabled={save.isPending}
            onPress={() => save.mutate(id)}
            style={styles.row}
          >
            <View style={[styles.radio, on && styles.radioOn]} />
            <Text style={styles.name}>{name}</Text>
          </Pressable>
        );
      })}
      {current ? <TextButton label={t('settings.successorClear')} onPress={() => save.mutate(null)} disabled={save.isPending} /> : null}
      {save.isError ? <ErrorText>{errorText(save.error)}</ErrorText> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 12, paddingBottom: 16 },
  card: { gap: 6 },
  tree: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 16 },
  saved: { color: colors.relation, fontFamily: fonts.bold, fontSize: 13 },
  help: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: minTapSize },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.dashed },
  radioOn: { borderWidth: 7, borderColor: colors.logoPurple },
  name: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
});
