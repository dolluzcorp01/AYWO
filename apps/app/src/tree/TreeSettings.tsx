// Rename or delete a tree you made. Opened from Me. Deleting asks for the word "delete", as deleting an account does.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showToast } from '@/components/Toast';
import { ConfirmDialog, ErrorText, Field, Muted, Pills, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { useErrorText } from '@/lib/errors';
import { deleteWordShown, isDeleteWord } from '@/lib/deleteWord';

export function TreeSettings({ trees, onClose }: { trees: { id: string; name: string }[]; onClose: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const errorText = useErrorText();
  const [treeId, setTreeId] = useState(trees[0]?.id ?? '');
  const tree = trees.find((x) => x.id === treeId) ?? trees[0];
  // Null until typed: then the box shows the name the tree has now.
  const [typed, setTyped] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [word, setWord] = useState('');
  const name = typed ?? tree?.name ?? '';
  // The English word is always accepted too: not every phone can type the translated one.
  const ownWord = t('settings.deleteWord');
  const deleteWord = deleteWordShown(ownWord);

  // Everything that shows a tree's name or lists the trees.
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ['trees'] }), client.invalidateQueries({ queryKey: ['tree-view'] }), client.invalidateQueries({ queryKey: ['social-circles'] })]);
  const rename = useMutation({
    mutationFn: () => api.patch(`/trees/${treeId}`, { name: name.trim() }),
    onSuccess: async () => {
      await refresh();
      showToast('success', t('common.saved'));
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/trees/${treeId}`),
    onSuccess: async () => {
      await refresh();
      showToast('success', t('me.treeDeleted'));
      onClose();
    },
  });

  if (!tree) return null;
  const unchanged = name.trim() === tree.name || !name.trim();
  return (
    <ConfirmDialog
      visible
      title={t('me.treeSettings')}
      confirmLabel={t('me.saveTreeName')}
      busy={unchanged || rename.isPending || remove.isPending}
      onConfirm={() => rename.mutate()}
      onCancel={onClose}
    >
      {trees.length > 1 ? (
        <Pills
          options={trees.map((x) => ({ value: x.id, label: x.name }))}
          value={treeId}
          onChange={(id) => {
            setTreeId(id);
            setTyped(null);
            setDeleting(false);
            setWord('');
          }}
        />
      ) : null}
      <Field label={t('me.treeName')} value={name} onChangeText={setTyped} maxLength={200} />
      {rename.isError ? <ErrorText>{errorText(rename.error)}</ErrorText> : null}
      {deleting ? (
        <>
          <Muted>{t('me.deleteTreeText', { name: tree.name, word: deleteWord })}</Muted>
          <Field value={word} onChangeText={setWord} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('me.deleteTree')} placeholder={deleteWord} />
          {remove.isError ? <ErrorText>{errorText(remove.error)}</ErrorText> : null}
          <TextButton
            label={t('me.deleteTreeYes', { name: tree.name })}
            danger
            disabled={!isDeleteWord(word, ownWord) || remove.isPending}
            onPress={() => remove.mutate()}
          />
        </>
      ) : (
        <TextButton label={t('me.deleteTree')} danger onPress={() => setDeleting(true)} />
      )}
    </ConfirmDialog>
  );
}
