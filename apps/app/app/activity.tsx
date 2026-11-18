// E4 / S-11 Activity: what needs a decision, what changed, who has access.
import { useQuery } from '@tanstack/react-query';
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
import { Card, ConfirmDialog, EmptyState, ErrorText, Field, Heading, Loading, LoadFailed, NeonPanel, SmallButton, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
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

// The list comes 50 lines at a time. "Show more" asks for a longer one, up to the most the server gives.
const PAGE = 50;
const MOST = 200;

export default function Activity() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [tab, setTab] = useState<ActivityTab>('needs_you');
  const [limit, setLimit] = useState(PAGE);
  // The key starts with 'activity', so every action that refreshes the feed refreshes this list too. The lines
  // already on screen stay while the longer list loads.
  const feed = useQuery({
    queryKey: ['activity', tab, limit],
    queryFn: () => api.get<ActivityItem[]>(`/activity?tab=${tab}&limit=${limit}`),
    // Only within one tab: another tab's lines must never show under this tab's name.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === tab ? previous : undefined),
  });
  // A full list means there may be older lines the server left out.
  const full = !feed.isPlaceholderData && (feed.data?.length ?? 0) >= limit;
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
                onPress={() => {
                  setTab(item.key);
                  setLimit(PAGE);
                }}
                style={[styles.tab, on && styles.tabOn]}
              >
                <Text style={[styles.tabText, on && styles.tabTextOn]}>
                  {item.key === 'needs_you' && needCount > 0 ? `${t(item.labelKey)} · ${needCount}` : t(item.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {/* One line on what this tab holds, so the page explains itself. */}
        <Text style={styles.about}>{t(`activity.about.${tab}`)}</Text>
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
          ListFooterComponent={
            feed.isPlaceholderData ? (
              <TextButton label={t('tree.loading')} disabled onPress={() => undefined} />
            ) : full && limit < MOST ? (
              <TextButton label={t('activity.showMore')} onPress={() => setLimit((now) => Math.min(now + PAGE, MOST))} />
            ) : full ? (
              <Text style={styles.about}>{t('activity.olderInHistory')}</Text>
            ) : undefined
          }
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

// What a suggested change carries, in the order a person would read it. Other fields (photo paths, how exact a
// date is) mean nothing on screen and are left out.
const SHOWN: [string, string][] = [
  ['display_name', 'details.name'],
  ['birth_date', 'card.born'],
  ['birth_place', 'details.birthPlace'],
  ['death_date', 'card.passedAway'],
  ['death_place', 'details.deathPlace'],
  ['notes', 'details.notes'],
];

/** "Name: Lakshmi Ammal", "Born: 1968-03-21": the new values someone is asking to save. */
function changeLines(item: RequestItem, t: (key: string) => string): string[] {
  const payload = item.payload as { action?: string; op?: string; data?: Record<string, unknown>; person?: Record<string, unknown> } | null | undefined;
  const values = payload?.action === 'add_relative' ? payload.person : payload?.op === 'update' ? payload.data : null;
  if (!values) return [];
  const lines = SHOWN.filter(([key]) => typeof values[key] === 'string' && (values[key] as string).trim() !== '' && !(key === 'display_name' && values.name_unknown)).map(
    ([key, label]) => `${t(label)}: ${key.endsWith('_date') ? (values[key] as string).slice(0, 10) : (values[key] as string)}`,
  );
  if (typeof values.photo_path === 'string' && values.photo_path) lines.push(t('activity.newPhoto'));
  return lines;
}

function RequestRow({ item }: { item: RequestItem }) {
  const { t } = useTranslation();
  const [declining, setDeclining] = useState(false);
  const details = changeLines(item, t);
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
          {details.map((line) => (
            <Text key={line} style={styles.detail}>{line}</Text>
          ))}
          <Text style={styles.when}>{timeAgo(item.at)}</Text>
        </View>
      </View>
      <ConfirmDialog
        visible={declining}
        title={t('activity.declineTitle')}
        message={t('activity.declineText')}
        confirmLabel={t('activity.decline')}
        danger
        onConfirm={() => {
          setDeclining(false);
          decide.mutate({ requestId: item.request_id, decision: 'decline' });
        }}
        onCancel={() => setDeclining(false)}
      />
      <View style={styles.buttons}>
        <SmallButton
          label={isAccess ? t('activity.allow') : t('activity.accept')}
          disabled={decide.isPending}
          onPress={() => decide.mutate({ requestId: item.request_id, decision: 'approve' })}
        />
        {original ? <SmallButton label={t('activity.edit')} kind="plain" onPress={() => setEditing(true)} /> : null}
        <SmallButton label={t('activity.decline')} kind="plain" disabled={decide.isPending} onPress={() => setDeclining(true)} />
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
  // Un-joining someone takes their place in the tree away from them: never on one stray tap.
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Plain text={textFor(item)} when={timeAgo(item.at)}>
        {item.person_id ? (
          <Pressable accessibilityRole="button" disabled={undo.isPending} onPress={() => setAsking(true)} style={styles.undo}>
            <Text style={styles.undoText}>{t('activity.wrongMatch')}</Text>
          </Pressable>
        ) : null}
      </Plain>
      {undo.isError ? <ErrorText>{errorText(undo.error)}</ErrorText> : null}
      <ConfirmDialog
        visible={asking}
        title={t('activity.wrongMatchTitle')}
        message={t('activity.wrongMatchHelp')}
        confirmLabel={t('activity.wrongMatchConfirm')}
        danger
        busy={undo.isPending}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          if (item.person_id) undo.mutate(item.person_id, { onSettled: () => setAsking(false) });
        }}
      />
    </>
  );
}

function ChangeRow({ item }: { item: ChangeItem }) {
  const { t } = useTranslation();
  const textFor = useActivityText();
  const timeAgo = useTimeAgo();
  const errorText = useErrorText();
  const revert = useRevert(item.tree_id);
  const [asking, setAsking] = useState(false);
  const undoLabel = item.rows > 1 ? t('history.undoAll') : t('history.undo');
  return (
    <>
      <Plain text={textFor(item)} when={timeAgo(item.at)}>
        {item.reverted ? <Text style={styles.when}>{t('history.undone')}</Text> : null}
        {item.can_revert ? (
          <Pressable accessibilityRole="button" disabled={revert.isPending} onPress={() => setAsking(true)} style={styles.undo}>
            <Text style={styles.undoText}>{undoLabel}</Text>
          </Pressable>
        ) : null}
      </Plain>
      {revert.isError ? <ErrorText>{errorText(revert.error)}</ErrorText> : null}
      <ConfirmDialog
        visible={asking}
        title={t('history.undoTitle')}
        message={`${textFor(item)}

${t('history.undoHelp')}`}
        confirmLabel={undoLabel}
        busy={revert.isPending}
        onCancel={() => setAsking(false)}
        onConfirm={() => revert.mutate({ batch_id: item.batch_id }, { onSettled: () => setAsking(false) })}
      />
    </>
  );
}

const styles = StyleSheet.create({
  about: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  header: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  tab: { minHeight: minTapSize, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card, justifyContent: 'center' },
  tabOn: { backgroundColor: colors.logoIndigo, borderColor: colors.logoIndigo },
  tabText: { color: colors.text, fontFamily: fonts.bold, fontSize: 13 },
  tabTextOn: { color: colors.white },
  list: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: TAB_BAR_SPACE, gap: 12 },
  card: { gap: 10, borderRadius: 22 },
  rowTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  text: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  when: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  detail: { color: colors.text, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 19 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingStart: 56 },
  mergePanel: { gap: 10 },
  glass: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.glass, alignItems: 'center', justifyContent: 'center' },
  mergeText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 15, lineHeight: 20 },
  mergeFound: { color: colors.onNeon, fontFamily: fonts.semibold, fontSize: 12 },
  plain: { flexDirection: 'row', gap: 12, paddingHorizontal: 4, alignItems: 'flex-start' },
  tick: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.whatsapp, alignItems: 'center', justifyContent: 'center' },
  whenRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  undo: { minHeight: minTapSize, minWidth: minTapSize, justifyContent: 'center' },
  undoText: { color: colors.relation, fontFamily: fonts.bold, fontSize: 12, textDecorationLine: 'underline' },
  scrim: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { alignSelf: 'stretch', backgroundColor: colors.background, borderRadius: 24, padding: 20, gap: 8 },
});
