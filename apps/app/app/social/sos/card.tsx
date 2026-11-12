// Emergency card: what helpers should know if this person sends an SOS. Only the people the SOS reaches see it,
// while it runs and for a day after. Nothing here is required. Health details are kept only after the person reads
// the notice and ticks "I agree" (0019, DPDP Rules); withdrawing deletes the card in one tap.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/Text';
import { hideToastIf, showToast } from '@/components/Toast';
import { Card, Checkbox, ConfirmDialog, Field, Pills, PrimaryButton, SectionTitle, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { healthConsent, useMyConsents } from '@/ops/consents';
import { HealthNotice } from '@/ops/HealthNotice';
import type { EmergencyCard } from '@/ops/types';
import { ActionError, Gate, Note, Page } from '@/social/parts';
import { colors, fonts } from '@/theme/tokens';

const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
type Group = (typeof GROUPS)[number];

export default function EmergencyCardScreen() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const card = useQuery({ queryKey: ['emergency-card'], queryFn: () => api.rpc<EmergencyCard | null>('emergency_card_get') });
  const [blood, setBlood] = useState<Group | null>(null);
  const [allergies, setAllergies] = useState('');
  const [conditions, setConditions] = useState('');
  const [medications, setMedications] = useState('');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const [agree, setAgree] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const consents = useMyConsents();
  const consent = healthConsent(consents.data);
  // Agreed to the notice shown now. An older agreement, or none, means showing the notice and asking again.
  const agreed = !!consent?.agreed_version && !!consent.current;

  useEffect(() => {
    if (!card.data) return;
    setBlood((card.data.blood_group as Group | null) ?? null);
    setAllergies(card.data.allergies ?? '');
    setConditions(card.data.conditions ?? '');
    setMedications(card.data.medications ?? '');
    setNote(card.data.note ?? '');
  }, [card.data]);

  const save = useMutation({
    mutationFn: () =>
      api.rpc('emergency_card_save', {
        p_card: { blood_group: blood ?? '', allergies, conditions, medications, note },
        ...(agreed ? {} : { p_agree_version: consents.data?.health_notice_version }),
      }),
    onSuccess: () => {
      hideToastIf(t('ops.consent.tickFirst'));
      setSaved(true);
      client.invalidateQueries({ queryKey: ['emergency-card'] });
      client.invalidateQueries({ queryKey: ['my-consents'] });
    },
  });

  function trySave() {
    if (!agreed && !agree) {
      showToast('error', t('ops.consent.tickFirst'));
      return;
    }
    save.mutate();
  }
  const remove = useMutation({
    mutationFn: () => api.rpc('emergency_card_delete'),
    onSuccess: () => {
      setBlood(null);
      setAllergies('');
      setConditions('');
      setMedications('');
      setNote('');
      setAgree(false);
      setConfirmWithdraw(false);
      client.invalidateQueries({ queryKey: ['emergency-card'] });
      client.invalidateQueries({ queryKey: ['my-consents'] });
    },
  });

  return (
    <Page title={t('ops.card.title')} subtitle={t('ops.card.subtitle')}>
      <Gate query={consents}>
        {() => <Gate query={card}>
        {() => (
          <>
            <Card style={styles.block}>
              <SectionTitle>{t('ops.card.blood')}</SectionTitle>
              <Pills options={GROUPS.map((g) => ({ value: g, label: g }))} value={blood} onChange={setBlood} />
              {blood ? <TextButton label={t('ops.card.notSure')} onPress={() => setBlood(null)} /> : null}
            </Card>
            <Field label={t('ops.card.allergies')} value={allergies} onChangeText={setAllergies} maxLength={300} multiline placeholder={t('ops.card.allergiesHint')} />
            <Field label={t('ops.card.conditions')} value={conditions} onChangeText={setConditions} maxLength={300} multiline placeholder={t('ops.card.conditionsHint')} />
            <Field label={t('ops.card.medications')} value={medications} onChangeText={setMedications} maxLength={300} multiline />
            <Field label={t('ops.card.note')} value={note} onChangeText={setNote} maxLength={300} multiline placeholder={t('ops.card.noteHint')} />
            <Note>{t('ops.card.who')}</Note>
            {/* A card saved before the notice existed is hidden from SOS helpers until its owner agrees. */}
            {card.data && !agreed ? <Text style={styles.warn}>{t('ops.consent.hiddenUntilAgree')}</Text> : null}
            {agreed ? (
              <Text style={styles.agreed}>
                {t('ops.consent.agreedOn', { date: new Date(consent?.agreed_at ?? '').toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }) })}
              </Text>
            ) : (
              <>
                <HealthNotice />
                <Checkbox
                  label={t('ops.consent.agreeLabel')}
                  on={agree}
                  onChange={(on) => {
                    setAgree(on);
                    if (on) hideToastIf(t('ops.consent.tickFirst'));
                  }}
                />
              </>
            )}
            <ActionError error={save.error ?? remove.error} />
            {saved ? <Text style={styles.good}>{t('ops.card.saved')}</Text> : null}
            <PrimaryButton label={t('ops.card.save')} disabled={save.isPending} onPress={trySave} />
            {card.data || agreed ? <TextButton label={t('ops.consent.withdraw')} danger onPress={() => setConfirmWithdraw(true)} /> : null}
            <ConfirmDialog
              visible={confirmWithdraw}
              title={t('ops.consent.withdrawTitle')}
              message={t('ops.consent.withdrawMessage')}
              confirmLabel={t('ops.consent.withdrawConfirm')}
              danger
              busy={remove.isPending}
              onConfirm={() => remove.mutate()}
              onCancel={() => setConfirmWithdraw(false)}
            />
          </>
        )}
      </Gate>}
      </Gate>
    </Page>
  );
}

const styles = StyleSheet.create({
  block: { gap: 10 },
  good: { color: '#1F7A4D', fontFamily: fonts.bold, fontSize: 15 },
  agreed: { color: colors.muted, fontFamily: fonts.medium, fontSize: 14 },
  warn: { color: colors.alert, fontFamily: fonts.bold, fontSize: 14 },
});
