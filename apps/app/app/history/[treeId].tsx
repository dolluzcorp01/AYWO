// E6 / S-12 History: every change and who made it, for a tree or one person. Undo puts it back.
// The server lists single rows; one action on the screen is one batch, so rows are gathered here.
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/lib/router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, ConfirmDialog, EmptyState, ErrorText, Loading, LoadFailed, NeonPanel, SmallButton, TextButton, TopBar } from '@/components/ui';
import { useMe } from '@/lib/account';
import { api } from '@/lib/api';
import { useErrorText } from '@/lib/errors';
import { useTimeAgo } from '@/lib/time';
import { shownName } from '@/tree/personName';
import { useRevert } from '@/tree/useEdit';
import type { HistoryItem } from '@/tree/useEdit';
import { colors, fonts } from '@/theme/tokens';

interface Batch {
  id: string;
  rows: HistoryItem[];
}

function batchesOf(rows: HistoryItem[]): Batch[] {
  const out: Batch[] = [];
  const byId = new Map<string, Batch>();
  for (const row of rows) {
    let batch = byId.get(row.batch_id);
    if (!batch) {
      batch = { id: row.batch_id, rows: [] };
      byId.set(row.batch_id, batch);
      out.push(batch);
    }
    batch.rows.push(row);
  }
  return out;
}

// How many single rows come at a time. A full page means there may be older ones: "Show more" fetches them.
const PAGE_ROWS = 100;

export default function HistoryScreen() {
  const { treeId, personId } = useLocalSearchParams<{ treeId: string; personId?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const timeAgo = useTimeAgo();
  const me = useMe();
  // Older changes come a page at a time: each page asks for the rows before the last one already shown.
  // The key starts like the old one, so an Undo (which refreshes ['history', treeId]) refreshes this list too.
  const history = useInfiniteQuery({
    queryKey: ['history', treeId, personId ?? null, 'pages'],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => {
      const query = [`limit=${PAGE_ROWS}`, personId ? `person_id=${encodeURIComponent(personId)}` : '', pageParam ? `before=${pageParam}` : ''].filter(Boolean).join('&');
      return api.get<HistoryItem[]>(`/trees/${treeId}/history?${query}`);
    },
    getNextPageParam: (last) => (last.length >= PAGE_ROWS ? last[last.length - 1].id : undefined),
  });
  const revert = useRevert(treeId);
  const batches = useMemo(() => batchesOf(history.data?.pages.flat() ?? []), [history.data]);
  // The change about to be undone, shown back to the person before anything happens.
  const [asking, setAsking] = useState<Batch | null>(null);

  function describe(batch: Batch): string {
    const first = batch.rows[0];
    const mine = first.actor_id !== null && first.actor_id === me.data?.id;
    const who = mine ? 'you' : 'other';
    const name = first.actor_name || t('history.aywo');
    const people = batch.rows.filter((r) => r.table_name === 'persons');
    const added = people.filter((r) => r.op === 'insert');
    if (added.length > 1) return t(`history.${who}.addMany`, { name, count: added.length });
    const row = people[0];
    if (row) {
      const stored = row.after?.display_name ?? row.before?.display_name;
      const person = stored ? shownName(t, stored) : t('activity.someone');
      if (row.op === 'insert') return t(`history.${who}.add`, { name, person });
      if (row.op === 'delete' || (row.after?.deleted_at && !row.before?.deleted_at)) return t(`history.${who}.remove`, { name, person });
      return t(`history.${who}.change`, { name, person });
    }
    if (batch.rows.some((r) => r.table_name === 'person_contacts')) return t(`history.${who}.contact`, { name });
    return t(`history.${who}.link`, { name });
  }

  return (
    <Screen>
      <TopBar title={t('history.title')} subtitle={t('history.subtitle')} onBack={() => goBack(router)} />
      {revert.isError ? <ErrorText>{errorText(revert.error)}</ErrorText> : null}
      {history.isError ? (
        <LoadFailed message={errorText(history.error)} onRetry={() => history.refetch()} />
      ) : !history.data ? (
        <Loading label={t('tree.loading')} />
      ) : (
        <FlatList
          data={batches}
          keyExtractor={(batch) => batch.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState message={t('history.empty')} />}
          ListFooterComponent={
            history.hasNextPage ? (
              <TextButton
                label={history.isFetchingNextPage ? t('tree.loading') : t('history.showMore')}
                disabled={history.isFetchingNextPage}
                onPress={() => void history.fetchNextPage()}
              />
            ) : batches.length > 0 && (history.data?.pages.length ?? 0) > 1 ? (
              <Text style={styles.end}>{t('history.end')}</Text>
            ) : undefined
          }
          renderItem={({ item, index }) => {
            const undone = item.rows.every((r) => r.reverted_by !== null);
            // A contact's history holds no value, so it cannot come back. One such row blocks undoing the batch.
            const canUndo = item.rows.every((r) => r.can_revert);
            const whole = item.rows.length > 1;
            return (
              <View style={styles.row}>
                <View style={styles.line}>
                  <View style={styles.dot} />
                  {index < batches.length - 1 ? <View style={styles.stem} /> : null}
                </View>
                <Card style={styles.card}>
                  <View style={styles.cardText}>
                    <Text style={styles.text}>{describe(item)}</Text>
                    <Text style={styles.when}>{timeAgo(item.rows[0].at)}</Text>
                  </View>
                  {undone ? (
                    <Text style={styles.undone}>{t('history.undone')}</Text>
                  ) : canUndo ? (
                    <SmallButton
                      label={whole ? t('history.undoAll') : t('history.undo')}
                      kind="dark"
                      disabled={revert.isPending}
                      onPress={() => setAsking(item)}
                    />
                  ) : null}
                </Card>
              </View>
            );
          }}
        />
      )}
      <NeonPanel>
        <Text style={styles.promise}>{t('history.promise')}</Text>
      </NeonPanel>
      <ConfirmDialog
        visible={asking !== null}
        title={t('history.undoTitle')}
        message={asking ? `${describe(asking)}

${t('history.undoHelp')}` : undefined}
        confirmLabel={asking && asking.rows.length > 1 ? t('history.undoAll') : t('history.undo')}
        busy={revert.isPending}
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          if (!asking) return;
          revert.mutate(asking.rows.length > 1 ? { batch_id: asking.id } : { history_id: asking.rows[0].id }, { onSettled: () => setAsking(null) });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 1, paddingVertical: 14 },
  row: { flexDirection: 'row', gap: 12 },
  line: { width: 20, alignItems: 'center' },
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.logoPurple, borderWidth: 2, borderColor: colors.white, marginTop: 20 },
  stem: { flex: 1, width: 2, backgroundColor: colors.logoPurple },
  card: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, padding: 12, minWidth: 0 },
  cardText: { flex: 1, minWidth: 0, gap: 2 },
  text: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  when: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  undone: { color: colors.muted, fontFamily: fonts.bold, fontSize: 12 },
  end: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13, textAlign: 'center', paddingVertical: 8 },
  promise: { color: colors.white, fontFamily: fonts.bold, fontSize: 15, lineHeight: 21 },
});
