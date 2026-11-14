// New memory: where it belongs, photos, words, the date, who is in it, and who may help add to it.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { Field, Label, Pills, PrimaryButton, SecondaryButton, SectionTitle } from '@/components/ui';
import { api, uploadFile } from '@/lib/api';
import type { PickedFile } from '@/lib/api';
import { PeoplePicker, PersonSearch, useCircles } from '@/social/AudiencePicker';
import { pickPhotos } from '@/social/media';
import { ActionError, Gate, Note, Page, Row } from '@/social/parts';
import { useVoiceInput } from '@/voice/useVoiceInput';
import { VoiceButton } from '@/voice/VoiceButton';

const MOST_PHOTOS = 20;

export default function NewMemory() {
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const circles = useCircles();
  const [scope, setScope] = useState<string | null>(null);
  const circlesData = circles.data;
  // Start on the family tree (the usual answer), so the Share button is not waiting on a question nobody saw.
  useEffect(() => {
    if (scope || !circlesData) return;
    const first = circlesData.trees.find((x) => x.whole_tree);
    if (first) setScope(`tree:${first.id}`);
    else if (circlesData.groups[0]) setScope(`group:${circlesData.groups[0].id}`);
  }, [circlesData, scope]);
  const [body, setBody] = useState('');
  const [date, setDate] = useState('');
  // A story is easier told than typed: the mic keeps listening through pauses and adds full stops.
  const bodyVoice = useVoiceInput(body, setBody, { long: true });
  const [photos, setPhotos] = useState<PickedFile[]>([]);
  const [tagged, setTagged] = useState<{ id: string; name: string }[]>([]);
  const [taggedFriends, setTaggedFriends] = useState<string[]>([]);
  const [helpers, setHelpers] = useState<string[]>([]);

  const scopeKind = scope?.split(':')[0];
  const scopeId = scope?.split(':')[1] ?? null;
  const treeId = scopeKind === 'tree' ? scopeId : null;
  const groupId = scopeKind === 'group' ? scopeId : null;
  const dateText = date.trim();
  const dateOk = dateText === '' || /^\d{4}-\d{2}-\d{2}$/.test(dateText);

  const post = useMutation({
    mutationFn: async () => {
      const paths = await Promise.all(photos.map((photo) => uploadFile('posts', photo)));
      return api.rpc<string>('post_create', {
        ...(treeId ? { p_tree: treeId } : { p_group: groupId }),
        p_body: body.trim() || null,
        ...(dateText ? { p_happened_on: dateText } : {}),
        p_media: paths,
        p_tag_people: tagged.map((p) => p.id),
        p_tag_profiles: taggedFriends,
        p_collaborators: helpers,
      });
    },
    onSuccess: (id) => {
      client.invalidateQueries({ queryKey: ['posts'] });
      router.replace({ pathname: '/social/memories/[id]', params: { id } });
    },
  });

  function changeScope(next: string) {
    setScope(next);
    setTagged([]);
    setTaggedFriends([]);
    setHelpers([]);
  }

  async function addPhotos() {
    const room = MOST_PHOTOS - photos.length;
    if (room <= 0) return;
    const more = await pickPhotos(room);
    setPhotos((now) => [...now, ...more].slice(0, MOST_PHOTOS));
  }

  return (
    <Page title={t('social.memories.new')}>
      <Gate query={circles}>
        {(data) => {
          const options = [
            ...data.trees.filter((x) => x.whole_tree).map((x) => ({ value: `tree:${x.id}`, label: x.name })),
            ...data.groups.map((g) => ({ value: `group:${g.id}`, label: g.name })),
          ];
          if (options.length === 0) return <Note>{t('social.memories.noCircle')}</Note>;
          return (
            <>
              <Label>{t('social.memories.where')}</Label>
              <Pills options={options} value={scope} onChange={changeScope} />
            </>
          );
        }}
      </Gate>

      <SecondaryButton label={t('social.memories.addPhotos')} onPress={() => void addPhotos()} />
      {photos.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {photos.map((photo) => (
            <Image key={photo.uri} source={{ uri: photo.uri }} style={styles.thumb} accessibilityLabel={t('social.memories.photo')} />
          ))}
        </ScrollView>
      ) : null}

      <Field label={t('social.memories.words')} value={body} onChangeText={setBody} multiline maxLength={4000} style={styles.words} accessory={<VoiceButton voice={bodyVoice} />} />
      <Field label={t('social.memories.when')} value={date} onChangeText={setDate} placeholder={t('social.datePlaceholder')} autoCapitalize="none" />
      {!dateOk ? <Note>{t('social.dateHelp')}</Note> : null}

      {treeId ? (
        <>
          <SectionTitle>{t('social.memories.whoIsIn')}</SectionTitle>
          {tagged.map((person) => (
            <Row key={person.id} title={person.name} subtitle={t('social.tapToRemove')} onPress={() => setTagged((now) => now.filter((p) => p.id !== person.id))} />
          ))}
          <PersonSearch
            treeId={treeId}
            label={t('social.memories.tagSomeone')}
            onPick={(person) => setTagged((now) => (now.some((p) => p.id === person.id) ? now : [...now, person]))}
          />
        </>
      ) : null}
      {groupId ? (
        <>
          <SectionTitle>{t('social.memories.whoIsIn')}</SectionTitle>
          <PeoplePicker groupId={groupId} chosen={taggedFriends} onChange={setTaggedFriends} />
        </>
      ) : null}

      {treeId || groupId ? (
        <View style={styles.block}>
          <SectionTitle>{t('social.memories.helpers')}</SectionTitle>
          <Note>{t('social.memories.helpersNote')}</Note>
          <PeoplePicker treeId={treeId} groupId={groupId} chosen={helpers} onChange={setHelpers} />
        </View>
      ) : null}

      <ActionError error={post.error} />
      <PrimaryButton
        label={post.isPending ? t('social.sending') : t('social.memories.share')}
        disabled={post.isPending}
        missing={!scope ? t('social.missing.who') : !body.trim() && photos.length === 0 ? t('social.missing.words') : !dateOk ? t('social.missing.date') : null}
        onPress={() => post.mutate()}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  strip: { gap: 8 },
  thumb: { width: 96, height: 96, borderRadius: 12 },
  words: { minHeight: 110, paddingTop: 14, textAlignVertical: 'top' },
  block: { gap: 10 },
});
