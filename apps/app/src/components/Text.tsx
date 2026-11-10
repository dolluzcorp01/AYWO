// The app's Text and TextInput: the same as React Native's, but they follow the large-text setting (LLD L9, scale 1.3).
import { forwardRef } from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput } from 'react-native';
import type { StyleProp, TextInputProps, TextProps, TextStyle } from 'react-native';
import { useTextScale } from '@/lib/prefs';

function scaled(style: StyleProp<TextStyle>, scale: number): StyleProp<TextStyle> {
  if (scale === 1) return style;
  const flat = StyleSheet.flatten(style) ?? {};
  return [
    style,
    {
      fontSize: (flat.fontSize ?? 14) * scale,
      ...(flat.lineHeight ? { lineHeight: flat.lineHeight * scale } : {}),
    },
  ];
}

export function Text({ style, ...rest }: TextProps) {
  const scale = useTextScale();
  return <RNText {...rest} style={scaled(style, scale)} />;
}

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ style, ...rest }, ref) {
  const scale = useTextScale();
  return <RNTextInput {...rest} ref={ref} style={scaled(style, scale)} />;
});
