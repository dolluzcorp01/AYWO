// Comments on a person's card (S-07). Commenter and up may write; the row rules decide.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, EmptyState, ErrorText, Field, Loading, LoadFailed, SmallButton, TopBar } from '@/components/ui';
import { useErrorText } from '@/lib/errors';
import { useTimeAgo } from '@/lib/time';
import { useAddComment, useComments } from '@/tree/useEdit';
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

  function send() {
    const text = body.trim();
    if (!text) return;
    add.mutate(text, { onSuccess: () => setBody('') });
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TopBar title={t('comments.title')} subtitle={node?.name} onBack={() => goBack(router)} />
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
              </Card>
            )}
          />
        )}
        {add.isError ? <ErrorText>{errorText(add.error)}</ErrorText> : null}
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
  flex: { flex: 1 },
  list: { flexGrow: 1, gap: 10, paddingVertical: 14 },
  comment: { gap: 4, padding: 12 },
  author: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 14 },
  body: { color: colors.text, fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 },
  when: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  compose: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 8 },
});
