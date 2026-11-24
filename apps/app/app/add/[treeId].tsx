// E1 / S-09 Add a relative: who to, which relation, which partner, how. Then someone new (E2) or someone already in the tree.
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/lib/router';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { showToast } from '@/components/Toast';
import { Avatar } from '@/components/Avatar';
import { DownIcon, RightIcon, RingsIcon, UpIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ErrorText, Loading, LoadFailed, NeonPanel, Pills, PrimaryButton, SectionTitle, TextButton, TopBar } from '@/components/ui';
import { useErrorText } from '@/lib/errors';
import { AlsoParentOf } from '@/tree/AlsoParentOf';
import { alsoChildCandidates } from '@/tree/alsoChildren';
import { FarRelativePicker } from '@/tree/FarRelativePicker';
import type { FarRelative } from '@/tree/farRelatives';
import { PersonPicker } from '@/tree/PersonPicker';
import { useAddRelative } from '@/tree/useEdit';
import type { LinkKind, Relation } from '@/tree/useEdit';
import { useTreeView } from '@/tree/useTreeView';
import { colors, fonts, gradients, minTapSize } from '@/theme/tokens';

const NO_PARTNER = 'none';

export default function AddRelative() {
  const params = useLocalSearchParams<{ treeId: string; anchor?: string; relation?: string }>();
  const { treeId } = params;
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const tree = useTreeView(treeId, 'mine', i18n.language, null);
  const add = useAddRelative(treeId);

  const [anchorId, setAnchorId] = useState<string | null>(params.anchor ?? null);
  // 'Add parent' and the like on a person's Family links open with that choice already made.
  const [relation, setRelation] = useState<Relation>(
    params.relation === 'parent' || params.relation === 'spouse' || params.relation === 'sibling' ? params.relation : 'child',
  );
  const [unionChoice, setUnionChoice] = useState<string | null>(null);
  const [linkKind, setLinkKind] = useState<LinkKind>('birth');
  const [picking, setPicking] = useState<'anchor' | 'existing' | null>(null);
  const [requested, setRequested] = useState(false);
  // Brothers and sisters unticked by the person (everyone offered starts ticked).
  const [unticked, setUnticked] = useState<string[]>([]);
  // "More relatives": an uncle, a cousin, an in-law. Open while choosing; once chosen, who it was started from.
  const [farOpen, setFarOpen] = useState(false);
  const [far, setFar] = useState<{ fromId: string; choice: FarRelative } | null>(null);

  const data = tree.data;

  // With no anchor from the screen before, start from the person's own card.
  useEffect(() => {
    if (!anchorId && data?.viewer_person_id) setAnchorId(data.viewer_person_id);
  }, [anchorId, data?.viewer_person_id]);

  if (tree.isError) {
    return (
      <Screen>
        <LoadFailed message={errorText(tree.error)} onRetry={() => tree.refetch()} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen>
        <TopBar title={t('add.title')} onBack={() => goBack(router)} close />
        <Loading label={t('tree.loading')} />
      </Screen>
    );
  }

  const anchor = data.nodes.find((n) => n.id === anchorId) ?? null;
  const partners = anchor
    ? data.unions
        .filter((u) => u.partner1_id === anchor.id || u.partner2_id === anchor.id)
        .map((u) => {
          const partnerId = u.partner1_id === anchor.id ? u.partner2_id : u.partner1_id;
          return {
            unionId: u.id,
            person: data.nodes.find((n) => n.id === partnerId) ?? null,
            children: data.links.filter((l) => l.union_id === u.id && l.parent_id === anchor.id).length,
          };
        })
    : [];
  const unionId = unionChoice === NO_PARTNER ? null : (unionChoice ?? partners[0]?.unionId ?? null);
  const showPartners = relation === 'child' && partners.length > 0;
  const showHow = relation !== 'spouse';
  const alsoPeople =
    anchor && relation === 'parent'
      ? alsoChildCandidates(data.nodes, data.links, anchor.id).map((n) => ({ id: n.id, name: n.nameUnknown ? t('tree.nameNotKnown') : n.name }))
      : [];
  const alsoTicked = alsoPeople.map((p) => p.id).filter((id) => !unticked.includes(id));

  const relations: { value: Relation; label: string; icon: (color: string) => ReactNode }[] = [
    { value: 'parent', label: t('add.parent'), icon: (c) => <UpIcon color={c} /> },
    { value: 'spouse', label: t('add.partner'), icon: (c) => <RingsIcon color={c} /> },
    { value: 'child', label: t('add.child'), icon: (c) => <DownIcon color={c} /> },
    { value: 'sibling', label: t('add.sibling'), icon: (c) => <RightIcon color={c} /> },
  ];

  const shown = (id: string) => {
    const node = data.nodes.find((n) => n.id === id);
    return !node || node.nameUnknown ? t('tree.nameNotKnown') : node.name;
  };

  /** Points the screen at another person: every choice made for the last one is forgotten. */
  function lookFrom(personId: string) {
    setAnchorId(personId);
    setUnionChoice(null);
    setUnticked([]);
  }

  function pickFar(throughId: string, choice: FarRelative) {
    if (!anchor) return;
    // Chosen twice in a row (cousin, then the cousin's child): still counted from where the first one started.
    setFar({ fromId: far?.fromId ?? anchor.id, choice });
    lookFrom(throughId);
    setRelation(choice.relation);
    setFarOpen(false);
  }

  /** The person in between is not in the tree yet: start adding them. */
  function addFirst(missing: 'father' | 'mother' | 'sibling' | 'child' | 'partner') {
    if (!anchor || !data) return;
    setFarOpen(false);
    if (missing === 'father' || missing === 'mother') {
      const also = alsoChildCandidates(data.nodes, data.links, anchor.id).map((n) => n.id);
      router.push({
        pathname: '/person-details',
        params: { treeId, anchor: anchor.id, relation: 'parent', linkKind: 'birth', gender: missing === 'father' ? 'male' : 'female', ...(also.length ? { also: also.join(',') } : {}) },
      });
      return;
    }
    // Straight to the form for that person: the button said "Add the husband or wife", so it adds, not only selects.
    const first: Relation = missing === 'partner' ? 'spouse' : missing;
    setRelation(first);
    // A child belongs to both parents. With one husband or wife in the tree the child is linked to them too; with
    // several, this screen stays open on "Child" so the other parent is chosen first. Before this the child was
    // linked to one parent only.
    if (first === 'child' && partners.length > 1) return;
    const withPartner = first === 'child' && partners[0] ? { union: partners[0].unionId } : {};
    router.push({ pathname: '/person-details', params: { treeId, anchor: anchor.id, relation: first, ...(first === 'spouse' ? {} : { linkKind: 'birth' }), ...withPartner } });
  }

  function someoneNew() {
    if (!anchor) return;
    router.push({
      pathname: '/person-details',
      params: {
        treeId,
        anchor: anchor.id,
        relation,
        linkKind,
        ...(showPartners && unionId ? { union: unionId } : {}),
        ...(alsoPeople.length ? { also: alsoTicked.join(',') } : {}),
      },
    });
  }

  function linkExisting(personId: string) {
    setPicking(null);
    if (!anchor) return;
    add.mutate(
      {
        p_anchor: anchor.id,
        p_relation: relation,
        p_existing_person: personId,
        ...(showPartners && unionId ? { p_union: unionId } : {}),
        ...(showHow ? { p_link_kind: linkKind } : {}),
        ...(alsoTicked.length ? { p_also_children: alsoTicked.filter((id) => id !== personId) } : {}),
      },
      {
        onSuccess: (answer) => {
          if (answer.status === 'requested') setRequested(true);
          else {
            showToast('success', t('common.saved'));
            goBack(router);
          }
        },
      },
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TopBar title={t('add.title')} onBack={() => goBack(router)} close />

        <NeonPanel style={styles.anchorPanel}>
          {anchor ? <Avatar personId={anchor.id} size={48} photoUrl={anchor.photoUrl} nameUnknown={anchor.nameUnknown} /> : null}
          <View style={styles.anchorText}>
            <Text style={styles.anchorHelp}>{anchor ? t('add.relativeOf') : t('add.chooseAnchor')}</Text>
            {anchor ? <Text style={styles.anchorName}>{anchor.nameUnknown ? t('tree.nameNotKnown') : anchor.name}</Text> : null}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setFarOpen(false);
              setPicking('anchor');
            }}
            style={styles.change}
          >
            <Text style={styles.changeText}>{t('add.change')}</Text>
          </Pressable>
        </NeonPanel>

        {far && anchor ? (
          <View style={styles.farNote}>
            <Text style={styles.farNoteText}>
              {t('add.far.now', { relative: t(`add.far.kinds.${far.choice.key}`), from: shown(far.fromId), through: shown(anchor.id), link: t(`add.far.link.${far.choice.relation}`) })}
            </Text>
            <TextButton
              label={t('add.far.back', { name: shown(far.fromId) })}
              onPress={() => {
                lookFrom(far.fromId);
                setFar(null);
              }}
            />
          </View>
        ) : null}

        <SectionTitle>{t('add.who')}</SectionTitle>
        <View accessibilityRole="radiogroup" style={styles.relations}>
          {relations.map((r) => {
            const on = r.value === relation;
            const content = (
              <>
                {r.icon(on ? colors.white : colors.text)}
                <Text style={[styles.relationText, on && styles.relationTextOn]}>{r.label}</Text>
              </>
            );
            return (
              <Pressable
                key={r.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => setRelation(r.value)}
                style={styles.relationWrap}
              >
                {on ? (
                  <LinearGradient colors={gradients.button} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.relation}>
                    {content}
                  </LinearGradient>
                ) : (
                  <View style={[styles.relation, styles.relationOff]}>{content}</View>
                )}
              </Pressable>
            );
          })}
        </View>

        {anchor ? (
          farOpen ? (
            <FarRelativePicker family={data} anchorId={anchor.id} anchorName={shown(anchor.id)} nameOf={shown} onPick={pickFar} onAddFirst={addFirst} onClose={() => setFarOpen(false)} />
          ) : (
            <TextButton label={t('add.far.open')} onPress={() => setFarOpen(true)} />
          )
        ) : null}

        {showPartners ? (
          <>
            <SectionTitle>{t('add.whichPartner')}</SectionTitle>
            {partners.map((p) => (
              <PartnerRow
                key={p.unionId}
                on={unionId === p.unionId}
                name={p.person ? (p.person.nameUnknown ? t('tree.nameNotKnown') : p.person.name) : t('tree.nameNotKnown')}
                note={p.children === 0 ? t('add.noChildren') : t('add.children', { count: p.children })}
                onPress={() => setUnionChoice(p.unionId)}
              />
            ))}
            <PartnerRow on={unionId === null} name={t('add.someoneElse')} onPress={() => setUnionChoice(NO_PARTNER)} />
          </>
        ) : null}

        <AlsoParentOf
          people={alsoPeople}
          ticked={alsoTicked}
          onChange={(ids) => setUnticked(alsoPeople.map((p) => p.id).filter((id) => !ids.includes(id)))}
        />

        {showHow ? (
          <>
            <SectionTitle>{t('add.how')}</SectionTitle>
            <Pills
              value={linkKind}
              onChange={setLinkKind}
              options={[
                { value: 'birth', label: t('add.byBirth') },
                { value: 'adopted', label: t('add.adopted') },
                { value: 'step', label: t('add.step') },
                { value: 'foster', label: t('add.foster') },
              ]}
            />
          </>
        ) : null}

        {add.isError ? <ErrorText>{errorText(add.error)}</ErrorText> : null}
        {requested ? <Text style={styles.requested}>{t('details.addRequested')}</Text> : null}
      </ScrollView>

      <PrimaryButton label={t('add.someoneNew')} onPress={someoneNew} disabled={!anchor || add.isPending} />
      <TextButton label={t('add.alreadyInTree')} onPress={() => setPicking('existing')} disabled={!anchor || add.isPending} />

      <PersonPicker
        visible={picking !== null}
        title={picking === 'anchor' ? t('add.chooseAnchor') : t('add.alreadyInTree')}
        people={data.nodes}
        excludeId={picking === 'existing' ? anchor?.id : null}
        onClose={() => setPicking(null)}
        onPick={(personId) => {
          if (picking === 'anchor') {
            lookFrom(personId);
            // Chosen by hand: no longer the uncle or cousin of the person it started from.
            setFar(null);
            setPicking(null);
          } else {
            linkExisting(personId);
          }
        }}
      />
    </Screen>
  );
}

function PartnerRow({ name, note, on, onPress }: { name: string; note?: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={onPress} style={[styles.partner, on && styles.partnerOn]}>
      <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
      <Text style={styles.partnerName}>{name}</Text>
      {note ? <Text style={styles.partnerNote}>{note}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 12, paddingBottom: 12 },
  anchorPanel: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  anchorText: { flex: 1, minWidth: 0 },
  anchorHelp: { color: colors.onNeon, fontFamily: fonts.semibold, fontSize: 13 },
  anchorName: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 17 },
  change: { minHeight: minTapSize, justifyContent: 'center', paddingHorizontal: 6 },
  changeText: { color: colors.logoYellow, fontFamily: fonts.extrabold, fontSize: 14, textDecorationLine: 'underline' },
  relations: { flexDirection: 'row', gap: 8 },
  relationWrap: { flex: 1 },
  relation: { minHeight: 80, borderRadius: 20, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 2 },
  relationOff: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  relationText: { color: colors.text, fontFamily: fonts.bold, fontSize: 13 },
  relationTextOn: { color: colors.white },
  partner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  partnerOn: { borderWidth: 2, borderColor: colors.logoPurple },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.dashed, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.logoPurple, backgroundColor: colors.logoPurple },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.white },
  partnerName: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  partnerNote: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  farNote: { gap: 2, padding: 14, borderRadius: 18, backgroundColor: colors.tint },
  farNoteText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  requested: { color: colors.relation, fontFamily: fonts.bold, fontSize: 14, lineHeight: 20 },
});
