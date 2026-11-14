// "Family links" on a person's page: their parents, partners and children, each link changeable (by birth,
// adopted, step, foster; married, divorced...) or removable, with buttons to add more. On top, a fix offered when
// the tree looks half linked: Sathana has only her father, who is married to Ezhilarasi, so "Is Ezhilarasi also
// Sathana's parent?". Nobody has to delete a person to fix a wrong link.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { Card, ConfirmDialog, ErrorText, Pills, SmallButton } from '@/components/ui';
import { api } from '@/lib/api';
import { useErrorText } from '@/lib/errors';
import { linkSuggestions } from '@/tree/linkSuggestions';
import type { Relation } from '@/tree/useEdit';
import type { TreeViewAnswer } from '@/tree/useTreeView';
import { colors, fonts } from '@/theme/tokens';

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

  const nameOf = (id: string) => {
    const n = data.nodes.find((x) => x.id === id);
    return !n ? '' : n.nameUnknown ? t('tree.nameNotKnown') : n.name;
  };
  const refresh = () =>
    Promise.all([client.invalidateQueries({ queryKey: ['tree-view', treeId] }), client.invalidateQueries({ queryKey: ['trees'] })]);
  const run = useMutation({
    mutationFn: (job: () => Promise<unknown>) => job(),
    onMutate: () => setFailure(null),
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
    onError: (e) => setFailure(errorText(e)),
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

  function linkRow(parentId: string, childId: string, kind: string, otherId: string) {
    const key = `l:${parentId}:${childId}`;
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
              <Text style={styles.sub}>{kindLabel(kind)}</Text>
            </View>
          </Pressable>
          <SmallButton kind="plain" label={open ? t('links.done') : t('links.change')} onPress={() => setEditing(open ? null : key)} />
          <SmallButton
            kind="plain"
            label={t('links.remove')}
            onPress={() =>
              setRemoving({
                title: t('links.removeTitle'),
                message: t('links.removeParentMessage', { parent: nameOf(parentId), child: nameOf(childId) }),
                run: () => api.rpc('link_remove', { p_parent: parentId, p_child: childId }),
              })
            }
          />
        </View>
        {open ? (
          <Pills
            options={KINDS.map((k) => ({ value: k, label: kindLabel(k) }))}
            value={KINDS.includes(kind as LinkKind) ? (kind as LinkKind) : null}
            onChange={(k) => run.mutate(() => api.rpc('link_set_kind', { p_parent: parentId, p_child: childId, p_kind: k }))}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Text style={styles.section}>{t('links.title')}</Text>

      {suggestions.map((s) => (
        <Card key={s.key} style={styles.suggest}>
          <Text style={styles.suggestText}>{t('links.suggest', { parent: nameOf(s.parentId), child: nameOf(s.childId) })}</Text>
          <SmallButton
            kind="yellow"
            label={t('links.suggestYes')}
            disabled={run.isPending}
            onPress={() => run.mutate(() => api.rpc('add_relative', { p_anchor: s.childId, p_relation: 'parent', p_existing_person: s.parentId }))}
          />
        </Card>
      ))}

      <Card style={styles.card}>
        <View style={styles.head}>
          <Text style={styles.headText}>{t('links.parents')}</Text>
          <SmallButton kind="plain" label={t('links.addParent')} onPress={() => addLink('parent')} />
        </View>
        {parents.length === 0 ? <Text style={styles.none}>{t('links.noParents', { name: me })}</Text> : null}
        {parents.map((l) => linkRow(l.parent_id, l.child_id, l.kind ?? 'unknown', l.parent_id))}

        <View style={styles.head}>
          <Text style={styles.headText}>{t('links.partners')}</Text>
          <SmallButton kind="plain" label={t('links.addPartner')} onPress={() => addLink('spouse')} />
        </View>
        {unions.length === 0 ? <Text style={styles.none}>{t('links.noPartners', { name: me })}</Text> : null}
        {unions.map((u) => {
          const other = (u.partner1_id === personId ? u.partner2_id : u.partner1_id) as string;
          const key = `u:${u.id}`;
          const open = editing === key;
          const status = u.status ?? 'unknown';
          return (
            <View key={key} style={styles.rowBox}>
              <View style={styles.row}>
                <Pressable accessibilityRole="link" onPress={() => onOpen(other)} style={styles.who}>
                  <Avatar personId={other} size={34} photoUrl={data.nodes.find((n) => n.id === other)?.photoUrl ?? null} name={nameOf(other)} />
                  <View style={styles.whoText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {nameOf(other)}
                    </Text>
                    <Text style={styles.sub}>{statusLabel(status)}</Text>
                  </View>
                </Pressable>
                <SmallButton kind="plain" label={open ? t('links.done') : t('links.change')} onPress={() => setEditing(open ? null : key)} />
                <SmallButton
                  kind="plain"
                  label={t('links.remove')}
                  onPress={() =>
                    setRemoving({
                      title: t('links.removeTitle'),
                      message: t('links.removePartnerMessage', { a: me, b: nameOf(other) }),
                      run: () => api.rpc('union_remove', { p_union: u.id }),
                    })
                  }
                />
              </View>
              {open ? (
                <Pills
                  options={STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
                  value={STATUSES.includes(status as UnionStatus) ? (status as UnionStatus) : null}
                  onChange={(s) => run.mutate(() => api.rpc('union_set_status', { p_union: u.id, p_status: s }))}
                />
              ) : null}
            </View>
          );
        })}

        <View style={styles.head}>
          <Text style={styles.headText}>{t('links.children')}</Text>
          <SmallButton kind="plain" label={t('links.addChild')} onPress={() => addLink('child')} />
        </View>
        {children.length === 0 ? <Text style={styles.none}>{t('links.noChildren', { name: me })}</Text> : null}
        {children.map((l) => linkRow(l.parent_id, l.child_id, l.kind ?? 'unknown', l.child_id))}

        <View style={styles.head}>
          <Text style={styles.headText}>{t('links.siblings')}</Text>
          <SmallButton kind="plain" label={t('links.addSibling')} onPress={() => addLink('sibling')} />
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
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  headText: { color: colors.muted, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  rowBox: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  who: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  whoText: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  sub: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  none: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13 },
  suggest: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.tint },
  suggestText: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 14, lineHeight: 20 },
});
