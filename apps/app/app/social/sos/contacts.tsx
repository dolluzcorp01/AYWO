// F-SOS-01: choose up to five SOS contacts. The first in the list gets the call.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { DownIcon, UpIcon } from '@/components/Icons';
import { PhoneField } from '@/components/PhoneField';
import { Text } from '@/components/Text';
import { Card, ErrorText, Field, SecondaryButton, SectionTitle, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { toE164 } from '@/lib/phone';
import { usePeople } from '@/social/AudiencePicker';
import { ActionError, Gate, Note, Page, Row, useName } from '@/social/parts';
import type { SosContact } from '@/social/types';
import { colors, fonts, minTapSize } from '@/theme/tokens';

const MOST = 5;

export default function SosContacts() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const showName = useName();
  const [typedName, setTypedName] = useState('');
  const [typedPhone, setTypedPhone] = useState('');
  const [badPhone, setBadPhone] = useState(false);
  const contacts = useQuery({ queryKey: ['sos-contacts'], queryFn: () => api.rpc<SosContact[]>('sos_contacts_list') });
  const people = usePeople();
  const refresh = () => client.invalidateQueries({ queryKey: ['sos-contacts'] });

  const add = useMutation({
    mutationFn: (input: { profile?: string; phone?: string; name?: string }) =>
      api.rpc('sos_contact_add', {
        ...(input.profile ? { p_contact_profile: input.profile } : {}),
        ...(input.phone ? { p_phone: input.phone } : {}),
        ...(input.name ? { p_name: input.name } : {}),
      }),
    onSuccess: () => {
      setTypedName('');
      setTypedPhone('');
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.rpc('sos_contact_remove', { p_id: id }), onSuccess: refresh });
  const reorder = useMutation({ mutationFn: (ids: string[]) => api.rpc('sos_contacts_reorder', { p_ids: ids }), onSuccess: refresh });

  function move(list: SosContact[], index: number, by: number) {
    const ids = list.map((c) => c.id);
    const [taken] = ids.splice(index, 1);
    ids.splice(index + by, 0, taken);
    reorder.mutate(ids);
  }

  function addTyped() {
    const phone = toE164(typedPhone);
    if (!phone) {
      setBadPhone(true);
      return;
    }
    setBadPhone(false);
    add.mutate({ phone, name: typedName.trim() });
  }

  const list = contacts.data ?? [];
  const chosen = new Set(list.map((c) => c.contact_profile_id));
  const full = list.length >= MOST;

  return (
    <Page title={t('social.sos.chooseContacts')} subtitle={t('social.sos.contactsSubtitle')}>
      <Gate query={contacts}>
        {(rows) => (
          <>
            {rows.length === 0 ? <Note>{t('social.sos.noContacts')}</Note> : null}
            {rows.map((c, i) => (
              <Card key={c.id} style={styles.row}>
                <View style={styles.text}>
                  <Text style={styles.name}>{showName(c.name || c.phone)}</Text>
                  {i === 0 ? <Note>{c.phone ? t('social.sos.getsTheCall') : t('social.sos.noDirectCall')}</Note> : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('social.sos.moveUp')}
                  disabled={i === 0 || reorder.isPending}
                  onPress={() => move(rows, i, -1)}
                  style={[styles.icon, i === 0 && styles.off]}
                >
                  <UpIcon color={colors.text} size={18} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('social.sos.moveDown')}
                  disabled={i === rows.length - 1 || reorder.isPending}
                  onPress={() => move(rows, i, 1)}
                  style={[styles.icon, i === rows.length - 1 && styles.off]}
                >
                  <DownIcon color={colors.text} size={18} />
                </Pressable>
                <TextButton label={t('social.remove')} danger onPress={() => remove.mutate(c.id)} />
              </Card>
            ))}
          </>
        )}
      </Gate>
      <ActionError error={add.error ?? remove.error ?? reorder.error} />

      {full ? (
        <Note>{t('social.sos.fullList', { count: MOST })}</Note>
      ) : (
        <>
          <SectionTitle>{t('social.sos.fromFamily')}</SectionTitle>
          <Gate query={people}>
            {(rows) => {
              const open = rows.filter((p) => !chosen.has(p.profile_id));
              if (open.length === 0) return <Note>{t('social.audience.nobody')}</Note>;
              return (
                <>
                  {open.map((p) => (
                    <Row key={p.profile_id} title={showName(p.name)} subtitle={t('social.sos.tapToAdd')} onPress={() => add.mutate({ profile: p.profile_id })} />
                  ))}
                </>
              );
            }}
          </Gate>

          <SectionTitle>{t('social.sos.byNumber')}</SectionTitle>
          <Note>{t('social.sos.byNumberNote')}</Note>
          <Field label={t('social.sos.contactName')} value={typedName} onChangeText={setTypedName} maxLength={80} />
          <PhoneField
            label={t('social.sos.contactPhone')}
            value={typedPhone}
            onChangeText={(v) => {
              setTypedPhone(v);
              setBadPhone(false);
            }}
            invalid={badPhone}
          />
          {badPhone ? <ErrorText>{t('errors.phone_not_valid')}</ErrorText> : null}
          <SecondaryButton label={t('social.sos.addNumber')} disabled={!typedPhone.trim() || add.isPending} onPress={addTyped} />
        </>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, padding: 10 },
  text: { flex: 1, minWidth: 120 },
  name: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  icon: { width: minTapSize, height: minTapSize, alignItems: 'center', justifyContent: 'center' },
  off: { opacity: 0.3 },
});
