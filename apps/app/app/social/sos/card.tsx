// Emergency card: what helpers should know if this person sends an SOS. Only the people the SOS reaches see it,
// while it runs and for a day after. Nothing here is required.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/Text';
import { Card, Field, Pills, PrimaryButton, SectionTitle, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import type { EmergencyCard } from '@/ops/types';
import { ActionError, Gate, Note, Page } from '@/social/parts';
import { fonts } from '@/theme/tokens';

const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
type Group = (typeof GROUPS)[number];

export default function EmergencyCardScreen() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const card = useQuery({ queryKey: ['emergency-card'], queryFn: () => api.rpc<EmergencyCard | null>('emergency_card_get') });
  const [blood, setBlood] = useState<Group | null>(null);
  const [allergies, setAllergies] = useState('');
  const [conditions, setConditions] = useState('');
  const [medications, setMedications] = useState('');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);

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
      }),
    onSuccess: () => {
      setSaved(true);
      client.invalidateQueries({ queryKey: ['emergency-card'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.rpc('emergency_card_delete'),
    onSuccess: () => {
      setBlood(null);
      setAllergies('');
      setConditions('');
      setMedications('');
      setNote('');
      client.invalidateQueries({ queryKey: ['emergency-card'] });
    },
  });

  return (
    <Page title={t('ops.card.title')} subtitle={t('ops.card.subtitle')}>
      <Gate query={card}>
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
            <ActionError error={save.error ?? remove.error} />
            {saved ? <Text style={styles.good}>{t('ops.card.saved')}</Text> : null}
            <PrimaryButton label={t('ops.card.save')} disabled={save.isPending} onPress={() => save.mutate()} />
            {card.data ? <TextButton label={t('ops.card.delete')} danger onPress={() => remove.mutate()} /> : null}
          </>
        )}
      </Gate>
    </Page>
  );
}

const styles = StyleSheet.create({
  block: { gap: 10 },
  good: { color: '#1F7A4D', fontFamily: fonts.bold, fontSize: 15 },
});
