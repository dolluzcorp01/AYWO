// E3 / S-10 Share: who it is for, what they can do, then send. Below that, who already has access.
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Modal, Pressable, ScrollView, Share as NativeShare, StyleSheet, View } from 'react-native';
import { relationText } from '@aywo/layout';
import { goBack } from '@/lib/nav';
import { useMe } from '@/lib/account';
import { Avatar } from '@/components/Avatar';
import { ContactIcon } from '@/components/ContactIcon';
import { ChevronIcon } from '@/components/Icons';
import { PhoneField } from '@/components/PhoneField';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, ConfirmDialog, ErrorText, Loading, LoadFailed, Muted, NeonPanel, SectionTitle, SmallButton, Switch, TextButton, TopBar } from '@/components/ui';
import { normalizeContact } from '@/lib/contacts';
import { useErrorText } from '@/lib/errors';
import { canShare } from '@/tree/roles';
import { useCreateShare, useRevokeShare, useShares } from '@/tree/useEdit';
import type { EditMode, ShareInput, ShareRole, ShareRow } from '@/tree/useEdit';
import { useTreeView } from '@/tree/useTreeView';
import { colors, fonts, gradients, minTapSize } from '@/theme/tokens';

const ROLES: { value: ShareRole; nameKey: string; helpKey: string }[] = [
  { value: 'viewer', nameKey: 'share.view', helpKey: 'share.viewHelp' },
  { value: 'commenter', nameKey: 'share.comment', helpKey: 'share.commentHelp' },
  { value: 'editor', nameKey: 'share.edit', helpKey: 'share.editHelp' },
  { value: 'co_creator', nameKey: 'share.coCreate', helpKey: 'share.coCreateHelp' },
];

const ENDS: { days: number | null; labelKey: string }[] = [
  { days: null, labelKey: 'share.never' },
  { days: 7, labelKey: 'share.week' },
  { days: 30, labelKey: 'share.month' },
  { days: 365, labelKey: 'share.year' },
];

export default function ShareScreen() {
  const { treeId, personId } = useLocalSearchParams<{ treeId: string; personId?: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const tree = useTreeView(treeId, 'mine', i18n.language, null);
  const me = useMe();
  const create = useCreateShare(treeId);
  const canManage = canShare(tree.data?.role);
  const existing = useShares(treeId, canManage);
  const revoke = useRevokeShare(treeId);

  const [role, setRole] = useState<ShareRole>('viewer');
  const [editMode, setEditMode] = useState<EditMode>('approval');
  const [contactsVisible, setContactsVisible] = useState(false);
  const [branch, setBranch] = useState(false);
  const [endIndex, setEndIndex] = useState(0);
  const [choosing, setChoosing] = useState<'part' | 'ends' | null>(null);
  const [copied, setCopied] = useState(false);
  const [phone, setPhone] = useState('');
  const [badPhone, setBadPhone] = useState(false);
  const [revoking, setRevoking] = useState<ShareRow | null>(null);
  // One set of choices makes one link, however many times it is sent.
  const [made, setMade] = useState<{ key: string; url: string } | null>(null);

  if (tree.isError) {
    return (
      <Screen>
        <TopBar title={t('share.action')} onBack={() => goBack(router)} close />
        <LoadFailed message={errorText(tree.error)} onRetry={() => tree.refetch()} />
      </Screen>
    );
  }
  if (!tree.data) {
    return (
      <Screen>
        <Loading label={t('tree.loading')} />
      </Screen>
    );
  }

  const data = tree.data;
  const person = personId ? data.nodes.find((n) => n.id === personId) : undefined;
  const personName = person ? (person.nameUnknown ? t('tree.nameNotKnown') : person.name) : '';

  // A link alone only ever opens the names-and-photos view. Rights reach a person through their number,
  // or through the card they claim.
  const needsPhone = !person?.joined;

  function buildInput(): ShareInput | null {
    const days = ENDS[endIndex].days;
    const typed = needsPhone ? phone.trim() : '';
    const normalized = typed ? normalizeContact('mobile', typed) : null;
    if (typed && !normalized) {
      setBadPhone(true);
      return null;
    }
    setBadPhone(false);
    return {
      ...(normalized ? { grantee_phone: normalized } : {}),
      role,
      // Only editors have a mode. The column still needs a value, and 'direct' is its default.
      edit_mode: role === 'editor' ? editMode : 'direct',
      contacts_visible: contactsVisible,
      ...(person ? { grantee_person_id: person.id } : {}),
      ...(branch && person ? { scope_person_id: person.id } : {}),
      ...(days ? { expires_at: new Date(Date.now() + days * 86_400_000).toISOString() } : {}),
    };
  }

  async function linkUrl(): Promise<string> {
    const input = buildInput();
    if (!input) throw new Error('bad_phone');
    // The end date moves with the clock, so it is not part of what makes two links the same.
    const key = JSON.stringify({ ...input, expires_at: undefined, endIndex });
    if (made?.key === key) return made.url;
    const share = await create.mutateAsync(input);
    setMade({ key, url: share.link_url });
    return share.link_url;
  }

  // Personal when we can: "Pavithran added you to ... as their sister". A word the tree is still unsure of
  // ("Anna or Thambi?") is left out rather than guessed.
  const sharer = me.data?.display_name?.trim() || null;
  const said = person ? relationText(data.labels[person.id]) : null;
  // "as their sister": the tree shows "Sister" as a title; mid-sentence English wants lower case.
  const word = said?.kind === 'word' ? (i18n.language.startsWith('en') ? said.word.toLocaleLowerCase(i18n.language) : said.word) : null;
  const message = (url: string) =>
    sharer && word
      ? t('share.messageFor', { sharer, tree: data.tree.name, relation: word, url })
      : sharer
        ? t('share.messageFrom', { sharer, tree: data.tree.name, url })
        : t('share.message', { tree: data.tree.name, url });

  async function sendWhatsApp() {
    try {
      const url = await linkUrl();
      await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message(url))}`);
    } catch {
      // A failed create shows through create.error, a bad number under its box. WhatsApp missing falls back to the phone's own share sheet.
      if (made || create.isSuccess) await shareOther();
    }
  }

  async function shareOther() {
    try {
      const url = await linkUrl();
      await NativeShare.share({ message: message(url) });
    } catch {
      // Closing the sheet, or a browser with no share sheet. The Copy link button is right there.
    }
  }

  async function copyLink() {
    try {
      const url = await linkUrl();
      await Clipboard.setStringAsync(url);
      setCopied(true);
    } catch {
      // create.error shows the reason.
    }
  }

  const liveShares = (existing.data ?? []).filter((s) => !s.expired);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TopBar title={t('share.title', { tree: data.tree.name })} onBack={() => goBack(router)} close />

        {person ? (
          <NeonPanel style={styles.who}>
            <Avatar personId={person.id} size={44} photoUrl={person.photoUrl} nameUnknown={person.nameUnknown} />
            <View style={styles.whoText}>
              <Text style={styles.whoName}>{personName}</Text>
              <Text style={styles.whoHelp}>{t('share.inTree')}</Text>
            </View>
          </NeonPanel>
        ) : null}

        <SectionTitle>{t('share.theyCan')}</SectionTitle>
        <View accessibilityRole="radiogroup" style={styles.roles}>
          {ROLES.map((r) => {
            const on = r.value === role;
            const text = (
              <>
                <Text style={[styles.roleName, on && styles.roleOnText]}>{t(r.nameKey)}</Text>
                <Text style={[styles.roleHelp, on && styles.roleOnHelp]}>{t(r.helpKey)}</Text>
              </>
            );
            return (
              <Pressable
                key={r.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => setRole(r.value)}
                style={styles.roleWrap}
              >
                {on ? (
                  <LinearGradient colors={gradients.button} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.role}>
                    {text}
                  </LinearGradient>
                ) : (
                  <View style={[styles.role, styles.roleOff]}>{text}</View>
                )}
              </Pressable>
            );
          })}
        </View>

        {role === 'editor' ? (
          <View accessibilityRole="radiogroup" style={styles.modes}>
            {(['direct', 'approval'] as EditMode[]).map((mode) => {
              const on = mode === editMode;
              const label = <Text style={[styles.modeText, on && styles.modeTextOn]}>{t(mode === 'direct' ? 'share.goLive' : 'share.approveFirst')}</Text>;
              return (
                <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setEditMode(mode)} style={styles.modeWrap}>
                  {on ? (
                    <LinearGradient colors={gradients.neon} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.mode}>
                      {label}
                    </LinearGradient>
                  ) : (
                    <View style={styles.mode}>{label}</View>
                  )}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <Switch label={t('share.contacts')} help={t('share.contactsHelp')} on={contactsVisible} onChange={setContactsVisible} />

        {needsPhone ? (
          <Card style={styles.phoneCard}>
            <PhoneField
              label={t('share.phone')}
              value={phone}
              onChangeText={(v) => {
                setPhone(v);
                setBadPhone(false);
              }}
              placeholder={t('details.mobilePlaceholder')}
              invalid={badPhone}
              onPickContact={() => setBadPhone(false)}
            />
            <Muted>{t('share.phoneHelp')}</Muted>
            {badPhone ? <ErrorText>{t('details.badPhone')}</ErrorText> : null}
          </Card>
        ) : null}

        {person ? (
          <Pressable accessibilityRole="button" onPress={() => setChoosing('part')} style={styles.row}>
            <Text style={styles.rowTitle}>{t('share.part')}</Text>
            <Text style={styles.rowValue}>{branch ? t('share.branchOf', { name: personName }) : t('share.whole')}</Text>
            <ChevronIcon color={colors.muted} size={16} />
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => setChoosing('ends')} style={styles.row}>
          <Text style={styles.rowTitle}>{t('share.ends')}</Text>
          <Text style={styles.rowValue}>{t(ENDS[endIndex].labelKey)}</Text>
          <ChevronIcon color={colors.muted} size={16} />
        </Pressable>

        {create.isError ? <ErrorText>{errorText(create.error)}</ErrorText> : null}

        <Pressable accessibilityRole="button" disabled={create.isPending} onPress={sendWhatsApp} style={{ opacity: create.isPending ? 0.5 : 1 }}>
          <LinearGradient colors={gradients.whatsapp} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.whatsapp}>
            <ContactIcon kind="whatsapp" color={colors.white} size={20} />
            <Text style={styles.whatsappText}>{t('share.whatsapp')}</Text>
          </LinearGradient>
        </Pressable>
        <View style={styles.sendRow}>
          <TextButton label={copied ? t('share.copied') : t('share.copy')} onPress={copyLink} disabled={create.isPending} />
          <TextButton label={t('share.moreWays')} onPress={shareOther} disabled={create.isPending} />
        </View>

        {canManage && liveShares.length > 0 ? (
          <>
            <SectionTitle>{t('share.haveAccess')}</SectionTitle>
            {liveShares.map((s) => (
              <View key={s.id} style={styles.accessRow}>
                <View style={styles.whoText}>
                  <Text style={styles.rowTitle}>{s.grantee_name || s.grantee_person_name || s.waiting_phone || t('share.anyoneWithLink')}</Text>
                  <Text style={styles.rowValueLeft}>{t(ROLES.find((r) => r.value === s.role)?.nameKey ?? 'share.view')}</Text>
                </View>
                <SmallButton label={t('share.revoke')} kind="plain" onPress={() => setRevoking(s)} />
              </View>
            ))}
          </>
        ) : null}
        {revoke.isError ? <ErrorText>{errorText(revoke.error)}</ErrorText> : null}
      </ScrollView>

      <Modal visible={choosing !== null} transparent animationType="slide" onRequestClose={() => setChoosing(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            {choosing === 'part' ? (
              <>
                <Choice label={t('share.whole')} on={!branch} onPress={() => { setBranch(false); setChoosing(null); }} />
                <Choice label={t('share.branchOf', { name: personName })} on={branch} onPress={() => { setBranch(true); setChoosing(null); }} />
              </>
            ) : (
              ENDS.map((end, i) => (
                <Choice key={end.labelKey} label={t(end.labelKey)} on={i === endIndex} onPress={() => { setEndIndex(i); setChoosing(null); }} />
              ))
            )}
            <TextButton label={t('tree.close')} onPress={() => setChoosing(null)} />
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={revoking !== null}
        title={t('share.revokeTitle')}
        message={t('share.revokeHelp')}
        confirmLabel={t('share.revoke')}
        danger
        busy={revoke.isPending}
        onCancel={() => setRevoking(null)}
        onConfirm={() => {
          if (revoking) revoke.mutate(revoking.id, { onSettled: () => setRevoking(null) });
        }}
      />
    </Screen>
  );
}

function Choice({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={onPress} style={styles.choice}>
      <Text style={[styles.choiceText, on && styles.choiceOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 10, paddingBottom: 12 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  phoneCard: { gap: 6, padding: 12 },
  whoText: { flex: 1, minWidth: 0 },
  whoName: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 15 },
  whoHelp: { color: colors.onNeon, fontFamily: fonts.semibold, fontSize: 12 },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  roleWrap: { width: '48%', flexGrow: 1 },
  role: { minHeight: 58, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center' },
  roleOff: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  roleName: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 14 },
  roleHelp: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  roleOnText: { color: colors.white },
  roleOnHelp: { color: colors.onNeon },
  modes: { flexDirection: 'row', gap: 4, backgroundColor: colors.tint, borderRadius: 16, padding: 4 },
  modeWrap: { flex: 1 },
  mode: { minHeight: minTapSize - 4, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  modeText: { color: colors.muted, fontFamily: fonts.bold, fontSize: 13 },
  modeTextOn: { color: colors.white, fontFamily: fonts.extrabold },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: minTapSize,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  rowTitle: { flex: 1, color: colors.text, fontFamily: fonts.extrabold, fontSize: 14 },
  rowValue: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13, flexShrink: 1 },
  rowValueLeft: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13 },
  whatsapp: { minHeight: 56, borderRadius: 28, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  whatsappText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 16 },
  sendRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  accessRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: minTapSize },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 4 },
  choice: { minHeight: minTapSize + 4, justifyContent: 'center' },
  choiceText: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  choiceOn: { color: colors.relation, fontFamily: fonts.extrabold },
});
