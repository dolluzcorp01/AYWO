// The mic button beside a box. Tap to speak, tap again to stop. Red while listening. Hidden where speech is not available.
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';
import { MicIcon } from '@/components/Icons';
import type { VoiceInput } from '@/voice/useVoiceInput';
import { colors, minTapSize } from '@/theme/tokens';

export function VoiceButton({ voice, size = minTapSize }: { voice: VoiceInput; size?: number }) {
  const { t } = useTranslation();
  if (!voice.available) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={voice.listening ? t('voice.stop') : t('voice.speak')}
      accessibilityState={{ selected: voice.listening }}
      onPress={voice.toggle}
      hitSlop={6}
      style={[styles.button, { width: size, height: size, borderRadius: size / 2 }, voice.listening && styles.on]}
    >
      <MicIcon color={voice.listening ? colors.white : colors.logoIndigo} size={Math.round(size * 0.46)} width={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint },
  on: { backgroundColor: colors.alert },
});
