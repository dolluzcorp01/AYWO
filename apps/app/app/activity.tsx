// E4 / S-11 Activity: what needs a decision, what changed, who has access.
import { useRouter } from 'expo-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { CheckIcon, RingsIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { TAB_BAR_SPACE, TabBar } from '@/components/TabBar';
import { Text } from '@/components/Text';
import { Card, EmptyState, ErrorText, Field, Heading, Loading, LoadFailed, NeonPanel, SmallButton, TextButton } from '@/components/ui';
import { useErrorText } from '@/lib/errors';
import { useTimeAgo } from '@/lib/time';
import { useActivityText } from '@/tree/activityText';
import { useActivity, useDecideRequest, useRevert, useUndoClaim } from '@/tree/useEdit';
import type { ActivityItem, ActivityTab, ChangeItem, ClaimItem, RequestItem } from '@/tree/useEdit';
import { colors, fonts, minTapSize } from '@/theme/tokens';

const TABS: { key: ActivityTab; labelKey: string }[] = [
  { key: 'needs_you', labelKey: 'activity.needsYou' },
  { key: 'changes', labelKey: 'activity.changes' },
  { key: 'access', labelKey: 'activity.access' },
  { key: 'all', labelKey: 'activity.all' },
];

export default function Activity() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [tab, setTab] = useState<ActivityTab>('needs_you');
  const feed = useActivity(tab);
  const needs = useActivity('needs_you');
  const needCount = needs.data?.filter((item) => item.needs_you).length ?? 0;

  return (
    <Screen flush>
      <View style={styles.header}>
        <Heading>{t('activity.title')}</Heading>
        <View accessibilityRole="tablist" style={styles.tabs}>
          {TABS.map((item) => {
            const on = item.key === tab;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setTab(item.key)}
                style={[styles.tab, on && styles.tabOn]}
              >
                <Text style={[styles.tabText, on && styles.tabTextOn]}>
                  {item.key === 'needs_you' && needCount > 0 ? `${t(item.labelKey)} · ${needCount}` : t(item.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {feed.isError ? (
        <LoadFailed message={errorText(feed.error)} onRetry={() => feed.refetch()} />
      ) : !feed.data ? (
        <Loading label={t('tree.loading')} />
      ) : (
        <FlatList
          data={feed.data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshing={feed.isRefetching}
          onRefresh={() => feed.refetch()}
          ListEmptyComponent={<EmptyState message={t(tab === 'needs_you' ? 'activity.emptyNeeds' : 'activity.empty')} />}
          renderItem={({ item }) => <Row item={item} />}
        />
      )}
      <TabBar active="activity" />
    </Screen>
  );
}

function Row({ item }: { item: ActivityItem }) {
  if (item.type === 'request' && item.state === 'pending' && item.needs_you) {
    return item.kind === 'merge' ? <MergeRow item={item} /> : <RequestRow item={item} />;
  }
  if (item.type === 'claim') return <ClaimRow item={item} />;
  if (item.type === 'change') return <ChangeRow item={item} />;
  return <PlainRow item={item} />;
}

function MergeRow({ item }: { item: RequestItem }) {
  const { t } = useTranslation();
  const router = useRouter();
  const textFor = useActivityText();
  return (
    <NeonPanel style={styles.mergePanel}>
      <View style={styles.rowTop}>
        <View style={styles.glass}>
          <RingsIcon color={colors.logoYellow} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.mergeText}>{textFor(item)}</Text>
          <Text style={styles.mergeFound}>{t('activity.foundBy')}</Text>
        </View>
      </View>
      <View style={styles.buttons}>
        <SmallButton
          label={t('activity.compare')}
          kind="yellow"
          onPress={() => router.push({ pathname: '/merge/[requestId]', params: { requestId: item.request_id } })}
        />
      </View>
    </NeonPanel>
  );
}

/** The name in a suggested change is the part a Creator most often fixes before accepting. */
function editableName(item: RequestItem): string | null {
  const payload = item.payload;
  if (payload?.action === 'add_relative') return payload.person?.display_name ?? null;
  if (payload?.table === 'persons' && payload.op === 'update') return payload.data?.display_name ?? null;
  return null;
}

function RequestRow({ item }: { item: RequestItem }) {
  const { t } = useTranslation();
  const textFor = useActivityText();
  const timeAgo = useTimeAgo();
  const errorText = useErrorText();
  const decide = useDecideRequest();
  const [editing, setEditing] = useState(false);
  const original = editableName(item);
  const [name, setName] = useState(original ?? '');
  const isAccess = item.kind !== 'change';

  function acceptEdited() {
    const payload = item.payload;
    const trimmed = name.trim();
    if (!payload || !trimmed) return;
    const edited = payload.action === 'add_relative'
      ? { person: { ...payload.person, display_name: trimmed } }
      : { data: { ...payload.data, display_name: trimmed } };
    decide.mutate(
      { requestId: item.request_id, decision: 'approve', edited_payload: edited },
      { onSettled: () => setEditing(false) },
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.rowTop}>
        <Avatar personId={item.actor_id ?? item.id} size={44} />
        <View style={styles.rowText}>
          <Text style={styles.text}>{textFor(item)}</Text>
          <Text style={styles.when}>{timeAgo(item.at)}</Text>
        </View>
      </View>
      <View style={styles.buttons}>
        <SmallButton
          label={isAccess ? t('activity.allow') : t('activity.accept')}
          disabled={decide.isPending}
          onPress={() => decide.mutate({ requestId: item.request_id, decision: 'approve' })}
        />
        {original ? <SmallButton label={t('activity.edit')} kind="plain" onPress={() => setEditing(true)} /> : null}
        <SmallButton label={t('activity.decline')} kind="plain" disabled={decide.isPending} onPress={() => decide.mutate({ requestId: item.request_id, decision: 'decline' })} />
      </View>
      {decide.isError ? <ErrorText>{errorText(decide.error)}</ErrorText> : null}

      <Modal visible={editing} transparent animationType="fade" onRequestClose={() => setEditing(false)}>
        <View style={styles.scrim}>
          <View style={styles.dialog}>
            <Field label={t('details.name')} value={name} onChangeText={setName} />
            <TextButton label={t('activity.acceptEdited')} onPress={acceptEdited} disabled={!name.trim() || decide.isPending} />
            <TextButton label={t('common.cancel')} onPress={() => setEditing(false)} />
          </View>
        </View>
      </Modal>
    </Card>
  );
}

function Plain({ text, when, children }: { text: string; when: string; children?: ReactNode }) {
  return (
    <View style={styles.plain}>
      <View style={styles.tick}>
        <CheckIcon color={colors.white} size={14} width={3} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.text}>{text}</Text>
        <View style={styles.whenRow}>
          <Text style={styles.when}>{when}</Text>
          {children}
        </View>
      </View>
    </View>
  );
}

function PlainRow({ item }: { item: ActivityItem }) {
  const textFor = useActivityText();
  const timeAgo = useTimeAgo();
  return <Plain text={textFor(item)} when={timeAgo(item.at)} />;
}

function ClaimRow({ item }: { item: ClaimItem }) {
  const { t } = useTranslation();
  const textFor = useActivityText();
  const timeAgo = useTimeAgo();
  const errorText = useErrorText();
  const undo = useUndoClaim();
  return (
    <>
      <Plain text={textFor(item)} when={timeAgo(item.at)}>
        {item.person_id ? (
          <Pressable accessibilityRole="button" disabled={undo.isPending} onPress={() => undo.mutate(item.person_id as string)} style={styles.undo}>
            <Text style={styles.undoText}>{t('activity.wrongMatch')}</Text>
          </Pressable>
        ) : null}
      </Plain>
      {undo.isError ? <ErrorText>{errorText(undo.error)}</ErrorText> : null}
    </>
  );
}

function ChangeRow({ item }: { item: ChangeItem }) {
  const { t } = useTranslation();
  const textFor = useActivityText();
  const timeAgo = useTimeAgo();
  const errorText = useErrorText();
  const revert = useRevert(item.tree_id);
  return (
    <>
      <Plain text={textFor(item)} when={timeAgo(item.at)}>
        {item.reverted ? <Text style={styles.when}>{t('history.undone')}</Text> : null}
        {item.can_revert ? (
          <Pressable accessibilityRole="button" disabled={revert.isPending} onPress={() => revert.mutate({ batch_id: item.batch_id })} style={styles.undo}>
            <Text style={styles.undoText}>{item.rows > 1 ? t('history.undoAll') : t('history.undo')}</Text>
          </Pressable>
        ) : null}
      </Plain>
      {revert.isError ? <ErrorText>{errorText(revert.error)}</ErrorText> : null}
    </>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  tab: { minHeight: minTapSize - 4, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card, justifyContent: 'center' },
  tabOn: { backgroundColor: colors.logoIndigo, borderColor: colors.logoIndigo },
  tabText: { color: colors.text, fontFamily: fonts.bold, fontSize: 13 },
  tabTextOn: { color: colors.white },
  list: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: TAB_BAR_SPACE, gap: 12 },
  card: { gap: 10, borderRadius: 22 },
  rowTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  text: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  when: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingStart: 56 },
  mergePanel: { gap: 10 },
  glass: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.glass, alignItems: 'center', justifyContent: 'center' },
  mergeText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 15, lineHeight: 20 },
  mergeFound: { color: colors.onNeon, fontFamily: fonts.semibold, fontSize: 12 },
  plain: { flexDirection: 'row', gap: 12, paddingHorizontal: 4, alignItems: 'flex-start' },
  tick: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.whatsapp, alignItems: 'center', justifyContent: 'center' },
  whenRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  undo: { minHeight: minTapSize, justifyContent: 'center' },
  undoText: { color: colors.relation, fontFamily: fonts.bold, fontSize: 12, textDecorationLine: 'underline' },
  scrim: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { alignSelf: 'stretch', backgroundColor: colors.background, borderRadius: 24, padding: 20, gap: 8 },
});
