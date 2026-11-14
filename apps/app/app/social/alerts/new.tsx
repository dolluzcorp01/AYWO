// New alert: death, hospital, blood, help or news. The sender always picks who hears it (F-NOT-01).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { ConfirmDialog, Field, Label, Pills, PrimaryButton } from '@/components/ui';
import { api } from '@/lib/api';
import { AudiencePicker } from '@/social/AudiencePicker';
import { ActionError, Note, Page } from '@/social/parts';
import { ALERT_KINDS, BLOOD_GROUPS } from '@/social/types';
import type { AlertKind, Audience } from '@/social/types';

export default function NewAlert() {
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const [kind, setKind] = useState<AlertKind | null>(null);
  const [blood, setBlood] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience | null>(null);
  const [confirming, setConfirming] = useState(false);

  const send = useMutation({
    mutationFn: () =>
      api.rpc<{ id: string; recipients: number }>('send_alert', {
        p_kind: kind,
        p_body: body.trim(),
        p_audience: audience,
        ...(kind === 'blood' ? { p_blood_group: blood } : {}),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['alerts'] });
      router.back();
    },
    onSettled: () => setConfirming(false),
  });

  const ready = !!kind && !!body.trim() && !!audience && (kind !== 'blood' || !!blood);
  return (
    <Page title={t('social.alerts.new')}>
      <Label>{t('social.alerts.kind')}</Label>
      <Pills options={ALERT_KINDS.map((k) => ({ value: k, label: t(`social.alerts.kinds.${k}`) }))} value={kind} onChange={setKind} />
      {kind === 'blood' ? (
        <>
          <Label>{t('social.alerts.bloodGroup')}</Label>
          <Pills options={BLOOD_GROUPS.map((g) => ({ value: g as string, label: g }))} value={blood} onChange={setBlood} />
        </>
      ) : null}
      <Field label={t('social.alerts.message')} value={body} onChangeText={setBody} multiline maxLength={500} style={styles.words} />
      <AudiencePicker onChange={setAudience} />
      <Note>{t('social.alerts.neverBlast')}</Note>
      <ActionError error={send.error} />
      <PrimaryButton
        label={t('social.alerts.send')}
        disabled={!ready || send.isPending}
        missing={!kind ? t('social.missing.kind') : kind === 'blood' && !blood ? t('social.missing.blood') : !body.trim() ? t('social.missing.message') : !audience ? t('social.missing.whoSend') : null}
        onPress={() => setConfirming(true)}
      />
      <ConfirmDialog
        visible={confirming}
        title={t('social.alerts.confirmTitle')}
        message={t('social.alerts.confirmBody')}
        confirmLabel={t('social.alerts.send')}
        busy={send.isPending}
        onConfirm={() => send.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  words: { minHeight: 110, paddingTop: 14, textAlignVertical: 'top' },
});
