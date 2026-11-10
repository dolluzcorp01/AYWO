// Choosing files from the phone, in the shape uploadFile expects.
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import type { PickedFile } from '@/lib/api';

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

/** A square photo from the gallery, or null if the person backed out. */
export async function pickPhoto(): Promise<PickedFile | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const contentType = asset.mimeType && IMAGE_TYPES[asset.mimeType] ? asset.mimeType : 'image/jpeg';
  return { uri: asset.uri, contentType, extension: IMAGE_TYPES[contentType] };
}

export interface PickedImport extends PickedFile {
  name: string;
  source: 'lighten' | 'gedcom';
}

export type ImportPick = { kind: 'file'; file: PickedImport } | { kind: 'cancelled' } | { kind: 'wrong_type'; name: string };

/** A Lighten mind map (.zip or .lighten) or any GEDCOM file (.ged). The server reads it and answers with a preview. */
export async function pickImportFile(): Promise<ImportPick> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets[0]) return { kind: 'cancelled' };
  const asset = result.assets[0];
  const name = asset.name;
  const lower = name.toLowerCase();
  if (lower.endsWith('.ged') || lower.endsWith('.gedcom')) {
    return { kind: 'file', file: { uri: asset.uri, name, source: 'gedcom', contentType: 'text/plain', extension: 'ged' } };
  }
  if (lower.endsWith('.zip') || lower.endsWith('.lighten')) {
    return { kind: 'file', file: { uri: asset.uri, name, source: 'lighten', contentType: 'application/zip', extension: 'zip' } };
  }
  return { kind: 'wrong_type', name };
}
