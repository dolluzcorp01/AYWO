// Start a 1-to-1 with someone in the family or friends circle, or make a group.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Pills, PrimaryButton, SectionTitle } from '@/components/ui';
import { api } from '@/lib/api';
import { AudiencePicker, usePeople } from '@/social/AudiencePicker';
import { ActionError, Gate, Note, Page, Row, useName } from '@/social/parts';
import type { Audience } from '@/social/types';

export default function NewChat() {
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const showName = useName();
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [name, setName] = useState('');
  const [audience, setAudience] = useState<Audience | null>(null);
  const people = usePeople();

  function openChat(id: string) {
    client.invalidateQueries({ queryKey: ['chats'] });
    router.replace({ pathname: '/social/chat/[id]', params: { id } });
  }

  const direct = useMutation({
    mutationFn: (other: string) => api.rpc<string>('chat_open_direct', { p_other: other }),
    onSuccess: openChat,
  });
  const group = useMutation({
    mutationFn: () => api.rpc<string>('chat_create_group', { p_name: name.trim(), p_audience: audience }),
    onSuccess: openChat,
  });

  return (
    <Page title={t('social.chat.new')}>
      <Pills
        options={[
          { value: 'direct' as const, label: t('social.chat.oneToOne') },
          { value: 'group' as const, label: t('social.chat.group') },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'direct' ? (
        <>
          <SectionTitle>{t('social.chat.pickPerson')}</SectionTitle>
          <ActionError error={direct.error} />
          <Gate query={people}>
            {(list) =>
              list.length === 0 ? (
                <Note>{t('social.audience.nobody')}</Note>
              ) : (
                <>
                  {list.map((p) => (
                    <Row key={p.profile_id} title={showName(p.name)} onPress={() => direct.mutate(p.profile_id)} />
                  ))}
                </>
              )
            }
          </Gate>
        </>
      ) : (
        <>
          <Field label={t('social.chat.groupName')} value={name} onChangeText={setName} maxLength={80} />
          <AudiencePicker onChange={setAudience} />
          <ActionError error={group.error} />
          <PrimaryButton
            label={t('social.chat.createGroup')}
            disabled={!name.trim() || !audience || group.isPending}
            onPress={() => group.mutate()}
          />
        </>
      )}
    </Page>
  );
}
