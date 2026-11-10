// Opening a shared group link. Needs an account: the sign-in gate sends visitors to log in first.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Muted, PrimaryButton } from '@/components/ui';
import { api } from '@/lib/api';
import { ActionError, Gate, Page } from '@/social/parts';

export default function JoinGroup() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const preview = useQuery({
    queryKey: ['group-join', token],
    queryFn: () => api.rpc<{ id: string; name: string; already_in: boolean }>('group_join_preview', { p_token: token }),
  });
  const open = (id: string) => router.replace({ pathname: '/social/groups/[id]', params: { id } });
  const join = useMutation({
    mutationFn: () => api.rpc<string>('group_join', { p_token: token }),
    onSuccess: (id) => {
      client.invalidateQueries({ queryKey: ['groups'] });
      client.invalidateQueries({ queryKey: ['social-circles'] });
      open(id);
    },
  });

  const alreadyIn = preview.data?.already_in ? preview.data.id : null;
  useEffect(() => {
    if (alreadyIn) open(alreadyIn);
    // Moves on once, when the answer arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alreadyIn]);

  return (
    <Page title={t('social.groups.joinTitle')}>
      <Gate query={preview}>
        {(data) => (
          <>
            <Muted>{t('social.groups.joinAsk', { name: data.name })}</Muted>
            <ActionError error={join.error} />
            <PrimaryButton label={t('social.groups.join')} disabled={join.isPending} onPress={() => join.mutate()} />
          </>
        )}
      </Gate>
    </Page>
  );
}
