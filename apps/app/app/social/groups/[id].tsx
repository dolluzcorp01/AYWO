// One friends group: the people, a join link to share, adding from the circle, leaving.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share } from 'react-native';
import { ConfirmDialog, Field, PrimaryButton, SecondaryButton, SectionTitle, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { PeoplePicker } from '@/social/AudiencePicker';
import { ActionError, Gate, Note, Page, Row, useName } from '@/social/parts';
import type { GroupDetail } from '@/social/types';

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL;

function joinLink(token: string): string {
  const path = `/social/groups/join/${token}`;
  return WEB_URL ? `${WEB_URL}${path}` : Linking.createURL(path);
}

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const showName = useName();
  const [adding, setAdding] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [leaving, setLeaving] = useState(false);
  const key = ['group', id];
  const group = useQuery({ queryKey: key, queryFn: () => api.rpc<GroupDetail>('group_detail', { p_group: id }) });
  const refresh = () => client.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: () => api.rpc('group_add_members', { p_group: id, p_members: chosen }),
    onSuccess: () => {
      setChosen([]);
      setAdding(false);
      refresh();
    },
  });
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const remove = useMutation({
    mutationFn: (profile: string) => api.rpc('group_remove_member', { p_group: id, p_profile: profile }),
    onSuccess: () => {
      setRemoving(null);
      refresh();
    },
  });
  const rename = useMutation({
    mutationFn: (name: string) => api.rpc('group_rename', { p_group: id, p_name: name.trim() }),
    onSuccess: () => {
      setRenaming(null);
      refresh();
    },
  });
  const removeGroup = useMutation({
    mutationFn: () => api.rpc('group_delete', { p_group: id }),
    onSuccess: () => {
      setDeleting(false);
      client.invalidateQueries({ queryKey: ['groups'] });
      client.invalidateQueries({ queryKey: ['social-circles'] });
      router.back();
    },
  });
  const leave = useMutation({
    mutationFn: async () => {
      const me = await api.get<{ id: string }>('/me');
      await api.rpc('group_remove_member', { p_group: id, p_profile: me.id });
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['groups'] });
      client.invalidateQueries({ queryKey: ['social-circles'] });
      router.back();
    },
  });
  const newLink = useMutation({ mutationFn: () => api.rpc<string>('group_new_link', { p_group: id }), onSuccess: refresh });

  return (
    <Page title={group.data?.name ?? t('social.groups.title')}>
      <Gate query={group}>
        {(data) => (
          <>
            <PrimaryButton
              label={t('social.groups.shareLink')}
              onPress={() => void Share.share({ message: t('social.groups.shareText', { name: data.name, link: joinLink(data.invite_token) }) })}
            />
            <Note>{t('social.groups.linkNote')}</Note>
            {data.is_mine ? <TextButton label={t('social.groups.newLink')} disabled={newLink.isPending} onPress={() => newLink.mutate()} /> : null}
            <SectionTitle>{t('social.groups.people')}</SectionTitle>
            {data.members.map((m) => (
              <Row
                key={m.profile_id}
                title={showName(m.name)}
                subtitle={m.started_it ? t('social.groups.startedIt') : data.is_mine ? t('social.tapToRemove') : undefined}
                onPress={data.is_mine && !m.started_it ? () => setRemoving({ id: m.profile_id, name: showName(m.name) }) : undefined}
              />
            ))}
            <ActionError error={remove.error} />
            {adding ? (
              <>
                <PeoplePicker chosen={chosen} onChange={setChosen} />
                <ActionError error={add.error} />
                <PrimaryButton label={t('social.groups.addChosen')} disabled={chosen.length === 0 || add.isPending} onPress={() => add.mutate()} />
              </>
            ) : (
              <SecondaryButton label={t('social.groups.addPeople')} onPress={() => setAdding(true)} />
            )}
            {data.is_mine ? <TextButton label={t('social.groups.rename')} onPress={() => setRenaming(data.name)} /> : null}
            <TextButton label={t('social.groups.leave')} danger onPress={() => setLeaving(true)} />
            {data.is_mine ? <TextButton label={t('social.groups.delete')} danger onPress={() => setDeleting(true)} /> : null}
          </>
        )}
      </Gate>
      <ConfirmDialog
        visible={leaving}
        title={t('social.groups.leaveTitle')}
        confirmLabel={t('social.groups.leave')}
        danger
        busy={leave.isPending}
        onConfirm={() => leave.mutate()}
        onCancel={() => setLeaving(false)}
      />
      <ActionError error={leave.error} />
      <ConfirmDialog
        visible={!!removing}
        title={t('social.groups.removeTitle', { name: removing?.name ?? '' })}
        message={t('social.groups.removeMessage')}
        confirmLabel={t('social.groups.removeYes')}
        danger
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmDialog
        visible={renaming !== null}
        title={t('social.groups.rename')}
        confirmLabel={t('common.save')}
        busy={rename.isPending}
        onConfirm={() => renaming?.trim() && rename.mutate(renaming)}
        onCancel={() => setRenaming(null)}
      >
        <Field label={t('social.groups.nameLabel')} value={renaming ?? ''} onChangeText={setRenaming} maxLength={80} />
        <ActionError error={rename.error} />
      </ConfirmDialog>
      <ConfirmDialog
        visible={deleting}
        title={t('social.groups.deleteTitle')}
        message={t('social.groups.deleteMessage')}
        confirmLabel={t('social.groups.delete')}
        danger
        busy={removeGroup.isPending}
        onConfirm={() => removeGroup.mutate()}
        onCancel={() => setDeleting(false)}
      >
        <ActionError error={removeGroup.error} />
      </ConfirmDialog>
    </Page>
  );
}
