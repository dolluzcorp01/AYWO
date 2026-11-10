// F6 / S-14 Download family data: a GEDCOM file any family-tree app can open, or a picture of the tree as a PDF.
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { CheckIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, Checkbox, ErrorText, Loading, LoadFailed, Muted, NeonPanel, PrimaryButton, TopBar } from '@/components/ui';
import { useTrees } from '@/lib/account';
import { layoutIsRtl } from '@/i18n/rtl';
import { api } from '@/lib/api';
import { useErrorText } from '@/lib/errors';
import { printOnWeb, treePicture } from '@/tree/treePicture';
import type { TreeViewAnswer } from '@/tree/useTreeView';
import { colors, fonts } from '@/theme/tokens';

type Format = 'gedcom' | 'pdf';

function fileNameFor(treeName: string): string {
  const safe = treeName.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '_');
  return `${safe || 'family'}.ged`;
}

/** Saves on the web, opens the phone's share sheet in the apps (Files, Drive, WhatsApp and so on). */
async function deliverGedcom(text: string, name: string): Promise<void> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = globalThis.document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }
  // Loaded here because the file system module exists only in the apps.
  const { File, Paths } = await import('expo-file-system');
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  await file.write(text);
  await Sharing.shareAsync(file.uri, { mimeType: 'text/plain', dialogTitle: name });
}

/** Draws the tree here, so every script has a font: the phone's own, or the browser's. */
async function deliverPicture(html: string, width: number, height: number, name: string): Promise<void> {
  if (Platform.OS === 'web') {
    await printOnWeb(html);
    return;
  }
  // Loaded here because the print module is only used in the apps.
  const Print = await import('expo-print');
  const { uri } = await Print.printToFileAsync({ html, width, height });
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: name });
}

export default function ExportScreen() {
  const { treeId } = useLocalSearchParams<{ treeId: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const trees = useTrees();
  const [format, setFormat] = useState<Format>('gedcom');
  const [includeLiving, setIncludeLiving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const tree = trees.data?.find((row) => row.id === treeId);

  async function download() {
    if (!tree) return;
    setBusy(true);
    setFailure(null);
    setDone(false);
    try {
      if (format === 'gedcom') {
        const text = await api.text(`/trees/${treeId}/export.ged?include_living=${includeLiving ? 1 : 0}`);
        await deliverGedcom(text, fileNameFor(tree.name));
      } else {
        const data = await api.post<TreeViewAnswer>('/tree-view', { tree_id: treeId, mode: 'names', lang: i18n.language });
        const picture = treePicture(data, { includeLiving, dir: layoutIsRtl() ? 'rtl' : 'ltr', t });
        await deliverPicture(picture.html, picture.width, picture.height, tree.name);
      }
      setDone(true);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  if (trees.isError) {
    return (
      <Screen>
        <LoadFailed message={errorText(trees.error)} onRetry={() => trees.refetch()} />
      </Screen>
    );
  }
  if (!trees.data) {
    return (
      <Screen>
        <Loading label={t('tree.loading')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TopBar
          title={t('export.title')}
          subtitle={tree ? t('export.subtitle', { tree: tree.name, count: tree.people }) : undefined}
          onBack={() => goBack(router)}
        />
        <Muted>{t('export.explain')}</Muted>

        <Option on={format === 'gedcom'} title={t('export.gedcom')} help={t('export.gedcomHelp')} onPress={() => setFormat('gedcom')} />
        <Option on={format === 'pdf'} title={t('export.pdf')} help={t('export.pdfHelp')} onPress={() => setFormat('pdf')} />

        <Card>
          <Checkbox label={t('export.living')} help={t('export.livingHelp')} on={includeLiving} onChange={setIncludeLiving} />
        </Card>

        {failure ? <ErrorText>{errorText(failure)}</ErrorText> : null}
        {done ? <Text accessibilityRole="alert" style={styles.done}>{t('export.done')}</Text> : null}
      </ScrollView>
      <PrimaryButton label={busy ? t('export.preparing') : t('export.download')} onPress={download} disabled={busy || !tree} />
    </Screen>
  );
}

function Option({ on, title, help, onPress }: { on: boolean; title: string; help: string; onPress: () => void }) {
  const body = (
    <View style={styles.option}>
      <View style={[styles.radio, on && styles.radioOn]}>{on ? <CheckIcon color={colors.logoIndigo} size={14} width={3} /> : null}</View>
      <View style={styles.optionText}>
        <Text style={[styles.title, on && styles.titleOn]}>{title}</Text>
        <Text style={[styles.help, on && styles.helpOn]}>{help}</Text>
      </View>
    </View>
  );
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={onPress}>
      {on ? <NeonPanel>{body}</NeonPanel> : <Card>{body}</Card>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 12, paddingBottom: 12 },
  option: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  optionText: { flex: 1, minWidth: 0 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.dashed, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: colors.white, borderColor: colors.white },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 17 },
  titleOn: { color: colors.white },
  help: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  helpOn: { color: colors.onNeon },
  done: { color: colors.relation, fontFamily: fonts.bold, fontSize: 14 },
});
