// A4: name and photo. Also the 'Edit' behind the name on Me.
import type { Href } from 'expo-router';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/lib/router';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Avatar } from '@/components/Avatar';
import { CameraIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { showToast } from '@/components/Toast';
import { BackButton, Card, ErrorText, Field, Heading, Muted, PrimaryButton, TextButton } from '@/components/ui';
import { TestCode } from '@/components/TestCode';
import { PhoneField } from '@/components/PhoneField';
import { safeNext, useMe, useUpdateMe } from '@/lib/account';
import { api, uploadFile } from '@/lib/api';
import type { PickedFile } from '@/lib/api';
import { useErrorText } from '@/lib/errors';
import { showPhone, toE164 } from '@/lib/phone';
import { pickPhoto } from '@/lib/pick';
import { track } from '@/lib/track';
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
  // "Remove photo" was pressed: the saved photo goes when Save is pressed.
  const [noPhoto, setNoPhoto] = useState(false);
  // Null until typed: then the box shows the address already saved. Empty takes the address away.
  const [email, setEmail] = useState<string | null>(null);
  const emailBad = !!email?.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
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
      if (picked) {
        setPhoto(picked);
        setNoPhoto(false);
      }
    } catch (error) {
      setFailure(error);
    }
  }

  async function save() {
    setBusy(true);
    setFailure(null);
    try {
      const photoPath = photo ? await uploadFile('photos', photo) : null;
      await update.mutateAsync({ display_name: name.trim(), ...(photoPath ? { photo_path: photoPath } : noPhoto ? { photo_path: null } : {}),
        ...(email !== null ? { email: email.trim() || null } : {}),
      });
      if (editing) showToast('success', t('common.saved'));
      if (!editing) track('name_saved');
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
              <Avatar personId={me.data?.id ?? 'me'} size={AVATAR} photoUrl={noPhoto ? null : me.data?.photo_url} />
            )}
          </View>
          <View style={styles.camera}>
            <CameraIcon color={colors.white} size={18} />
          </View>
        </Pressable>
        <View style={styles.centred}>
          <Muted>{t('profile.photoHelp')}</Muted>
          {photo || (me.data?.photo_url && !noPhoto) ? (
            <TextButton
              label={t('profile.removePhoto')}
              danger
              onPress={() => {
                // A photo only just picked is simply dropped; a saved one goes on Save.
                if (photo) setPhoto(null);
                else setNoPhoto(true);
              }}
            />
          ) : null}
        </View>

        <Field label={t('profile.yourName')} value={name} onChangeText={setName} autoComplete="name" style={styles.nameInput} />

        {editing ? (
          <View style={styles.numberBlock}>
            <Field
              label={t('profile.email')}
              value={email ?? me.data?.email ?? ''}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              invalid={emailBad}
            />
            <Muted>{emailBad ? t('profile.emailBad') : t('profile.emailHelp')}</Muted>
          </View>
        ) : null}

        {me.data?.login_phone ? (
          <View style={styles.numberBlock}>
            <Field label={t('profile.mobile')} value={showPhone(me.data.login_phone)} editable={false} style={styles.numberInput} />
            <Muted>{t('profile.mobileHelp')}</Muted>
            {editing ? <ChangeNumber onChanged={() => void me.refetch()} /> : null}
          </View>
        ) : null}

        {editing || params.name ? null : (
          <Card>
            <Text style={styles.note}>{t('profile.lookedNote')}</Text>
          </Card>
        )}
        {failure ? <ErrorText>{errorText(failure)}</ErrorText> : null}
      </ScrollView>
      <PrimaryButton label={editing ? t('common.save') : t('common.continue')} onPress={save} disabled={busy} missing={!name.trim() ? t('missing.yourName') : emailBad ? t('missing.email') : null} />
    </Screen>
  );
}

/** A new SIM: a code goes to the new number, and the old number is told by text. */
function ChangeNumber({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  // Testing only: the code, when the server sends no SMS yet.
  const [testCode, setTestCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const phone = toE164(number);

  async function run(step: () => Promise<void>) {
    setBusy(true);
    setFailure(null);
    try {
      await step();
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }
  const send = () =>
    run(async () => {
      const sent = await api.post<{ test_code?: string }>('/me/phone/send', { phone });
      setTestCode(sent.test_code ?? null);
      setSentTo(phone);
      setCode('');
    });
  const confirm = () =>
    run(async () => {
      await api.post('/me/phone/verify', { phone: sentTo, code });
      showToast('success', t('profile.numberChanged'));
      setOpen(false);
      setSentTo(null);
      setNumber('');
      onChanged();
    });

  if (!open) return <TextButton label={t('profile.changeNumber')} onPress={() => setOpen(true)} />;
  return (
    <Card>
      <Muted>{t('profile.changeNumberHelp')}</Muted>
      {sentTo ? (
        <>
          <Field
            label={t('profile.codeSentTo', { phone: showPhone(sentTo) })}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="sms-otp"
          />
          <TestCode code={testCode} onUse={setCode} />
          {failure ? <ErrorText>{errorText(failure)}</ErrorText> : null}
          <PrimaryButton label={t('profile.confirmNumber')} onPress={() => void confirm()} disabled={busy} missing={code.length === 6 ? null : t('otp.needCode')} />
          <TextButton label={t('otp.changeNumber')} onPress={() => setSentTo(null)} />
        </>
      ) : (
        <>
          <PhoneField label={t('profile.newNumber')} value={number} onChangeText={setNumber} autoComplete="tel" />
          {failure ? <ErrorText>{errorText(failure)}</ErrorText> : null}
          <PrimaryButton label={t('phone.send')} onPress={() => void send()} disabled={busy} missing={phone ? null : t('phone.needNumber')} />
        </>
      )}
      <TextButton label={t('common.cancel')} onPress={() => setOpen(false)} />
    </Card>
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
  numberBlock: { gap: 6 },
  numberInput: { backgroundColor: colors.background, color: colors.muted },
  nameInput: { borderWidth: 2, borderColor: colors.logoPurple, fontFamily: fonts.bold },
  note: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
});
