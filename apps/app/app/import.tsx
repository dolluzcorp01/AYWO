// S-13 Import. Pick a file, A6 'here's what we found', the gender list, A7 'Which one is you?', then one commit.
// Nothing joins a tree until import_commit. Someone not in the file adds their own card with tree_add_me straight after.
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Avatar } from '@/components/Avatar';
import { CheckIcon, DownloadIcon, PlusIcon, SearchIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Text, TextInput } from '@/components/Text';
import {
  BackButton,
  Card,
  ErrorText,
  Field,
  Heading,
  Muted,
  NeonPanel,
  Pills,
  PrimaryButton,
  SectionTitle,
  SmallButton,
  TextButton,
  TopBar,
} from '@/components/ui';
import { firstName, useMe } from '@/lib/account';
import { api, uploadFile } from '@/lib/api';
import { useErrorText } from '@/lib/errors';
import { pickImportFile } from '@/lib/pick';
import { relativesOf, withSplits } from '@/import/types';
import type { ImportAnswer, ImportedPerson, ImportGender, ImportPlaceholder, ImportPreview } from '@/import/types';
import { generationCount } from '@/tree/stats';
import { colors, fonts, minTapSize } from '@/theme/tokens';

type Step = 'pick' | 'checks' | 'gender' | 'which' | 'addMe';
type Relation = 'child' | 'parent' | 'spouse' | 'sibling';

interface Committed {
  tree_id: string;
  person_ids: Record<string, string>;
}

interface AddMeInput {
  anchorTemp: string;
  relation: Relation;
  name: string;
  gender: ImportGender;
}

const SHOWN_MATCHES = 30;

export default function ImportScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const errorText = useErrorText();
  const me = useMe();

  const [step, setStep] = useState<Step>('pick');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [wrongFile, setWrongFile] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [answer, setAnswer] = useState<ImportAnswer | null>(null);
  const [treeName, setTreeName] = useState('');
  const [genders, setGenders] = useState<Record<string, ImportGender>>({});
  // A6. 'No, two people' is the exception. A space is kept unless the person says to leave it out, as the wireframe shows.
  const [split, setSplit] = useState<Record<string, boolean>>({});
  const [leftOut, setLeftOut] = useState<Record<string, boolean>>({});
  // The tree is saved before the person's own card is added, so a failed second step never saves the tree twice.
  const [committed, setCommitted] = useState<Committed | null>(null);

  const splitIds = useMemo(() => Object.keys(split).filter((id) => split[id]), [split]);
  const preview = useMemo(() => (answer ? withSplits(answer.preview, splitIds) : null), [answer, splitIds]);
  const needGender = useMemo(() => (preview ? preview.persons.filter((p) => p.gender === 'unknown') : []), [preview]);
  const guessedGender = useMemo(() => (preview ? preview.persons.filter((p) => p.gender !== 'unknown' && p.genderGuessed) : []), [preview]);

  async function chooseFile() {
    setFailure(null);
    setWrongFile(null);
    try {
      const picked = await pickImportFile();
      if (picked.kind === 'cancelled') return;
      if (picked.kind === 'wrong_type') {
        setWrongFile(picked.name);
        return;
      }
      setBusy(true);
      const path = await uploadFile('imports', picked.file);
      const result = await api.post<ImportAnswer>('/import/upload', { source: picked.file.source, file_path: path });
      setFileName(picked.file.name);
      setAnswer(result);
      setTreeName(result.preview.mapName ? t('import.familyName', { name: result.preview.mapName }) : '');
      setGenders({});
      setSplit({});
      setLeftOut({});
      setCommitted(null);
      setStep('checks');
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  async function saveTree(answerNow: ImportAnswer, meTemp: string | null): Promise<Committed> {
    if (committed) return committed;
    const fixes: Record<string, unknown> = {};
    for (const [tempId, gender] of Object.entries(genders)) fixes[tempId] = { gender };
    fixes._split = splitIds;
    fixes._placeholders = (answerNow.preview.placeholders ?? []).map((p) => p.tempId).filter((id) => !leftOut[id]);
    const result = await api.rpc<Committed>('import_commit', {
      p_import: answerNow.import_id,
      p_tree_name: treeName.trim(),
      p_fixes: fixes,
      ...(meTemp ? { p_me_temp: meTemp } : {}),
    });
    setCommitted(result);
    return result;
  }

  async function openTree(treeId: string) {
    await client.invalidateQueries({ queryKey: ['trees'] });
    router.replace({ pathname: '/tree/[id]', params: { id: treeId } });
  }

  async function commit(meTemp: string | null) {
    if (!answer) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await saveTree(answer, meTemp);
      await openTree(result.tree_id);
    } catch (error) {
      setFailure(error);
      setBusy(false);
    }
  }

  async function addMe(input: AddMeInput) {
    if (!answer) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await saveTree(answer, null);
      await api.rpc('tree_add_me', {
        p_tree: result.tree_id,
        p_anchor: result.person_ids[input.anchorTemp],
        p_relation: input.relation,
        p_name: input.name,
        p_gender: input.gender,
      });
      await openTree(result.tree_id);
    } catch (error) {
      setFailure(error);
      setBusy(false);
    }
  }

  function afterChecks() {
    setFailure(null);
    setStep(needGender.length + guessedGender.length > 0 ? 'gender' : 'which');
  }

  if (step === 'pick' || !preview) {
    return (
      <Screen>
        <BackButton onPress={() => goBack(router)} />
        <View style={styles.pick}>
          <Heading>{t('import.title')}</Heading>
          <Muted>{t('import.explain')}</Muted>
          <Pressable accessibilityRole="button" disabled={busy} onPress={chooseFile}>
            <NeonPanel style={styles.pickPanel}>
              <DownloadIcon color={colors.logoYellow} size={28} />
              <Text style={styles.pickTitle}>{busy ? t('import.reading') : t('import.choose')}</Text>
              <Text style={styles.pickHelp}>{t('import.types')}</Text>
            </NeonPanel>
          </Pressable>
          {wrongFile ? <ErrorText>{t('import.wrongType', { name: wrongFile })}</ErrorText> : null}
          {failure ? <ErrorText>{errorText(failure)}</ErrorText> : null}
        </View>
      </Screen>
    );
  }

  if (step === 'checks') {
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TopBar title={fileName} subtitle={t('import.reviewSubtitle')} onBack={() => setStep('pick')} />
          <FoundPanel preview={preview} />
          <Field label={t('import.treeName')} value={treeName} onChangeText={setTreeName} />
          {answer ? (
            <QuickChecks
              preview={answer.preview}
              split={split}
              onSplit={(id, on) => setSplit((now) => ({ ...now, [id]: on }))}
              leftOut={leftOut}
              onLeaveOut={(id, on) => setLeftOut((now) => ({ ...now, [id]: on }))}
            />
          ) : null}
        </ScrollView>
        <PrimaryButton label={needGender.length > 0 ? t('import.nextGender') : t('import.nextFind')} onPress={afterChecks} disabled={!treeName.trim()} />
      </Screen>
    );
  }

  if (step === 'gender') {
    const left = needGender.filter((p) => genders[p.tempId] === undefined).length;
    return (
      <Screen>
        <TopBar title={t('import.genderTitle')} onBack={() => setStep('checks')} />
        <View style={styles.genderHelp}>
          <Muted>{t('import.genderExplain')}</Muted>
        </View>
        <FlatList
          data={[...needGender, ...guessedGender]}
          keyExtractor={(p) => p.tempId}
          contentContainerStyle={styles.list}
          initialNumToRender={12}
          ListHeaderComponent={needGender.length > 0 ? <SectionTitle>{t('import.genderUnknownCount', { count: needGender.length })}</SectionTitle> : undefined}
          renderItem={({ item, index }) => (
            <>
              {index === needGender.length && guessedGender.length > 0 ? (
                <View style={styles.guessedHead}>
                  <SectionTitle>{t('import.genderGuessedTitle')}</SectionTitle>
                  <Muted>{t('import.genderGuessedHelp')}</Muted>
                </View>
              ) : null}
              <GenderRow
                person={item}
                preview={preview}
                value={genders[item.tempId] ?? (item.gender === 'unknown' ? null : item.gender)}
                onChange={(gender) => setGenders((now) => ({ ...now, [item.tempId]: gender }))}
              />
            </>
          )}
        />
        <PrimaryButton
          label={left > 0 ? t('import.genderLeft', { count: left }) : t('import.nextFind')}
          onPress={() => setStep('which')}
        />
      </Screen>
    );
  }

  if (step === 'addMe') {
    return (
      <AddMe
        preview={preview}
        myName={me.data?.display_name ?? ''}
        busy={busy}
        failure={failure ? errorText(failure) : null}
        onBack={() => {
          // Once the tree is saved there is nothing to go back to: the person can only finish, or go and see it.
          if (committed) openTree(committed.tree_id);
          else setStep('which');
        }}
        onConfirm={addMe}
        onWithoutMe={() => commit(null)}
      />
    );
  }

  return (
    <WhichIsYou
      preview={preview}
      suggestion={firstName(me.data?.display_name)}
      busy={busy}
      failure={failure ? errorText(failure) : null}
      onBack={() => setStep(needGender.length + guessedGender.length > 0 ? 'gender' : 'checks')}
      onConfirm={commit}
      onNotHere={() => {
        setFailure(null);
        setStep('addMe');
      }}
    />
  );
}

function FoundPanel({ preview }: { preview: ImportPreview }) {
  const { t } = useTranslation();
  const generations =
    preview.counts?.generations ??
    generationCount(
      preview.persons.map((p) => ({ id: p.tempId })),
      preview.parentLinks.map((l) => ({ parent_id: l.parentId, child_id: l.childId })),
    );
  const stats = [
    { value: preview.counts?.people ?? preview.persons.length, label: t('home.statPeople') },
    { value: generations, label: t('home.statGenerations') },
    { value: preview.counts?.couples ?? preview.unions.length, label: t('import.couples') },
  ];
  return (
    <NeonPanel>
      <Text style={styles.foundTitle}>{t('import.safe')}</Text>
      <View style={styles.stats}>
        {stats.map((s) => (
          <View key={s.label}>
            <Text style={styles.statNumber}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
    </NeonPanel>
  );
}

/** Whose empty box this was, as drawn: 'Pat & Sam'. */
function placeholderNames(preview: ImportPreview, placeholder: ImportPlaceholder): string {
  const everyone = [...preview.persons, ...(preview.merges ?? []).map((m) => m.dropped)];
  const names = (placeholder.parentIds ?? []).map((id) => everyone.find((p) => p.tempId === id)?.displayName).filter((n): n is string => !!n);
  return names.length > 0 ? names.join(' & ') : placeholder.underPerson;
}

function QuickChecks({ preview, split, onSplit, leftOut, onLeaveOut }: {
  preview: ImportPreview;
  split: Record<string, boolean>;
  onSplit: (droppedId: string, on: boolean) => void;
  leftOut: Record<string, boolean>;
  onLeaveOut: (tempId: string, on: boolean) => void;
}) {
  const { t } = useTranslation();
  const merges = preview.merges ?? [];
  const placeholders = (preview.placeholders ?? []).filter((p) => p.underPerson);
  const problems = preview.problems ?? [];
  const count = merges.length + placeholders.length;
  if (count === 0 && problems.length === 0) return null;

  return (
    <>
      {count > 0 ? <SectionTitle>{t('import.checks', { count })}</SectionTitle> : null}
      {merges.map((merge) => {
        const { parents, partners } = relativesOf(preview, merge.keptId);
        return (
          <Card key={merge.keptId} style={styles.check}>
            <Text style={styles.checkText}>
              {parents[0] && partners[0]
                ? t('import.samePerson', { name: merge.name, parent: parents[0], partner: partners[0] })
                : t('import.samePersonPlain', { name: merge.name })}
            </Text>
            <View style={styles.checkButtons}>
              <SmallButton label={t('import.onePerson')} kind={split[merge.droppedId] ? 'plain' : 'dark'} onPress={() => onSplit(merge.droppedId, false)} />
              <SmallButton label={t('import.twoPeople')} kind={split[merge.droppedId] ? 'dark' : 'plain'} onPress={() => onSplit(merge.droppedId, true)} />
            </View>
            {split[merge.droppedId] ? <Text style={styles.checkNote}>{t('import.splitNote', { name: merge.name })}</Text> : null}
          </Card>
        );
      })}
      {placeholders.map((placeholder) => (
        <Card key={placeholder.tempId} style={styles.check}>
          <Text style={styles.checkText}>{t('import.emptyBox', { name: placeholderNames(preview, placeholder) })}</Text>
          <View style={styles.checkButtons}>
            <SmallButton label={t('import.addLater')} kind={leftOut[placeholder.tempId] ? 'plain' : 'dark'} onPress={() => onLeaveOut(placeholder.tempId, false)} />
            <SmallButton label={t('import.leaveOut')} kind={leftOut[placeholder.tempId] ? 'dark' : 'plain'} onPress={() => onLeaveOut(placeholder.tempId, true)} />
          </View>
          {leftOut[placeholder.tempId] ? null : <Text style={styles.checkNote}>{t('import.spaceNote')}</Text>}
        </Card>
      ))}
      {problems.length > 0 ? (
        <Card style={styles.check}>
          <Text style={styles.checkText}>{t('import.problems', { count: problems.length })}</Text>
        </Card>
      ) : null}
    </>
  );
}

function GenderRow({ person, preview, value, onChange }: {
  person: ImportedPerson;
  preview: ImportPreview;
  value: ImportGender | null;
  onChange: (gender: ImportGender) => void;
}) {
  const { t } = useTranslation();
  const { parents, partners } = relativesOf(preview, person.tempId);
  const hint = parents[0]
    ? t('import.childOf', { names: parents.join(', ') })
    : partners[0]
      ? t('import.partnerOf', { names: partners.join(', ') })
      : person.noteLabel;
  return (
    <Card style={styles.genderRow}>
      <Text style={styles.personName}>{person.nameUnknown ? t('tree.nameNotKnown') : person.displayName}</Text>
      {hint ? <Text style={styles.personHint}>{hint}</Text> : null}
      <Pills
        value={value}
        onChange={onChange}
        options={[
          { value: 'male', label: t('details.male') },
          { value: 'female', label: t('details.female') },
          { value: 'other', label: t('details.other') },
          { value: 'unknown', label: t('details.notKnown') },
        ]}
      />
    </Card>
  );
}

function WhichIsYou({ preview, suggestion, busy, failure, onBack, onConfirm, onNotHere }: {
  preview: ImportPreview;
  suggestion: string;
  busy: boolean;
  failure: string | null;
  onBack: () => void;
  onConfirm: (meTemp: string | null) => void;
  onNotHere: () => void;
}) {
  const { t } = useTranslation();
  const named = useMemo(() => preview.persons.filter((p) => !p.nameUnknown), [preview]);
  const [query, setQuery] = useState(() =>
    suggestion && named.some((p) => p.displayName.toLowerCase().includes(suggestion.toLowerCase())) ? suggestion : '',
  );
  const [chosen, setChosen] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const matches = (q ? named.filter((p) => p.displayName.toLowerCase().includes(q)) : named).slice(0, SHOWN_MATCHES);

  function hintFor(tempId: string): string | null {
    const { parents, partners } = relativesOf(preview, tempId);
    if (parents[0]) return t('import.childOf', { names: parents.join(', ') });
    if (partners[0]) return t('import.partnerOf', { names: partners.join(', ') });
    return null;
  }

  return (
    <Screen>
      <BackButton onPress={onBack} />
      <View style={styles.whichHead}>
        <Heading>{t('import.whichTitle')}</Heading>
        <Muted>{t('import.whichExplain')}</Muted>
        <View style={styles.searchBox}>
          <SearchIcon color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            accessibilityLabel={t('search.placeholder')}
            placeholder={t('search.placeholder')}
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            style={styles.searchInput}
          />
        </View>
      </View>
      <FlatList
        data={matches}
        keyExtractor={(p) => p.tempId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Muted>{t('search.nothing')}</Muted>}
        ListFooterComponent={
          <Pressable accessibilityRole="button" disabled={busy} onPress={onNotHere} style={styles.notHere}>
            <PlusIcon color={colors.logoPurple} />
            <Text style={styles.notHereText}>{t('import.notInTree')}</Text>
          </Pressable>
        }
        renderItem={({ item }) => {
          const on = item.tempId === chosen;
          const hint = hintFor(item.tempId);
          const body = (
            <View style={styles.personRow}>
              <Avatar personId={item.tempId} size={on ? 60 : 44} />
              <View style={styles.personText}>
                <Text style={[styles.personName, on && styles.personNameOn]}>{item.displayName}</Text>
                {hint ? <Text style={[styles.personHint, on && styles.personHintOn]}>{hint}</Text> : null}
              </View>
              {on ? <View style={styles.tick}><CheckIcon color={colors.logoIndigo} size={16} width={3} /></View> : null}
            </View>
          );
          return (
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setChosen(item.tempId)}>
              {on ? <NeonPanel style={styles.compactPanel}>{body}</NeonPanel> : <Card style={styles.compactCard}>{body}</Card>}
            </Pressable>
          );
        }}
      />
      {failure ? <ErrorText>{failure}</ErrorText> : null}
      <PrimaryButton label={busy ? t('import.saving') : t('claim.yes')} onPress={() => onConfirm(chosen)} disabled={!chosen || busy} />
    </Screen>
  );
}

/** 'I'm not in this tree yet': a card for this person, joined to a relative who is. */
function AddMe({ preview, myName, busy, failure, onBack, onConfirm, onWithoutMe }: {
  preview: ImportPreview;
  myName: string;
  busy: boolean;
  failure: string | null;
  onBack: () => void;
  onConfirm: (input: AddMeInput) => void;
  onWithoutMe: () => void;
}) {
  const { t } = useTranslation();
  const named = useMemo(() => preview.persons.filter((p) => !p.nameUnknown), [preview]);
  const [name, setName] = useState(myName);
  const [gender, setGender] = useState<ImportGender>('unknown');
  const [relation, setRelation] = useState<Relation | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const matches = (q ? named.filter((p) => p.displayName.toLowerCase().includes(q)) : named).slice(0, SHOWN_MATCHES);

  return (
    <Screen>
      <FlatList
        data={matches}
        keyExtractor={(p) => p.tempId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.addMeHead}>
            <TopBar title={t('import.addMeTitle')} onBack={onBack} />
            <Muted>{t('import.addMeExplain')}</Muted>
            <Field label={t('profile.yourName')} value={name} onChangeText={setName} autoComplete="name" />
            <Pills
              value={gender}
              onChange={setGender}
              options={[
                { value: 'male', label: t('details.male') },
                { value: 'female', label: t('details.female') },
                { value: 'other', label: t('details.other') },
                { value: 'unknown', label: t('details.notKnown') },
              ]}
            />
            <SectionTitle>{t('import.addMeRelation')}</SectionTitle>
            <Pills
              value={relation}
              onChange={setRelation}
              options={[
                { value: 'child', label: t('import.addMeChild') },
                { value: 'parent', label: t('import.addMeParent') },
                { value: 'spouse', label: t('import.addMePartner') },
                { value: 'sibling', label: t('import.addMeSibling') },
              ]}
            />
            <SectionTitle>{t('import.addMeWho')}</SectionTitle>
            <View style={styles.searchBox}>
              <SearchIcon color={colors.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                accessibilityLabel={t('search.placeholder')}
                placeholder={t('search.placeholder')}
                placeholderTextColor={colors.muted}
                autoCorrect={false}
                style={styles.searchInput}
              />
            </View>
          </View>
        }
        ListEmptyComponent={<Muted>{t('search.nothing')}</Muted>}
        renderItem={({ item }) => {
          const on = item.tempId === anchor;
          return (
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setAnchor(item.tempId)}>
              <Card style={[styles.compactCard, on && styles.anchorOn]}>
                <View style={styles.personRow}>
                  <Avatar personId={item.tempId} size={44} />
                  <View style={styles.personText}>
                    <Text style={styles.personName}>{item.displayName}</Text>
                  </View>
                  {on ? <CheckIcon color={colors.logoPurple} size={18} width={3} /> : null}
                </View>
              </Card>
            </Pressable>
          );
        }}
      />
      {failure ? <ErrorText>{failure}</ErrorText> : null}
      <PrimaryButton
        label={busy ? t('import.saving') : t('import.addMeButton')}
        onPress={() => {
          if (anchor && relation) onConfirm({ anchorTemp: anchor, relation, name: name.trim(), gender });
        }}
        disabled={!anchor || !relation || !name.trim() || busy}
      />
      <TextButton label={t('import.withoutMe')} onPress={onWithoutMe} disabled={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 12, paddingBottom: 16 },
  pick: { flex: 1, gap: 14, paddingTop: 16 },
  pickPanel: { gap: 8, alignItems: 'flex-start' },
  pickTitle: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 20 },
  pickHelp: { color: colors.onNeon, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  foundTitle: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 17, marginBottom: 10 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 28 },
  statNumber: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 30, lineHeight: 34 },
  statLabel: { color: colors.onNeon, fontFamily: fonts.semibold, fontSize: 13 },
  check: { gap: 10 },
  checkText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  checkButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  checkNote: { color: colors.ask, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  genderHelp: { marginTop: 10, marginBottom: 6 },
  list: { gap: 10, paddingBottom: 12 },
  guessedHead: { gap: 4, marginTop: 8, marginBottom: 10 },
  genderRow: { gap: 8, padding: 12 },
  personName: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  personNameOn: { color: colors.white, fontSize: 17 },
  personHint: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 17 },
  personHintOn: { color: colors.onNeon },
  whichHead: { gap: 10, marginTop: 10, marginBottom: 10 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 54,
    paddingHorizontal: 16,
    borderRadius: 27,
    borderWidth: 2,
    borderColor: colors.logoPurple,
    backgroundColor: colors.card,
  },
  searchInput: { flex: 1, minHeight: minTapSize, color: colors.text, fontFamily: fonts.bold, fontSize: 16 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  personText: { flex: 1, minWidth: 0 },
  compactPanel: { padding: 14 },
  compactCard: { padding: 10 },
  anchorOn: { borderWidth: 2, borderColor: colors.logoPurple },
  addMeHead: { gap: 12, marginBottom: 2 },
  tick: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  notHere: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 54,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.dashed,
    marginTop: 4,
  },
  notHereText: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
});
