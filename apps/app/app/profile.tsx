// A4: name and photo. Also the 'Edit' behind the name on Me.
import type { Href } from 'expo-router';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Avatar } from '@/components/Avatar';
import { CameraIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { BackButton, Card, ErrorText, Field, Heading, Muted, PrimaryButton } from '@/components/ui';
import { safeNext, useMe, useUpdateMe } from '@/lib/account';
import { uploadFile } from '@/lib/api';
import type { PickedFile } from '@/lib/api';
import { useErrorText } from '@/lib/errors';
import { pickPhoto } from '@/lib/pick';
import { colors, fonts, gradients } from '@/theme/tokens';

const AVATAR = 132;

export default function Profile() {
  const { t } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const params = useLocalSearchParams<{ next?: string; name?: string; edit?: string }>();
  const editing = params.edit === '1';
  const me = useMe();
  const update = useUpdateMe();
  const [name, setName] = useState(params.name ?? '');
  const [photo, setPhoto] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  useEffect(() => {
    if (me.data?.display_name && !name) setName(me.data.display_name);
    // Fill in once; after that the box belongs to the person typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data?.display_name]);

  async function choosePhoto() {
    setFailure(null);
    try {
      const picked = await pickPhoto();
      if (picked) setPhoto(picked);
    } catch (error) {
      setFailure(error);
    }
  }

  async function save() {
    setBusy(true);
    setFailure(null);
    try {
      const photoPath = photo ? await uploadFile('photos', photo) : null;
      await update.mutateAsync({ display_name: name.trim(), ...(photoPath ? { photo_path: photoPath } : {}) });
      if (editing) goBack(router);
      else router.replace((safeNext(params.next) ?? '/home') as Href);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {editing ? (
          <BackButton onPress={() => goBack(router)} />
        ) : (
          <View accessibilityLabel={t('profile.lastStep')} style={styles.progress}>
            {[0, 1, 2].map((i) => (
              <LinearGradient key={i} colors={[gradients.button[0], colors.logoOrange]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.progressBar} />
            ))}
          </View>
        )}
        <Heading>{t('profile.title')}</Heading>

        <Pressable accessibilityRole="button" accessibilityLabel={t('profile.addPhoto')} onPress={choosePhoto} style={styles.photoWrap}>
          <View style={styles.photoRing}>
            {photo ? (
              <Image source={{ uri: photo.uri }} style={styles.photo} accessibilityIgnoresInvertColors />
            ) : (
              <Avatar personId={me.data?.id ?? 'me'} size={AVATAR} photoUrl={me.data?.photo_url} />
            )}
          </View>
          <View style={styles.camera}>
            <CameraIcon color={colors.white} size={18} />
          </View>
        </Pressable>
        <View style={styles.centred}>
          <Muted>{t('profile.photoHelp')}</Muted>
        </View>

        <Field label={t('profile.yourName')} value={name} onChangeText={setName} autoComplete="name" style={styles.nameInput} />

        {editing || params.name ? null : (
          <Card>
            <Text style={styles.note}>{t('profile.lookedNote')}</Text>
          </Card>
        )}
        {failure ? <ErrorText>{errorText(failure)}</ErrorText> : null}
      </ScrollView>
      <PrimaryButton label={editing ? t('common.save') : t('common.continue')} onPress={save} disabled={!name.trim() || busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 14, paddingBottom: 16 },
  progress: { flexDirection: 'row', gap: 6, marginTop: 24, marginBottom: 12 },
  progressBar: { flex: 1, height: 5, borderRadius: 3 },
  photoWrap: { alignSelf: 'center', marginTop: 4 },
  photoRing: { borderRadius: AVATAR / 2 + 5, borderWidth: 2, borderColor: colors.logoYellow, padding: 3 },
  photo: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
  camera: {
    position: 'absolute',
    end: 0,
    bottom: 0,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: colors.white,
    backgroundColor: colors.logoIndigo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centred: { alignItems: 'center' },
  nameInput: { borderWidth: 2, borderColor: colors.logoPurple, fontFamily: fonts.bold },
  note: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
});
