import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, PrimaryButton, SectionTitle } from '@/components/ui';
import { api } from '@/lib/api';
import { PeoplePicker } from '@/social/AudiencePicker';
import { ActionError, Note, Page } from '@/social/parts';

export default function NewGroup() {
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () => api.rpc<{ id: string }>('group_create', { p_name: name.trim(), p_members: members }),
    onSuccess: ({ id }) => {
      client.invalidateQueries({ queryKey: ['groups'] });
      client.invalidateQueries({ queryKey: ['social-circles'] });
      router.replace({ pathname: '/social/groups/[id]', params: { id } });
    },
  });
  return (
    <Page title={t('social.groups.new')}>
      <Field label={t('social.groups.name')} value={name} onChangeText={setName} maxLength={80} placeholder={t('social.groups.namePlaceholder')} />
      <SectionTitle>{t('social.groups.addPeople')}</SectionTitle>
      <Note>{t('social.groups.linkNote')}</Note>
      <PeoplePicker chosen={members} onChange={setMembers} />
      <ActionError error={create.error} />
      <PrimaryButton label={t('social.groups.create')} disabled={!name.trim() || create.isPending} onPress={() => create.mutate()} />
    </Page>
  );
}
