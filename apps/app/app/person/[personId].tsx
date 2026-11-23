// S-07 Person card (wireframes D1 open, D2 locked).
import { closeFamily, focusView, graphFromApi, relationText } from '@aywo/layout';
import { describePath } from '@aywo/kinship';
import type { PathWords } from '@aywo/kinship';
import { contactActions } from '@aywo/shared';
import type { ContactKind } from '@aywo/shared';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/lib/router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { PageLoader } from '@/components/Loaders';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goBack } from '@/lib/nav';
import { Avatar } from '@/components/Avatar';
import { OfflineBar } from '@/components/OfflineBar';
import { BackIcon, ContactIcon, LockIcon } from '@/components/ContactIcon';
import { CommentIcon, HistoryIcon, PencilIcon, PlusIcon, ShareIcon } from '@/components/Icons';
import { Text } from '@/components/Text';
import { showToast } from '@/components/Toast';
import { Card, ErrorText, PrimaryButton, SmallButton, TextButton } from '@/components/ui';
import { useErrorText } from '@/lib/errors';
import { showPhone } from '@/lib/phone';
import { canComment, canSeeHistory, canShare } from '@/tree/roles';
import { useAskForContacts, usePersonCard } from '@/tree/useCard';
import { dateForReading } from '@/tree/dateText';
import { FamilyLinks } from '@/tree/FamilyLinks';
import { shownFirstName, shownName } from '@/tree/personName';
import { useTreeView } from '@/tree/useTreeView';
import type { TreeMode } from '@/tree/useTreeView';
import { colors, fonts, gradients, minTapSize } from '@/theme/tokens';

const LABEL_KEY: Record<ContactKind, string> = { mobile: 'card.call', whatsapp: 'card.whatsapp', email: 'card.email' };

export default function PersonCard() {
  const params = useLocalSearchParams<{ personId: string; treeId: string; mode?: TreeMode; seeAs?: string }>();
  const { personId, treeId } = params;
  const mode: TreeMode = params.mode ?? 'mine';
  const seeAsId = params.seeAs ?? null;
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const errorText = useErrorText();
  // The coloured top runs up behind the clock. Once the page is scrolled, a band of the same colour stays there,
  // or the words of the page would slide up under the clock and the battery.
  const [scrolled, setScrolled] = useState(false);

  // Words come from the place being looked from. 'Names only' has none, so the card always asks for 'My view'.
  const tree = useTreeView(treeId, mode === 'see_as' ? 'see_as' : 'mine', i18n.language, seeAsId);
  const card = usePersonCard(personId);
  const ask = useAskForContacts(personId);

  const data = tree.data;
  const node = data?.nodes.find((n) => n.id === personId);
  const family = useMemo(
    () => (data ? closeFamily(focusView(graphFromApi(data), personId)) : []),
    [data, personId],
  );

  // A person who has left the tree also fails to load their card: that is "no longer in the tree", not an error to retry.
  const gone = !!data && !node;
  if (tree.isError || (card.isError && !gone)) {
    return (
      <View style={styles.centre}>
        <Text style={styles.message}>{errorText(tree.error ?? card.error)}</Text>
        <TextButton
          label={t('tree.tryAgain')}
          onPress={() => {
            if (tree.isError) void tree.refetch();
            if (card.isError) void card.refetch();
          }}
        />
        <TextButton label={t('card.goBack')} onPress={() => goBack(router)} />
      </View>
    );
  }
  if (data && !node) {
    return (
      <View style={styles.centre}>
        <Text style={styles.message}>{t('errors.person_not_found')}</Text>
        {/* In place of this card, so Back from the tree never comes here again. */}
        <TextButton label={t('guide.openTree')} onPress={() => router.dismissTo({ pathname: '/tree/[id]', params: { id: treeId } })} />
        <TextButton label={t('card.goBack')} onPress={() => goBack(router)} />
      </View>
    );
  }
  // Opened from an address that does not say which tree: nothing will ever load, so say so instead of spinning.
  if (!treeId) {
    return (
      <View style={styles.centre}>
        <Text style={styles.message}>{t('errors.person_not_found')}</Text>
        <TextButton label={t('card.goBack')} onPress={() => router.replace('/home')} />
      </View>
    );
  }
  if (!data || !node || !card.data) {
    return (
      <View style={styles.centre}>
        <PageLoader label={t('tree.loading')} />
      </View>
    );
  }

  const label = data.labels[personId];
  const relation = relationText(label);
  const word = relation.kind === 'word' ? relation.word : null;
  const native = label?.native;
  const pathWords = t('kin', { returnObjects: true }) as unknown as PathWords;
  const isMe = personId === data.viewer_person_id;
  const seer = mode === 'see_as' ? data.nodes.find((n) => n.id === data.viewer_person_id) : undefined;
  const seenBy = seer ? shownName(t, seer.name, seer.nameUnknown) : undefined;
  const firstName = shownFirstName(t, node.name, node.nameUnknown);

  const actions = contactActions(card.data.contacts);
  const locked = card.data.access === 'ask' || card.data.access === 'plus';
  const askFrom = card.data.ask_from ?? t('card.theCreator');

  function openPerson(id: string) {
    router.push({ pathname: '/person/[personId]', params: { personId: id, treeId, mode, ...(seeAsId ? { seeAs: seeAsId } : {}) } });
  }

  // The role in 'see as' is still the viewer's own. Adding and editing stay open to all family: the server saves it,
  // or files it with the Creator for anyone who may not write directly.
  const role = data.role;
  const actionsRow: { key: string; label: string; icon: ReactNode; onPress: () => void }[] = [
    {
      key: 'add',
      label: t('card.addRelative'),
      icon: <PlusIcon color={colors.logoPurple} size={22} width={2.4} />,
      onPress: () => router.push({ pathname: '/add/[treeId]', params: { treeId, anchor: personId } }),
    },
  ];
  // Inviting is for a living relative who is not me.
  if (canShare(role) && node.living !== 'deceased' && personId !== data.viewer_person_id) {
    actionsRow.push({
      key: 'invite',
      label: t('card.invite'),
      icon: <ShareIcon color={colors.logoPurple} size={22} />,
      onPress: () => router.push({ pathname: '/share/[treeId]', params: { treeId, personId } }),
    });
  }
  if (canComment(role)) {
    actionsRow.push({
      key: 'comment',
      label: t('card.comment'),
      icon: <CommentIcon color={colors.logoPurple} size={22} />,
      onPress: () => router.push({ pathname: '/comments/[personId]', params: { personId, treeId } }),
    });
  }
  if (canSeeHistory(role)) {
    actionsRow.push({
      key: 'history',
      label: t('card.history'),
      icon: <HistoryIcon color={colors.logoPurple} size={22} />,
      onPress: () => router.push({ pathname: '/history/[treeId]', params: { treeId, personId } }),
    });
  }

  // What is known about the person, readable without opening the edit form.
  const sayAbout = (date: string) => t('card.aboutDate', { date });
  const born = [dateForReading(node.birthDate, node.birthPrecision, i18n.language, sayAbout), node.birthPlace?.trim()].filter(Boolean).join(' · ');
  const passed = [dateForReading(node.deathDate, node.deathPrecision, i18n.language, sayAbout), node.deathPlace?.trim()].filter(Boolean).join(' · ');
  const about: [string, string][] = [
    [t('card.born'), born],
    [t('card.passedAway'), passed],
    [t('details.notes'), node.notes?.trim() ?? ''],
  ].filter((row): row is [string, string] => !!row[1]);

  return (
    <View style={styles.page}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        scrollEventThrottle={32}
        onScroll={(e) => {
          const now = e.nativeEvent.contentOffset.y > 4;
          if (now !== scrolled) setScrolled(now);
        }}
      >
        <LinearGradient colors={gradients.neon} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, { paddingTop: insets.top + 12 }]}>
          <View style={styles.heroTop}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('card.goBack')} onPress={() => goBack(router)} style={styles.round}>
              <BackIcon color={colors.white} />
            </Pressable>
            {seenBy ? <Text style={styles.seenBy}>{t('card.seenBy', { name: seenBy })}</Text> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('card.edit')}
              onPress={() => router.push({ pathname: '/person-details', params: { treeId, personId, from: 'card' } })}
              style={styles.round}
            >
              <PencilIcon color={colors.white} />
            </Pressable>
          </View>
          <Avatar personId={node.id} size={108} photoUrl={node.photoUrl} nameUnknown={node.nameUnknown} ring />
          <Text style={styles.name}>{shownName(t, node.name, node.nameUnknown)}</Text>
          {isMe && !seenBy ? <Text style={styles.you}>{t('tree.you')}</Text> : null}
          {word ? (
            <Pressable
              accessibilityRole="button"
              accessibilityHint={t('kinWord.different')}
              onPress={() => router.push({ pathname: '/kin-word/[personId]', params: { personId, treeId, mode, ...(seeAsId ? { seeAs: seeAsId } : {}) } })}
            >
              <LinearGradient colors={gradients.highlight} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.badge}>
                <Text style={styles.badgeText}>{native ? `${word} · ${native}` : word}</Text>
              </LinearGradient>
            </Pressable>
          ) : null}
          {relation.kind === 'ask' ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/word/[personId]', params: { personId, treeId, mode, ...(seeAsId ? { seeAs: seeAsId } : {}) } })}
              style={styles.askBadge}
            >
              <Text style={styles.badgeText}>{t('tree.askWord', { elder: relation.elder, younger: relation.younger })}</Text>
            </Pressable>
          ) : null}
          {label ? <Text style={styles.path}>{t('card.yourRelation', { path: describePath(label.pathCode, pathWords) })}</Text> : null}
          {label?.also ? <Text style={styles.path}>{t('card.also', { word: label.also.label })}</Text> : null}
        </LinearGradient>
        <OfflineBar inset />

        <View style={styles.body}>
          {actions.length > 0 ? (
            <View style={styles.actions}>
              {actions.map((action) =>
                action.url ? (
                  <OpenAction key={action.kind} kind={action.kind} label={t(LABEL_KEY[action.kind])} url={action.url} />
                ) : (
                  <View key={action.kind} style={styles.lockedAction} accessibilityLabel={t('card.locked', { what: t(LABEL_KEY[action.kind]) })}>
                    <View style={styles.lock}><LockIcon color={colors.muted} /></View>
                    <ContactIcon kind={action.kind} color={colors.muted} />
                    <Text style={styles.lockedText}>{t(LABEL_KEY[action.kind])}</Text>
                  </View>
                ),
              )}
            </View>
          ) : (
            <Text style={styles.note}>{t('card.noContacts')}</Text>
          )}

          {card.data.contacts.values && card.data.contacts.values.length > 0 ? <NumberList values={card.data.contacts.values} /> : null}

          {locked && actions.length > 0 ? (
            <Card>
              <Text style={styles.cardTitle}>{t('card.wantToCall', { name: firstName })}</Text>
              <Text style={styles.cardText}>
                {card.data.access === 'ask' ? t('card.askExplain', { name: askFrom }) : t('card.plusExplain')}
              </Text>
              {card.data.access === 'plus' ? (
                <View style={styles.plusButton}>
                  <SmallButton label={t('social.plus.action')} kind="yellow" onPress={() => router.push('/plus')} />
                </View>
              ) : null}
            </Card>
          ) : null}

          {card.data.access === 'ask' && actions.length > 0 ? (
            card.data.request_pending ? (
              <Text style={styles.note}>{t('card.askSent', { name: askFrom })}</Text>
            ) : (
              <PrimaryButton label={t('card.askFor', { name: askFrom })} onPress={() => ask.mutate()} disabled={ask.isPending} />
            )
          ) : null}
          {ask.isError ? <ErrorText>{t('card.askFailed')}</ErrorText> : null}

          {about.length > 0 ? (
            <Card>
              {about.map(([what, value]) => (
                <View key={what} style={styles.fact}>
                  <Text style={styles.factLabel}>{what}</Text>
                  <Text selectable style={styles.factValue}>{value}</Text>
                </View>
              ))}
            </Card>
          ) : null}

          {family.length > 0 ? (
            <>
              <Text style={styles.section}>{t('card.closeFamily')}</Text>
              <View style={styles.chips}>
                {family.map((id) => {
                  const person = data.nodes.find((n) => n.id === id);
                  if (!person) return null;
                  const other = relationText(data.labels[id]);
                  const shown = shownName(t, person.name, person.nameUnknown);
                  return (
                    <Pressable key={id} accessibilityRole="button" onPress={() => openPerson(id)} style={styles.chip}>
                      <Avatar personId={id} size={34} photoUrl={person.photoUrl} nameUnknown={person.nameUnknown} />
                      <Text style={styles.chipText}>
                        {id === data.viewer_person_id ? `${shown} · ${t('tree.you')}` : other.kind === 'word' ? `${shown} · ${other.word}` : shown}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          {canSeeHistory(role) ? <FamilyLinks data={data} personId={personId} treeId={treeId} onOpen={openPerson} /> : null}

          <View style={styles.toolRow}>
            {actionsRow.map((action) => (
              <Pressable key={action.key} accessibilityRole="button" onPress={action.onPress} style={styles.tool}>
                <View style={styles.toolIcon}>{action.icon}</View>
                <Text style={styles.toolText}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
      {scrolled && insets.top > 0 ? (
        <LinearGradient pointerEvents="none" colors={gradients.neon} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.clockBand, { height: insets.top }]} />
      ) : null}
    </View>
  );
}

const NUMBER_KEY: Record<ContactKind, string> = { mobile: 'card.numberMobile', whatsapp: 'card.numberWhatsapp', email: 'card.numberEmail' };
const NUMBER_ORDER: ContactKind[] = ['mobile', 'whatsapp', 'email'];

/** The numbers themselves, so they can be read out, written down or copied, not only tapped. */
function NumberList({ values }: { values: { kind: ContactKind; value: string }[] }) {
  const { t } = useTranslation();
  const rows = NUMBER_ORDER.flatMap((kind) => values.filter((v) => v.kind === kind));
  const copy = (text: string) => {
    Clipboard.setStringAsync(text).then(
      () => showToast('success', t('card.copied')),
      () => showToast('error', t('card.openFailed')),
    );
  };
  return (
    <View style={styles.numbers}>
      {rows.map((row, index) => {
        const text = row.kind === 'email' ? row.value : showPhone(row.value);
        const what = t(NUMBER_KEY[row.kind]);
        return (
          <View key={`${row.kind}-${index}`} style={[styles.numberRow, index > 0 && styles.numberLine]}>
            <View style={styles.numberText}>
              <Text style={styles.numberKind}>{what}</Text>
              <Text style={styles.numberValue} selectable>{text}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('card.copyLabel', { what })}
              onPress={() => copy(text)}
              style={({ hovered }: { hovered?: boolean }) => [styles.copy, hovered && styles.copyHover]}
            >
              <Text style={styles.copyText}>{t('card.copy')}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function OpenAction({ kind, label, url }: { kind: ContactKind; label: string; url: string }) {
  const { t } = useTranslation();
  // No dialler, no WhatsApp, no mail app: say so, rather than a button that does nothing.
  const open = () => {
    Linking.openURL(url).catch(() => showToast('error', t('card.openFailed')));
  };
  if (kind === 'email') {
    return (
      <Pressable accessibilityRole="link" onPress={open} style={[styles.action, styles.emailAction]}>
        <ContactIcon kind={kind} color={colors.text} />
        <Text style={[styles.actionText, { color: colors.text }]}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable accessibilityRole="link" onPress={open} style={styles.actionWrap}>
      <LinearGradient
        colors={kind === 'whatsapp' ? gradients.whatsapp : gradients.button}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.action}
      >
        <ContactIcon kind={kind} color={colors.white} />
        <Text style={styles.actionText}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  clockBand: { position: 'absolute', top: 0, left: 0, right: 0 },
  scroll: { flexGrow: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: colors.background },
  message: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15, textAlign: 'center' },
  textButton: { minHeight: minTapSize, justifyContent: 'center', paddingHorizontal: 16 },
  link: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 15 },
  hero: {
    borderBottomLeftRadius: 34,
    borderBottomRightRadius: 34,
    paddingHorizontal: 16,
    paddingBottom: 22,
    alignItems: 'center',
    gap: 8,
  },
  heroTop: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  round: {
    width: minTapSize,
    height: minTapSize,
    borderRadius: minTapSize / 2,
    backgroundColor: colors.glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seenBy: { color: colors.onNeon, fontFamily: fonts.semibold, fontSize: 12 },
  name: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 24, letterSpacing: -0.5, textAlign: 'center' },
  you: { color: colors.logoYellow, fontFamily: fonts.extrabold, fontSize: 14 },
  badge: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 3 },
  askBadge: { borderRadius: 14, paddingHorizontal: 14, minHeight: minTapSize, justifyContent: 'center', backgroundColor: colors.logoYellow },
  badgeText: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  path: { color: colors.onNeon, fontFamily: fonts.medium, fontSize: 14, textAlign: 'center' },
  body: { padding: 20, gap: 16 },
  actions: { flexDirection: 'row', gap: 10 },
  actionWrap: { flex: 1 },
  action: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 13, paddingHorizontal: 4, borderRadius: 20, minHeight: minTapSize },
  emailAction: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  actionText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 13 },
  lockedAction: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 13, paddingHorizontal: 4, borderRadius: 20, backgroundColor: colors.tint },
  lock: { position: 'absolute', top: 8, end: 10 },
  lockedText: { color: colors.muted, fontFamily: fonts.extrabold, fontSize: 13 },
  cardTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18, marginBottom: 8 },
  cardText: { color: colors.muted, fontFamily: fonts.medium, fontSize: 14, lineHeight: 21 },
  plusButton: { alignItems: 'flex-start', marginTop: 10 },
  numbers: { backgroundColor: colors.white, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 4 },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60 },
  numberLine: { borderTopWidth: 1, borderTopColor: colors.line },
  numberText: { flex: 1, gap: 2 },
  numberKind: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  numberValue: { color: colors.text, fontFamily: fonts.bold, fontSize: 17 },
  copy: { minHeight: minTapSize, minWidth: minTapSize, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1.5, borderColor: colors.logoIndigo, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  copyHover: { backgroundColor: colors.tintDeep },
  copyText: { color: colors.logoIndigo, fontFamily: fonts.extrabold, fontSize: 14 },
  note: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 14, textAlign: 'center' },
  section: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  fact: { paddingVertical: 6, gap: 2 },
  factLabel: { color: colors.muted, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase' },
  factValue: { color: colors.text, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 23 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: minTapSize,
    paddingVertical: 7,
    paddingStart: 7,
    paddingEnd: 14,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    maxWidth: '100%',
  },
  chipText: { color: colors.text, fontFamily: fonts.bold, fontSize: 13, flexShrink: 1 },
  toolRow: { flexDirection: 'row', justifyContent: 'space-around', gap: 8, marginTop: 8 },
  tool: { flex: 1, alignItems: 'center', gap: 6, minHeight: minTapSize },
  toolIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolText: { color: colors.text, fontFamily: fonts.bold, fontSize: 12, textAlign: 'center' },
});
