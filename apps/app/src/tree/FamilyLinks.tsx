// "Family links" on a person's page: their parents, partners and children, each link changeable (by birth,
// adopted, step, foster; married, divorced...) or removable, with buttons to add more. On top, a fix offered when
// the tree looks half linked: Divya has only her father, who is married to Lakshmi, so "Is Lakshmi also
// Divya's parent?". Nobody has to delete a person to fix a wrong link.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { CloseIcon, PencilIcon } from '@/components/Icons';
import { Text } from '@/components/Text';
import { Card, ConfirmDialog, ErrorText, Pills, SmallButton, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { errorCode, useErrorText } from '@/lib/errors';
import { linkSuggestions } from '@/tree/linkSuggestions';
import { shownName } from '@/tree/personName';
import { refreshFamilyDates, useAddRelative } from '@/tree/useEdit';
import type { Relation } from '@/tree/useEdit';
import type { TreeViewAnswer } from '@/tree/useTreeView';
import { colors, fonts, minTapSize } from '@/theme/tokens';

type LinkKind = 'birth' | 'adopted' | 'step' | 'foster' | 'unknown';
type UnionStatus = 'current' | 'divorced' | 'separated' | 'widowed' | 'annulled' | 'unknown';
const KINDS: LinkKind[] = ['birth', 'adopted', 'step', 'foster'];
const STATUSES: UnionStatus[] = ['current', 'divorced', 'separated', 'widowed'];

export function FamilyLinks({ data, personId, treeId, onOpen }: { data: TreeViewAnswer; personId: string; treeId: string; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const errorText = useErrorText();
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ title: string; message: string; run: () => Promise<unknown> } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Suggested links this person may not make directly: they went to the Creator, and say so in place of the button.
  const [asked, setAsked] = useState<string[]>([]);
  // The same add everyone else uses: saved directly, or sent to the Creator to approve for those who must ask.
  const add = useAddRelative(treeId);

  const nameOf = (id: string) => {
    const n = data.nodes.find((x) => x.id === id);
    return !n ? '' : shownName(t, n.name, n.nameUnknown);
  };
  const refresh = () => {
    // A link changes who is married to whom and whose child is whose: the calendar reads the same family.
    refreshFamilyDates(client);
    return Promise.all([client.invalidateQueries({ queryKey: ['tree-view', treeId] }), client.invalidateQueries({ queryKey: ['trees'] })]);
  };
  const run = useMutation({
    mutationFn: (job: () => Promise<unknown>) => job(),
    onMutate: () => setFailure(null),
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
    // Changing or removing a link is for those who may edit the whole tree directly. Anyone else is told who can,
    // rather than a bare "not allowed".
    onError: (e) => setFailure(errorCode(e) === 'not_allowed' ? t('links.notAllowed') : errorText(e)),
  });

  const parents = data.links.filter((l) => l.child_id === personId);
  const children = data.links.filter((l) => l.parent_id === personId);
  const unions = data.unions.filter((u) => (u.partner1_id === personId || u.partner2_id === personId) && u.partner2_id);
  const suggestions = linkSuggestions(data, personId);
  // Brothers and sisters: anyone sharing a parent. Read-only here, they follow the parent links.
  const myParents = parents.map((l) => l.parent_id);
  const siblings = data.nodes
    .filter((n) => n.id !== personId)
    .map((n) => {
      const theirs = data.links.filter((l) => l.child_id === n.id).map((l) => l.parent_id);
      return { id: n.id, shared: theirs.filter((p) => myParents.includes(p)), theirs: theirs.length };
    })
    .filter((x) => x.shared.length > 0);
  const me = nameOf(personId);

  const addLink = (relation: Relation) => router.push({ pathname: '/add/[treeId]', params: { treeId, anchor: personId, relation } });
  const kindLabel = (k: string) => t(`links.kind.${KINDS.includes(k as LinkKind) ? k : 'unknown'}`);
  const statusLabel = (s: string) => t(`links.status.${STATUSES.includes(s as UnionStatus) ? s : 'unknown'}`);

  /**
   * One person in a list. The row itself opens them; one quiet pencil opens the ways to change the link, and
   * Remove sits in there too. A Change and a Remove button on every row made the card a wall of buttons on a phone.
   */
  function personRow<T extends string>(key: string, otherId: string, sub: string, options: { value: T; label: string }[], value: T | null, onChange: (v: T) => void, remove: { message: string; run: () => Promise<unknown> }) {
    const open = editing === key;
    return (
      <View key={key} style={styles.rowBox}>
        <View style={styles.row}>
          <Pressable accessibilityRole="link" onPress={() => onOpen(otherId)} style={styles.who}>
            <Avatar personId={otherId} size={34} photoUrl={data.nodes.find((n) => n.id === otherId)?.photoUrl ?? null} name={nameOf(otherId)} />
            <View style={styles.whoText}>
              <Text style={styles.name} numberOfLines={1}>
                {nameOf(otherId)}
              </Text>
              <Text style={styles.sub}>{sub}</Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={open ? t('links.done') : t('links.changeFor', { name: nameOf(otherId) })}
            onPress={() => setEditing(open ? null : key)}
            style={styles.edit}
          >
            {open ? <CloseIcon color={colors.relation} size={16} /> : <PencilIcon color={colors.relation} size={18} />}
          </Pressable>
        </View>
        {open ? (
          <View style={styles.editBox}>
            <Pills options={options} value={value} onChange={onChange} />
            <TextButton danger label={t('links.removeLink')} onPress={() => setRemoving({ title: t('links.removeTitle'), ...remove })} />
          </View>
        ) : null}
      </View>
    );
  }

  function linkRow(parentId: string, childId: string, kind: string, otherId: string) {
    return personRow(
      `l:${parentId}:${childId}`,
      otherId,
      kindLabel(kind),
      KINDS.map((k) => ({ value: k, label: kindLabel(k) })),
      KINDS.includes(kind as LinkKind) ? (kind as LinkKind) : null,
      (k) => run.mutate(() => api.rpc('link_set_kind', { p_parent: parentId, p_child: childId, p_kind: k })),
      {
        message: t('links.removeParentMessage', { parent: nameOf(parentId), child: nameOf(childId) }),
        run: () => api.rpc('link_remove', { p_parent: parentId, p_child: childId }),
      },
    );
  }

  return (
    <View style={styles.box}>
      <Text style={styles.section}>{t('links.title')}</Text>

      {suggestions.map((s) => (
        <Card key={s.key} style={styles.suggest}>
          <Text style={styles.suggestText}>{t('links.suggest', { parent: nameOf(s.parentId), child: nameOf(s.childId) })}</Text>
          {asked.includes(s.key) ? (
            <Text accessibilityRole="alert" style={styles.asked}>{t('links.sentForApproval')}</Text>
          ) : (
            <SmallButton
              kind="yellow"
              label={t('links.suggestYes')}
              disabled={run.isPending}
              onPress={() =>
                run.mutate(async () => {
                  const answer = await add.mutateAsync({ p_anchor: s.childId, p_relation: 'parent', p_existing_person: s.parentId });
                  if (answer.status === 'requested') setAsked((now) => [...now, s.key]);
                })
              }
            />
          )}
        </Card>
      ))}

      <Card style={styles.card}>
        <View style={[styles.head, styles.headFirst]}>
          <Text style={styles.headText}>{t('links.parents')}</Text>
          <TextButton label={t('links.addParent')} onPress={() => addLink('parent')} />
        </View>
        {parents.length === 0 ? <Text style={styles.none}>{t('links.noParents', { name: me })}</Text> : null}
        {parents.map((l) => linkRow(l.parent_id, l.child_id, l.kind ?? 'unknown', l.parent_id))}

        <View style={styles.head}>
          <Text style={styles.headText}>{t('links.partners')}</Text>
          <TextButton label={t('links.addPartner')} onPress={() => addLink('spouse')} />
        </View>
        {unions.length === 0 ? <Text style={styles.none}>{t('links.noPartners', { name: me })}</Text> : null}
        {unions.map((u) => {
          const other = (u.partner1_id === personId ? u.partner2_id : u.partner1_id) as string;
          const status = u.status ?? 'unknown';
          return personRow(
            `u:${u.id}`,
            other,
            statusLabel(status),
            STATUSES.map((x) => ({ value: x, label: statusLabel(x) })),
            STATUSES.includes(status as UnionStatus) ? (status as UnionStatus) : null,
            (x) => run.mutate(() => api.rpc('union_set_status', { p_union: u.id, p_status: x })),
            { message: t('links.removePartnerMessage', { a: me, b: nameOf(other) }), run: () => api.rpc('union_remove', { p_union: u.id }) },
          );
        })}

        <View style={styles.head}>
          <Text style={styles.headText}>{t('links.children')}</Text>
          <TextButton label={t('links.addChild')} onPress={() => addLink('child')} />
        </View>
        {children.length === 0 ? <Text style={styles.none}>{t('links.noChildren', { name: me })}</Text> : null}
        {children.map((l) => linkRow(l.parent_id, l.child_id, l.kind ?? 'unknown', l.child_id))}

        <View style={styles.head}>
          <Text style={styles.headText}>{t('links.siblings')}</Text>
          <TextButton label={t('links.addSibling')} onPress={() => addLink('sibling')} />
        </View>
        {siblings.map((sib) => (
          <Pressable key={sib.id} accessibilityRole="link" onPress={() => onOpen(sib.id)} style={styles.who}>
            <Avatar personId={sib.id} size={34} photoUrl={data.nodes.find((n) => n.id === sib.id)?.photoUrl ?? null} name={nameOf(sib.id)} />
            <View style={styles.whoText}>
              <Text style={styles.name} numberOfLines={1}>
                {nameOf(sib.id)}
              </Text>
              <Text style={styles.sub}>
                {sib.shared.length === myParents.length && sib.theirs === myParents.length
                  ? t('links.sameParents')
                  : t('links.halfThrough', { name: sib.shared.map(nameOf).join(', ') })}
              </Text>
            </View>
          </Pressable>
        ))}
        <Text style={styles.none}>{t('links.siblingsHelp')}</Text>
      </Card>

      {failure ? <ErrorText>{failure}</ErrorText> : null}

      <ConfirmDialog
        visible={!!removing}
        title={removing?.title ?? ''}
        message={removing?.message ?? ''}
        confirmLabel={t('links.remove')}
        onConfirm={() => {
          const job = removing?.run;
          setRemoving(null);
          if (job) run.mutate(job);
        }}
        onCancel={() => setRemoving(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10 },
  section: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 17, marginTop: 6 },
  card: { gap: 8, paddingVertical: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, borderTopWidth: 1, borderColor: colors.cardBorder, paddingTop: 6 },
  headFirst: { borderTopWidth: 0, marginTop: 0, paddingTop: 0 },
  headText: { color: colors.muted, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  rowBox: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  edit: { width: minTapSize, height: minTapSize, borderRadius: minTapSize / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint },
  editBox: { gap: 2, alignItems: 'flex-start', paddingLeft: 44 },
  who: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  whoText: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  sub: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  none: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13 },
  suggest: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.tint },
  asked: { flexShrink: 1, maxWidth: '45%', color: colors.relation, fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 },
  suggestText: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 14, lineHeight: 20 },
});
