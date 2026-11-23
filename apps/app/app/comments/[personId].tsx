// Comments on a person's card (S-07). Commenter and up may write; the row rules decide.
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/lib/router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, ConfirmDialog, EmptyState, ErrorText, Field, Loading, LoadFailed, SmallButton, TextButton, TopBar } from '@/components/ui';
import { useMe } from '@/lib/account';
import { useErrorText } from '@/lib/errors';
import { useTimeAgo } from '@/lib/time';
import { ReportDialog } from '@/ops/Report';
import { shownName } from '@/tree/personName';
import { useAddComment, useChangeComment, useComments } from '@/tree/useEdit';
import { useTreeView } from '@/tree/useTreeView';
import { colors, fonts } from '@/theme/tokens';

const MAX_LENGTH = 2000;

export default function Comments() {
  const { personId, treeId } = useLocalSearchParams<{ personId: string; treeId: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const timeAgo = useTimeAgo();
  const comments = useComments(personId);
  const add = useAddComment(personId);
  const tree = useTreeView(treeId, 'mine', i18n.language, null);
  const node = tree.data?.nodes.find((n) => n.id === personId);
  const [body, setBody] = useState('');
  const me = useMe();
  const change = useChangeComment(personId);
  // The note being reworded (its text goes into the box at the bottom), and the one about to be deleted.
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [reporting, setReporting] = useState<{ id: string; ownerId: string; ownerName: string } | null>(null);
  const iMadeTheTree = tree.data?.role === 'creator';

  function send() {
    const text = body.trim();
    if (!text) return;
    if (editing) {
      change.mutate({ id: editing, body: text }, { onSuccess: () => { setBody(''); setEditing(null); } });
      return;
    }
    add.mutate(text, { onSuccess: () => setBody('') });
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TopBar title={t('comments.title')} subtitle={node ? shownName(t, node.name, node.nameUnknown) : undefined} onBack={() => goBack(router)} />
        {comments.isError ? (
          <LoadFailed message={errorText(comments.error)} onRetry={() => comments.refetch()} />
        ) : !comments.data ? (
          <Loading label={t('tree.loading')} />
        ) : (
          <FlatList
            style={styles.flex}
            data={comments.data}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<EmptyState message={t('comments.empty')} />}
            renderItem={({ item }) => (
              <Card style={styles.comment}>
                <Text style={styles.author}>{item.author_name ?? t('activity.someone')}</Text>
                <Text style={styles.body}>{item.body}</Text>
                <Text style={styles.when}>{timeAgo(item.created_at)}</Text>
                {item.author_id === me.data?.id || iMadeTheTree ? (
                  <View style={styles.own}>
                    {item.author_id === me.data?.id ? (
                      <TextButton label={t('social.edit')} onPress={() => { setEditing(item.id); setBody(item.body); }} />
                    ) : null}
                    <TextButton label={t('social.delete')} danger onPress={() => setDeleting(item.id)} />
                  </View>
                ) : null}
                {/* Someone else's note can be reported to AYWO staff. Your own you can simply edit or delete. */}
                {me.data && item.author_id && item.author_id !== me.data.id ? (
                  <View style={styles.own}>
                    <TextButton label={t('ops.report.short')} onPress={() => setReporting({ id: item.id, ownerId: item.author_id, ownerName: item.author_name ?? t('activity.someone') })} />
                  </View>
                ) : null}
              </Card>
            )}
          />
        )}
        {add.isError ? <ErrorText>{errorText(add.error)}</ErrorText> : null}
        {change.isError ? <ErrorText>{errorText(change.error)}</ErrorText> : null}
        {editing ? <TextButton label={t('comments.stopEditing')} onPress={() => { setEditing(null); setBody(''); }} /> : null}
        <ConfirmDialog
          visible={!!deleting}
          title={t('social.memories.deleteCommentTitle')}
          confirmLabel={t('social.delete')}
          danger
          onConfirm={() => {
            if (deleting) change.mutate({ id: deleting });
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
        {reporting ? (
          <ReportDialog
            visible
            type="person_comment"
            id={reporting.id}
            ownerId={reporting.ownerId}
            ownerName={reporting.ownerName}
            onClose={() => setReporting(null)}
          />
        ) : null}
        <View style={styles.compose}>
          <View style={styles.flex}>
            <Field
              value={body}
              onChangeText={setBody}
              placeholder={t('comments.placeholder')}
              accessibilityLabel={t('comments.placeholder')}
              multiline
              maxLength={MAX_LENGTH}
            />
          </View>
          <SmallButton label={t('comments.send')} onPress={send} disabled={!body.trim() || add.isPending} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  own: { flexDirection: 'row', gap: 16 },
  flex: { flex: 1 },
  list: { flexGrow: 1, gap: 10, paddingVertical: 14 },
  comment: { gap: 4, padding: 12 },
  author: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 14 },
  body: { color: colors.text, fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 },
  when: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  compose: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 8 },
});
