// F-NOT-01: the sender picks who hears it. Whole tree, a branch, chosen people or a group. There is no 'everyone'.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Checkbox, Field, Label, Pills } from '@/components/ui';
import { api } from '@/lib/api';
import { Gate, Note, Row, useName } from '@/social/parts';
import type { Audience, Circles, PersonRow } from '@/social/types';

type Kind = Audience['type'];

export function useCircles() {
  return useQuery({ queryKey: ['social-circles'], queryFn: () => api.rpc<Circles>('social_circles') });
}

export function usePeople(treeId?: string | null, groupId?: string | null) {
  return useQuery({
    queryKey: ['social-people', treeId ?? null, groupId ?? null],
    queryFn: () =>
      api.rpc<PersonRow[]>('social_people', {
        ...(treeId ? { p_tree: treeId } : {}),
        ...(groupId ? { p_group: groupId } : {}),
      }),
  });
}

/** Tick people from the caller's own circle. Names only: no numbers ever reach this list. */
export function PeoplePicker({ treeId, groupId, chosen, onChange }: { treeId?: string | null; groupId?: string | null; chosen: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useTranslation();
  const showName = useName();
  const people = usePeople(treeId, groupId);
  const [search, setSearch] = useState('');
  return (
    <Gate query={people}>
      {(list) => {
        if (list.length === 0) return <Note>{t('social.audience.nobody')}</Note>;
        const needle = search.trim().toLowerCase();
        const shown = needle ? list.filter((p) => p.name.toLowerCase().includes(needle)) : list;
        return (
          <View style={styles.list}>
            {list.length > 8 ? <Field label={t('social.audience.searchPeople')} value={search} onChangeText={setSearch} /> : null}
            {shown.map((p) => (
              <Checkbox
                key={p.profile_id}
                label={showName(p.name)}
                on={chosen.includes(p.profile_id)}
                onChange={(on) => onChange(on ? [...chosen, p.profile_id] : chosen.filter((x) => x !== p.profile_id))}
              />
            ))}
          </View>
        );
      }}
    </Gate>
  );
}

/** Finds a person in a tree through the tree area's search. */
export function PersonSearch({ treeId, label, onPick }: { treeId: string; label: string; onPick: (person: { id: string; name: string }) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const found = useQuery({
    queryKey: ['tree-search', treeId, q],
    enabled: q.trim().length >= 2,
    queryFn: () => api.get<{ id: string; name: string; relation?: string }[]>(`/trees/${treeId}/search?q=${encodeURIComponent(q.trim())}`),
  });
  return (
    <View style={styles.list}>
      <Field label={label} value={q} onChangeText={setQ} placeholder={t('social.audience.typeName')} />
      {(found.data ?? []).slice(0, 8).map((p) => (
        <Row key={p.id} title={p.name} subtitle={p.relation} onPress={() => { onPick({ id: p.id, name: p.name }); setQ(''); }} />
      ))}
      {found.isSuccess && found.data.length === 0 ? <Note>{t('social.audience.noMatch')}</Note> : null}
    </View>
  );
}

/** Reports a complete choice, or null while one is still being made. */
export function AudiencePicker({ onChange, kinds }: { onChange: (audience: Audience | null) => void; kinds?: Kind[] }) {
  const { t } = useTranslation();
  const circles = useCircles();
  const [kind, setKind] = useState<Kind | null>(null);
  const [treeId, setTreeId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [branch, setBranch] = useState<{ id: string; name: string } | null>(null);
  const [people, setPeople] = useState<string[]>([]);

  useEffect(() => {
    if (kind === 'tree' && treeId) onChange({ type: 'tree', tree_id: treeId });
    else if (kind === 'branch' && treeId && branch) onChange({ type: 'branch', tree_id: treeId, person_id: branch.id });
    else if (kind === 'group' && groupId) onChange({ type: 'group', group_id: groupId });
    else if (kind === 'people' && people.length > 0) onChange({ type: 'people', profile_ids: people });
    else onChange(null);
    // onChange is a fresh function on each render of the parent; only the choice itself matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, treeId, groupId, branch, people]);

  const allowed = kinds ?? (['tree', 'branch', 'people', 'group'] as Kind[]);
  // Start on the usual answer, so nobody wonders why the send button waits: the whole family tree, and the
  // tree itself when there is only one to pick. The person can still change both.
  const loaded = circles.data;
  useEffect(() => {
    if (!loaded) return;
    const wholeTrees = loaded.trees.filter((x) => x.whole_tree);
    if (kind === null) {
      if (allowed.includes('tree') && wholeTrees.length > 0) setKind('tree');
      else if (allowed.includes('group') && loaded.groups.length > 0) setKind('group');
      return;
    }
    const choices = kind === 'tree' ? wholeTrees : kind === 'branch' ? loaded.trees : [];
    if (choices.length > 0 && !choices.some((x) => x.id === treeId)) setTreeId(choices[0].id);
    if (kind === 'group' && !groupId && loaded.groups.length === 1) setGroupId(loaded.groups[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, kind]);

  return (
    <Gate query={circles}>
      {(data) => {
        const wholeTrees = data.trees.filter((x) => x.whole_tree);
        const options = allowed
          .filter((k) => (k === 'group' ? data.groups.length > 0 : k === 'tree' ? wholeTrees.length > 0 : k === 'branch' ? data.trees.length > 0 : true))
          .map((k) => ({ value: k, label: t(`social.audience.${k}`) }));
        const treeChoices = kind === 'tree' ? wholeTrees : data.trees;
        return (
          <View style={styles.list}>
            <Label>{t('social.audience.who')}</Label>
            <Pills options={options} value={kind} onChange={(k) => { setKind(k); setBranch(null); }} />
            {kind === 'tree' || kind === 'branch' ? (
              <Pills options={treeChoices.map((x) => ({ value: x.id, label: x.name }))} value={treeId} onChange={(v) => { setTreeId(v); setBranch(null); }} />
            ) : null}
            {kind === 'branch' && treeId ? (
              branch ? (
                <Row title={t('social.audience.branchOf', { name: branch.name })} onPress={() => setBranch(null)} />
              ) : (
                <PersonSearch treeId={treeId} label={t('social.audience.branchTop')} onPick={setBranch} />
              )
            ) : null}
            {kind === 'group' ? (
              <Pills options={data.groups.map((g) => ({ value: g.id, label: g.name }))} value={groupId} onChange={setGroupId} />
            ) : null}
            {kind === 'people' ? <PeoplePicker chosen={people} onChange={setPeople} /> : null}
          </View>
        );
      }}
    </Gate>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
});
