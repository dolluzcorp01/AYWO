// S-06 Tree (wireframes A8, A9, B3, C1 for family). One screen with a view switch, as on the wireframes.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { PageLoader } from '@/components/Loaders';
import { SearchIcon, ShareIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { TabBar } from '@/components/TabBar';
import { Text } from '@/components/Text';
import { useErrorText } from '@/lib/errors';
import { canShare } from '@/tree/roles';
import { FamilyGuideCard } from '@/tree/FamilyGuideCard';
import { MyView } from '@/tree/MyView';
import { NamesTree } from '@/tree/NamesTree';
import { SeeAsPicker } from '@/tree/SeeAsPicker';
import { useTreeView } from '@/tree/useTreeView';
import type { TreeMode } from '@/tree/useTreeView';
import { ViewSwitch } from '@/tree/ViewSwitch';
import { colors, fonts, minTapSize } from '@/theme/tokens';

export default function TreeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const [mode, setMode] = useState<TreeMode>('mine');
  const [seeAsId, setSeeAsId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const query = useTreeView(id, mode, i18n.language, seeAsId);
  const data = query.data;
  // A branch share can point at a card outside the branch, which is not in nodes. That person has no 'My view'.
  const viewerId = data?.viewer_person_id && data.nodes.some((n) => n.id === data.viewer_person_id) ? data.viewer_person_id : null;
  const canSeeAs = data?.role === 'creator' || data?.role === 'co_creator';

  // Someone who has not found their own card yet has no 'My view' (for example a Creator who skipped A7).
  useEffect(() => {
    if (data && !viewerId && mode === 'mine') setMode('names');
  }, [data, viewerId, mode]);

  // A new viewpoint starts with that person in the centre.
  useEffect(() => {
    setFocusId(viewerId);
  }, [viewerId]);


  function changeMode(next: TreeMode) {
    if (next === 'see_as') {
      setPicking(true);
      return;
    }
    setSeeAsId(null);
    setMode(next);
  }

  const here = { treeId: id, mode, ...(seeAsId ? { seeAs: seeAsId } : {}) };
  const openPerson = (personId: string) => router.push({ pathname: '/person/[personId]', params: { personId, ...here } });
  const askWord = (personId: string) => router.push({ pathname: '/word/[personId]', params: { personId, ...here } });
  const addTo = (personId: string) => router.push({ pathname: '/add/[treeId]', params: { treeId: id, anchor: personId } });

  const seeingAsName = mode === 'see_as' ? data?.nodes.find((n) => n.id === viewerId)?.name : undefined;
  const subtitle = seeingAsName ? t('tree.seeingAs', { name: seeingAsName }) : mode === 'names' ? t('tree.namesHelp') : null;

  return (
    <Screen flush>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <Text style={styles.eyebrow}>{t('tabs.family')}</Text>
            <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>{data?.tree.name ?? ''}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('search.title')}
            onPress={() => router.push({ pathname: '/search/[treeId]', params: { treeId: id } })}
            style={styles.iconButton}
          >
            <SearchIcon color={colors.text} />
          </Pressable>
          {canShare(data?.role) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('share.action')}
              onPress={() => router.push({ pathname: '/share/[treeId]', params: { treeId: id } })}
            >
              <View style={styles.iconButton}>
                <ShareIcon color={colors.text} />
              </View>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.switchWrap}>
          <ViewSwitch mode={mode} onChange={changeMode} canSeeAs={canSeeAs} hasOwnPlace={!!viewerId || mode === 'see_as'} />
        </View>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      {query.isError ? (
        <View style={styles.centre}>
          <Text style={styles.message}>{errorText(query.error)}</Text>
          <Pressable accessibilityRole="button" onPress={() => query.refetch()} style={styles.retry}>
            <Text style={styles.retryText}>{t('tree.tryAgain')}</Text>
          </Pressable>
        </View>
      ) : !data ? (
        <View style={styles.centre}>
          <PageLoader label={t('tree.loading')} />
        </View>
      ) : data.nodes.length === 0 ? (
        <View style={styles.centre}>
          <Text style={styles.message}>{t('tree.empty')}</Text>
        </View>
      ) : mode === 'names' ? (
        <NamesTree data={data} viewerId={viewerId} onOpenPerson={openPerson} />
      ) : viewerId ? (
        <MyView
          data={data}
          viewerId={viewerId}
          focusId={focusId && data.nodes.some((n) => n.id === focusId) ? focusId : viewerId}
          seeingAs={mode === 'see_as'}
          onFocus={setFocusId}
          onOpenPerson={openPerson}
          onAskWord={askWord}
          onShowAll={() => changeMode('names')}
          onAdd={mode === 'see_as' ? undefined : addTo}
        >
          {mode === 'mine' ? <FamilyGuideCard treeId={id} tree={data} me={viewerId} /> : null}
        </MyView>
      ) : null}

      <TabBar active="family" treeId={id} anchorId={focusId} />

      {data ? (
        <SeeAsPicker
          visible={picking}
          people={data.nodes}
          onClose={() => setPicking(false)}
          onPick={(personId) => {
            setPicking(false);
            setSeeAsId(personId);
            setMode('see_as');
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10, gap: 12 },
  switchWrap: { width: '100%', maxWidth: 520, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleText: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.muted, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 28, letterSpacing: -0.9, lineHeight: 34 },
  subtitle: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  iconButton: {
    width: minTapSize,
    height: minTapSize,
    borderRadius: minTapSize / 2,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  message: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15, textAlign: 'center' },
  retry: { minHeight: minTapSize, justifyContent: 'center', paddingHorizontal: 16 },
  retryText: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 15 },
});
