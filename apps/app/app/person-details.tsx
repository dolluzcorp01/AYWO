// E2 / S-08: a new person (from E1) or changing an existing one. Name is the only required thing.
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Avatar } from '@/components/Avatar';
import { PlusIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { PhoneField } from '@/components/PhoneField';
import { Card, Checkbox, ConfirmDialog, ErrorText, Field, Label, Loading, LoadFailed, Pills, PrimaryButton, SmallButton, TextButton, TopBar } from '@/components/ui';
import { uploadFile } from '@/lib/api';
import type { PickedFile } from '@/lib/api';
import { dateToText, normalizeContact, parseDateText } from '@/lib/contacts';
import { errorCode, useErrorText } from '@/lib/errors';
import { pickPhoto } from '@/lib/pick';
import { deleteContact, deletePerson, savePerson, setContact, useAddRelative, useContactsForEdit } from '@/tree/useEdit';
import type { ContactKind, LinkKind, PersonFields, Relation } from '@/tree/useEdit';
import { useTreeView } from '@/tree/useTreeView';
import type { TreeNode } from '@/tree/useTreeView';
import { colors, fonts, minTapSize } from '@/theme/tokens';

interface Form {
  name: string;
  nameUnknown: boolean;
  gender: string;
  living: string;
  born: string;
  died: string;
  birthOrder: number | null;
  birthPlace: string;
  deathPlace: string;
  notes: string;
}

const EMPTY: Form = {
  name: '',
  nameUnknown: false,
  gender: 'unknown',
  living: 'living',
  born: '',
  died: '',
  birthOrder: null,
  birthPlace: '',
  deathPlace: '',
  notes: '',
};

function formFrom(node: TreeNode): Form {
  return {
    name: node.nameUnknown ? '' : node.name,
    nameUnknown: node.nameUnknown,
    gender: node.gender,
    living: node.living,
    born: dateToText(node.birthDate, node.birthPrecision),
    died: dateToText(node.deathDate, node.deathPrecision),
    birthOrder: node.birthOrder,
    birthPlace: node.birthPlace ?? '',
    deathPlace: node.deathPlace ?? '',
    notes: node.notes ?? '',
  };
}

type Contacts = Record<ContactKind, string>;
type BadField = 'name' | 'born' | 'died' | ContactKind;
const NO_CONTACTS: Contacts = { mobile: '', whatsapp: '', email: '' };

export default function PersonDetails() {
  const params = useLocalSearchParams<{
    treeId: string;
    personId?: string;
    anchor?: string;
    relation?: Relation;
    union?: string;
    linkKind?: LinkKind;
  }>();
  const { treeId, personId } = params;
  const editing = !!personId;
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const errorText = useErrorText();

  const tree = useTreeView(treeId, 'mine', i18n.language, null);
  const stored = useContactsForEdit(personId);
  const add = useAddRelative(treeId);
  const node = personId ? tree.data?.nodes.find((n) => n.id === personId) : undefined;
  const anchorNode = params.anchor ? tree.data?.nodes.find((n) => n.id === params.anchor) : undefined;

  const [form, setForm] = useState<Form>(EMPTY);
  const [contacts, setContacts] = useState<Contacts>(NO_CONTACTS);
  const [photo, setPhoto] = useState<PickedFile | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // The box the last problem was about, outlined in red until it is changed.
  const [badField, setBadField] = useState<BadField | null>(null);
  // WhatsApp on the same number as the mobile: one tick instead of typing it twice.
  const [sameWhatsapp, setSameWhatsapp] = useState(false);
  const [clash, setClash] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);

  // Fill the form once, and again only when the person asks for the latest after a clash.
  useEffect(() => {
    if (node && loadedVersion === null) {
      setForm(formFrom(node));
      setLoadedVersion(node.version);
    }
  }, [node, loadedVersion]);

  useEffect(() => {
    if (!stored.data) return;
    const next = { ...NO_CONTACTS };
    for (const c of stored.data) if (!next[c.kind] && c.value) next[c.kind] = c.value;
    const same = !!next.mobile && !!next.whatsapp && normalizeContact('mobile', next.mobile) === normalizeContact('whatsapp', next.whatsapp);
    setContacts(next);
    setSameWhatsapp(same);
    if ((next.whatsapp && !same) || next.email) setMore(true);
  }, [stored.data]);

  function changeContact(kind: ContactKind, value: string) {
    setContacts((now) => ({ ...now, [kind]: value, ...(kind === 'mobile' && sameWhatsapp ? { whatsapp: value } : {}) }));
    if (badField === kind || (kind === 'mobile' && sameWhatsapp && badField === 'whatsapp')) setBadField(null);
    setFailure(null);
  }

  function setWhatsappSame(on: boolean) {
    setSameWhatsapp(on);
    setContacts((now) => ({ ...now, whatsapp: on ? now.mobile : '' }));
    if (badField === 'whatsapp') setBadField(null);
  }

  /** Past the add screen as well. A reloaded web page has neither behind it. */
  function backToTree() {
    if (router.canDismiss()) router.dismiss(2);
    else router.replace({ pathname: '/tree/[id]', params: { id: treeId } });
  }

  function change<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((now) => ({ ...now, [key]: value }));
    setFailure(null);
    if ((key === 'name' || key === 'nameUnknown') && badField === 'name') setBadField(null);
    if ((key === 'born' || key === 'died') && badField === key) setBadField(null);
  }

  async function choosePhoto() {
    try {
      const picked = await pickPhoto();
      if (picked) setPhoto(picked);
    } catch (error) {
      setFailure(errorText(error));
    }
  }

  async function loadLatest() {
    setClash(false);
    setFailure(null);
    await tree.refetch();
    setLoadedVersion(null);
  }

  /** Everything the form holds, as columns. Failing a check returns a message instead. */
  function fieldsFromForm(): { fields: PersonFields } | { problem: string; field: BadField } {
    const name = form.name.trim();
    if (!form.nameUnknown && !name) return { problem: t('details.nameNeeded'), field: 'name' };
    let birth: { date: string; precision: string } | null = null;
    if (form.born.trim()) {
      birth = parseDateText(form.born);
      if (!birth) return { problem: t('details.badDate'), field: 'born' };
    }
    let death: { date: string; precision: string } | null = null;
    if (form.died.trim()) {
      death = parseDateText(form.died);
      if (!death) return { problem: t('details.badDate'), field: 'died' };
    }
    return {
      fields: {
        // Stored as the plain marker the importer and add_relative also use; the screen shows 'Name not known'.
        display_name: form.nameUnknown ? 'Name unknown' : name,
        name_unknown: form.nameUnknown,
        gender: form.gender,
        living: form.living,
        birth_date: birth?.date ?? null,
        birth_precision: birth?.precision ?? null,
        death_date: form.living === 'deceased' ? (death?.date ?? null) : null,
        death_precision: form.living === 'deceased' ? (death?.precision ?? null) : null,
        birth_place: form.birthPlace.trim() || null,
        death_place: form.living === 'deceased' ? form.deathPlace.trim() || null : null,
        birth_order: form.birthOrder,
        notes: form.notes.trim() || null,
      },
    };
  }

  /** Makes the stored contacts match the boxes. A contact is replaced by removing the old one and adding the new. */
  async function saveContacts(id: string, plan: { kind: ContactKind; value: string; normalized: string | null }[]) {
    for (const { kind, value, normalized } of plan) {
      const old = stored.data?.find((c) => c.kind === kind);
      if ((old?.value ?? '') === value.trim()) continue;
      if (old) await deleteContact(old.id);
      if (normalized) await setContact(id, kind, value.trim(), normalized);
    }
  }

  async function save() {
    const built = fieldsFromForm();
    if ('problem' in built) {
      setFailure(built.problem);
      setBadField(built.field);
      return;
    }
    const plan: { kind: ContactKind; value: string; normalized: string | null }[] = [];
    for (const kind of ['mobile', 'whatsapp', 'email'] as ContactKind[]) {
      const value = contacts[kind];
      const normalized = value.trim() ? normalizeContact(kind, value) : null;
      const unchanged = (stored.data?.find((c) => c.kind === kind)?.value ?? '') === value.trim();
      if (value.trim() && !normalized && !unchanged) {
        setFailure(t(kind === 'email' ? 'details.badEmail' : 'details.badPhone'));
        setBadField(kind);
        // The box may be folded away under "More": open it so the red box can be seen.
        if (kind !== 'mobile') setMore(true);
        return;
      }
      plan.push({ kind, value, normalized });
    }

    setBusy(true);
    setFailure(null);
    setBadField(null);
    setClash(false);
    try {
      const photoPath = photo ? await uploadFile('photos', photo) : null;

      if (editing && personId) {
        const version = loadedVersion ?? node?.version ?? 1;
        const answer = await savePerson(personId, version, { ...built.fields, ...(photoPath ? { photo_path: photoPath } : {}) });
        if (answer.status === 'requested') {
          setNotice(t('details.sentForApproval'));
          setBusy(false);
          return;
        }
        // Numbers never travel in a request, so they are saved only by those who may write directly.
        await saveContacts(personId, plan);
        await client.invalidateQueries({ queryKey: ['tree-view', treeId] });
        await client.invalidateQueries({ queryKey: ['person-card', personId] });
        goBack(router);
        return;
      }

      if (!params.anchor || !params.relation) {
        setBusy(false);
        return;
      }
      const answer = await add.mutateAsync({
        p_anchor: params.anchor,
        p_relation: params.relation,
        p_person: built.fields,
        ...(params.union ? { p_union: params.union } : {}),
        ...(params.relation !== 'spouse' && params.linkKind ? { p_link_kind: params.linkKind } : {}),
      });
      if (answer.status === 'requested') {
        setNotice(t('details.addRequested'));
        setBusy(false);
        return;
      }
      // The person exists from here on. A failed photo or contact must not look like the whole add failed.
      try {
        if (photoPath) await savePerson(answer.person_id, 1, { photo_path: photoPath });
        await saveContacts(answer.person_id, plan);
      } catch {
        await client.invalidateQueries({ queryKey: ['tree-view', treeId] });
        setNotice(t('details.partlySaved'));
        setBusy(false);
        return;
      }
      await client.invalidateQueries({ queryKey: ['tree-view', treeId] });
      backToTree();
    } catch (error) {
      if (errorCode(error) === 'version_conflict') setClash(true);
      else setFailure(errorText(error));
      setBusy(false);
    }
  }

  async function remove() {
    if (!personId) return;
    setBusy(true);
    try {
      const answer = await deletePerson(personId, loadedVersion ?? node?.version ?? 1);
      if (answer.status === 'requested') {
        setRemoving(false);
        setBusy(false);
        setNotice(t('details.sentForApproval'));
        return;
      }
      await client.invalidateQueries({ queryKey: ['tree-view', treeId] });
      await client.invalidateQueries({ queryKey: ['trees'] });
      router.replace({ pathname: '/tree/[id]', params: { id: treeId } });
    } catch (error) {
      setRemoving(false);
      if (errorCode(error) === 'version_conflict') setClash(true);
      else setFailure(errorText(error));
      setBusy(false);
    }
  }

  if (tree.isError) {
    return (
      <Screen>
        <LoadFailed message={errorText(tree.error)} onRetry={() => tree.refetch()} />
      </Screen>
    );
  }
  if (tree.data && editing && !node) {
    return (
      <Screen>
        <TopBar title={t('details.editing')} onBack={() => goBack(router)} />
        <LoadFailed message={t('errors.person_not_found')} />
      </Screen>
    );
  }
  if (!tree.data || (editing && !node)) {
    return (
      <Screen>
        <Loading label={t('tree.loading')} />
      </Screen>
    );
  }

  // Only those who may write directly get these rows back. Anyone else's edit goes as a request, which never carries numbers.
  const contactsOpen = !editing || !stored.isError;
  const hidden = (kind: ContactKind) => stored.data?.some((c) => c.kind === kind && c.value === null);

  const anchorName = anchorNode ? (anchorNode.nameUnknown ? t('tree.nameNotKnown') : anchorNode.name) : '';
  const hasParents = editing ? tree.data.links.some((l) => l.child_id === personId) : params.relation === 'child' || params.relation === 'sibling';
  const title = editing ? (node?.nameUnknown ? t('tree.nameNotKnown') : (node?.name ?? '')) : t('details.newPerson');
  const subtitle = editing ? t('details.editing') : params.relation ? t(`details.relationOf.${params.relation}`, { name: anchorName }) : undefined;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TopBar title={title} subtitle={subtitle} onBack={() => goBack(router)} />

        <View style={styles.nameRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('profile.addPhoto')} onPress={choosePhoto}>
            {photo ? (
              <Image source={{ uri: photo.uri }} style={styles.photo} accessibilityIgnoresInvertColors />
            ) : (
              <Avatar personId={personId ?? 'new'} size={76} photoUrl={node?.photoUrl} />
            )}
            <View style={styles.photoPlus}>
              <PlusIcon color={colors.white} size={14} width={3} />
            </View>
          </Pressable>
          <View style={styles.nameField}>
            <Field
              label={t('details.name')}
              value={form.name}
              onChangeText={(v) => change('name', v)}
              placeholder={t('details.namePlaceholder')}
              editable={!form.nameUnknown}
              invalid={badField === 'name'}
              style={styles.nameInput}
            />
          </View>
        </View>
        <Checkbox label={t('details.nameUnknown')} on={form.nameUnknown} onChange={(on) => change('nameUnknown', on)} />

        <Label>{t('details.gender')}</Label>
        <Pills
          value={form.gender}
          onChange={(v) => change('gender', v)}
          options={[
            { value: 'male', label: t('details.male') },
            { value: 'female', label: t('details.female') },
            { value: 'other', label: t('details.other') },
            { value: 'unknown', label: t('details.notKnown') },
          ]}
        />

        <Label>{t('details.livingLabel')}</Label>
        <Pills
          value={form.living}
          onChange={(v) => change('living', v)}
          options={[
            { value: 'living', label: t('details.living') },
            { value: 'deceased', label: t('details.passedAway') },
            { value: 'unknown', label: t('details.notKnown') },
          ]}
        />

        <View style={styles.pair}>
          <View style={styles.half}>
            <Field
              label={t('details.born')}
              value={form.born}
              onChangeText={(v) => change('born', v)}
              placeholder={t('details.bornPlaceholder')}
              keyboardType="numbers-and-punctuation"
              invalid={badField === 'born'}
            />
          </View>
          {hasParents ? (
            <View style={styles.half}>
              <Label>{t('details.childNumber')}</Label>
              <Card style={styles.stepper}>
                <StepButton label="-" accessibility={t('details.earlier')} onPress={() => change('birthOrder', form.birthOrder && form.birthOrder > 1 ? form.birthOrder - 1 : null)} />
                <Text style={styles.stepValue}>{form.birthOrder ?? t('details.notSet')}</Text>
                <StepButton label="+" accessibility={t('details.later')} onPress={() => change('birthOrder', (form.birthOrder ?? 0) + 1)} />
              </Card>
            </View>
          ) : null}
        </View>

        {contactsOpen ? (
          <>
            <PhoneField
              label={t('details.mobile')}
              value={contacts.mobile}
              onChangeText={(v) => changeContact('mobile', v)}
              placeholder={hidden('mobile') ? t('details.contactHidden') : t('details.mobilePlaceholder')}
              invalid={badField === 'mobile'}
            />
            {contacts.mobile.trim() ? (
              <Checkbox label={t('details.sameAsMobile')} on={sameWhatsapp} onChange={setWhatsappSame} />
            ) : null}
          </>
        ) : null}

        {more ? (
          <>
            {contactsOpen ? (
              <>
                {sameWhatsapp ? null : (
                  <PhoneField
                    label={t('card.whatsapp')}
                    value={contacts.whatsapp}
                    onChangeText={(v) => changeContact('whatsapp', v)}
                    placeholder={hidden('whatsapp') ? t('details.contactHidden') : t('details.mobilePlaceholder')}
                    invalid={badField === 'whatsapp'}
                  />
                )}
                <Field
                  label={t('card.email')}
                  value={contacts.email}
                  invalid={badField === 'email'}
                  onChangeText={(v) => changeContact('email', v)}
                  placeholder={hidden('email') ? t('details.contactHidden') : undefined}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </>
            ) : null}
            <Field label={t('details.birthPlace')} value={form.birthPlace} onChangeText={(v) => change('birthPlace', v)} />
            {form.living === 'deceased' ? (
              <>
                <Field label={t('details.died')} value={form.died} onChangeText={(v) => change('died', v)} placeholder={t('details.bornPlaceholder')} keyboardType="numbers-and-punctuation" invalid={badField === 'died'} />
                <Field label={t('details.deathPlace')} value={form.deathPlace} onChangeText={(v) => change('deathPlace', v)} />
              </>
            ) : null}
            <Field label={t('details.notes')} value={form.notes} onChangeText={(v) => change('notes', v)} multiline style={styles.notes} />
          </>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setMore(true)} style={styles.moreLink}>
            <Text style={styles.moreText}>{t('details.more')}</Text>
          </Pressable>
        )}

        {clash ? (
          <Card style={styles.clash}>
            <ErrorText>{t('errors.version_conflict')}</ErrorText>
            <SmallButton label={t('details.loadLatest')} onPress={loadLatest} />
          </Card>
        ) : null}
        {failure ? <ErrorText>{failure}</ErrorText> : null}
        {notice ? (
          <Card style={styles.clash}>
            <Text style={styles.noticeText}>{notice}</Text>
            <SmallButton label={t('common.done')} onPress={() => (editing ? goBack(router) : backToTree())} />
          </Card>
        ) : null}

        {editing ? <TextButton label={t('details.remove')} onPress={() => setRemoving(true)} danger /> : null}
      </ScrollView>

      <PrimaryButton label={editing ? t('common.save') : t('details.addToTree')} onPress={save} disabled={busy || !!notice} />

      <ConfirmDialog
        visible={removing}
        title={t('details.removeTitle', { name: title })}
        message={t('details.removeHelp')}
        confirmLabel={t('details.removeConfirm')}
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setRemoving(false)}
      />
    </Screen>
  );
}

function StepButton({ label, accessibility, onPress }: { label: string; accessibility: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibility} onPress={onPress} style={styles.stepButton}>
      <Text style={styles.stepButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 10, paddingBottom: 12 },
  nameRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-end' },
  nameField: { flex: 1, minWidth: 0 },
  nameInput: { borderWidth: 2, borderColor: colors.logoPurple },
  photo: { width: 76, height: 76, borderRadius: 38 },
  photoPlus: {
    position: 'absolute',
    end: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.logoIndigo,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pair: { flexDirection: 'row', gap: 10 },
  half: { flex: 1, gap: 6, minWidth: 0 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 4, minHeight: 52 },
  stepValue: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 14, textAlign: 'center', flexShrink: 1 },
  stepButton: { width: minTapSize, height: minTapSize, borderRadius: minTapSize / 2, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  stepButtonText: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18 },
  moreLink: { minHeight: minTapSize, justifyContent: 'center' },
  moreText: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 14, textDecorationLine: 'underline' },
  notes: { minHeight: 90, paddingTop: 12, textAlignVertical: 'top' },
  clash: { gap: 10, alignItems: 'flex-start' },
  noticeText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
});
