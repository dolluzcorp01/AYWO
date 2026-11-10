// Report something, and block the person who posted it. Required by Apple (guideline 1.2) and Google Play for apps
// where people share content. Reports reach AYWO staff, who act within 24 hours; the person reported is not told who.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Checkbox, ConfirmDialog, Field, Pills } from '@/components/ui';
import { api } from '@/lib/api';
import { ActionError } from '@/social/parts';
import { colors, fonts } from '@/theme/tokens';

export type ReportTarget = 'post' | 'post_comment' | 'message' | 'person_comment' | 'profile';
const REASONS = ['harassment', 'hate', 'nudity', 'violence', 'self_harm', 'spam', 'fake', 'other'] as const;
type Reason = (typeof REASONS)[number];

export function ReportDialog({
  visible,
  type,
  id,
  ownerId,
  ownerName,
  onClose,
}: {
  visible: boolean;
  type: ReportTarget;
  id: string;
  /** The person who posted it, so they can be blocked in the same step. */
  ownerId?: string | null;
  ownerName?: string | null;
  onClose: (result: 'reported' | 'cancelled') => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [reason, setReason] = useState<Reason | null>(type === 'profile' ? 'harassment' : null);
  const [note, setNote] = useState('');
  const [block, setBlock] = useState(type === 'profile');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  async function send() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.rpc('report_content', { p_type: type, p_id: id, p_reason: reason, p_note: note.trim() || null });
      if (block && ownerId) {
        await api.rpc('block_user', { p_profile: ownerId });
        await client.invalidateQueries();
      }
      setDone(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <ConfirmDialog
        visible={visible}
        title={t('ops.report.thanksTitle')}
        message={block && ownerId ? t('ops.report.thanksBlocked', { name: ownerName ?? '' }) : t('ops.report.thanks')}
        confirmLabel={t('ops.report.ok')}
        onConfirm={() => {
          setDone(false);
          onClose('reported');
        }}
        onCancel={() => {
          setDone(false);
          onClose('reported');
        }}
      />
    );
  }

  return (
    <ConfirmDialog
      visible={visible}
      title={t(`ops.report.title.${type}`)}
      message={t('ops.report.why')}
      confirmLabel={t('ops.report.send')}
      busy={busy}
      danger
      onConfirm={() => void send()}
      onCancel={() => onClose('cancelled')}
    >
      <View style={styles.body}>
        <Pills options={REASONS.map((r) => ({ value: r, label: t(`ops.report.reasons.${r}`) }))} value={reason} onChange={setReason} />
        {reason === 'self_harm' ? <Text style={styles.urgent}>{t('ops.report.selfHarm')}</Text> : null}
        <Field label={t('ops.report.note')} value={note} onChangeText={setNote} maxLength={1000} multiline />
        {ownerId && type !== 'profile' ? (
          <Checkbox label={t('ops.report.alsoBlock', { name: ownerName ?? '' })} help={t('ops.report.blockHelp')} on={block} onChange={setBlock} />
        ) : null}
        {!reason ? <Text style={styles.hint}>{t('ops.report.pick')}</Text> : null}
        <ActionError error={error} />
      </View>
    </ConfirmDialog>
  );
}

/** Block or unblock one person, with a plain confirmation. */
export function BlockDialog({ visible, profileId, name, blocked, onClose }: { visible: boolean; profileId: string; name: string; blocked: boolean; onClose: (changed: boolean) => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <ConfirmDialog
      visible={visible}
      title={blocked ? t('ops.block.unblockTitle', { name }) : t('ops.block.title', { name })}
      message={blocked ? t('ops.block.unblockText') : t('ops.block.text')}
      confirmLabel={blocked ? t('ops.block.unblock') : t('ops.block.block')}
      danger={!blocked}
      busy={busy}
      onConfirm={async () => {
        setBusy(true);
        setError(null);
        try {
          await api.rpc(blocked ? 'unblock_user' : 'block_user', { p_profile: profileId });
          await client.invalidateQueries();
          onClose(true);
        } catch (e) {
          setError(e);
        } finally {
          setBusy(false);
        }
      }}
      onCancel={() => onClose(false)}
    >
      <ActionError error={error} />
    </ConfirmDialog>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12 },
  urgent: { color: colors.alert, fontFamily: fonts.bold, fontSize: 14, lineHeight: 20 },
  hint: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
});
