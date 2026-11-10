// Several photos at once, for chat and memories. Shape is what uploadFile expects.
import * as ImagePicker from 'expo-image-picker';
import type { PickedFile } from '@/lib/api';

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

export async function pickPhotos(limit: number): Promise<PickedFile[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    quality: 0.8,
  });
  if (result.canceled) return [];
  return result.assets.slice(0, limit).map((asset) => {
    const contentType = asset.mimeType && IMAGE_TYPES[asset.mimeType] ? asset.mimeType : 'image/jpeg';
    return { uri: asset.uri, contentType, extension: IMAGE_TYPES[contentType] };
  });
}
