// E6 / S-12 History: every change and who made it, for a tree or one person. Undo puts it back.
// The server lists single rows; one action on the screen is one batch, so rows are gathered here.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, EmptyState, ErrorText, Loading, LoadFailed, NeonPanel, SmallButton, TopBar } from '@/components/ui';
import { useMe } from '@/lib/account';
import { useErrorText } from '@/lib/errors';
import { useTimeAgo } from '@/lib/time';
import { useHistory, useRevert } from '@/tree/useEdit';
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

export default function HistoryScreen() {
  const { treeId, personId } = useLocalSearchParams<{ treeId: string; personId?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const timeAgo = useTimeAgo();
  const me = useMe();
  const history = useHistory(treeId, personId);
  const revert = useRevert(treeId);
  const batches = useMemo(() => batchesOf(history.data ?? []), [history.data]);

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
      const person = row.after?.display_name ?? row.before?.display_name ?? t('activity.someone');
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
                      onPress={() => revert.mutate(whole ? { batch_id: item.id } : { history_id: item.rows[0].id })}
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
  promise: { color: colors.white, fontFamily: fonts.bold, fontSize: 15, lineHeight: 21 },
});
