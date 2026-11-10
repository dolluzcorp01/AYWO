// System notices to everyone (PRD: 'never marketing blasts to families'). AYWO Admin only, with a reason, audited.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TextInput, View } from 'react-native';
import { Actions, AdminPage, adminStyles, FormDialog, Message, SecondaryButton } from '@/admin/ui';
import { api } from '@/lib/api';

const MIN_TITLE = 3;
const MAX_TITLE = 80;
const MIN_BODY = 10;
const MAX_BODY = 500;
const MIN_REASON = 5;

export default function AdminBroadcast() {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const ready = title.trim().length >= MIN_TITLE && body.trim().length >= MIN_BODY;

  return (
    <AdminPage title={t('admin.broadcast.title')} subtitle={t('admin.broadcast.subtitle')} gates={['staff']}>
      <View style={adminStyles.field}>
        <Text style={adminStyles.fieldLabel}>{t('admin.broadcast.heading')}</Text>
        <TextInput value={title} onChangeText={setTitle} maxLength={MAX_TITLE} accessibilityLabel={t('admin.broadcast.heading')} style={adminStyles.input} />
      </View>
      <View style={adminStyles.field}>
        <Text style={adminStyles.fieldLabel}>{t('admin.broadcast.body')}</Text>
        <TextInput value={body} onChangeText={setBody} maxLength={MAX_BODY} multiline numberOfLines={5} accessibilityLabel={t('admin.broadcast.body')} style={adminStyles.input} />
      </View>
      {sent !== null ? <Message text={t('admin.broadcast.sent', { count: sent })} /> : null}
      <Actions>
        <SecondaryButton label={t('admin.broadcast.send')} disabled={!ready} onPress={() => setAsking(true)} />
      </Actions>
      {asking ? (
        <FormDialog
          title={t('admin.broadcast.confirmTitle')}
          text={t('admin.broadcast.confirmText')}
          fields={[{ name: 'reason', label: t('admin.broadcast.reason'), minLength: MIN_REASON, multiline: true }]}
          confirmLabel={t('admin.broadcast.send')}
          danger
          onCancel={() => setAsking(false)}
          onConfirm={async ({ reason }) => {
            const answer = await api.post<{ recipients: number }>('/admin/broadcast', { title: title.trim(), body: body.trim(), reason });
            setSent(answer.recipients);
            setTitle('');
            setBody('');
            setAsking(false);
          }}
        />
      ) : null}
    </AdminPage>
  );
}
