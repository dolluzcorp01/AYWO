// Admin > Offers > Shop pictures: the photographs of the family tree poster and the family book that the shop shows.
// Staff add, remove and choose the main one here; the app needs no new release. Web only, like the rest of the panel.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { ProductPicture } from '@/ops/ProductPicture';
import { colors } from '@/theme/tokens';
import { adminStyles, FormDialog, formatDate, Message, Missing, Panel, Pill, QueryState, SecondaryButton, useAction, useRefreshAfter } from './ui';

type ShopProduct = 'tree_poster' | 'family_book';
interface ShopImage {
  id: string;
  product: ShopProduct;
  path: string;
  url: string | null;
  created_at: string;
  added_by_name: string | null;
}

const PRODUCTS: ShopProduct[] = ['tree_poster', 'family_book'];
const MAX_EACH = 6;
const TYPES: Record<string, 'jpg' | 'png' | 'webp'> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 15_000_000;

export function ShopPictures() {
  const { t, i18n } = useTranslation();
  const query = useQuery({ queryKey: ['admin', 'shop-images'], queryFn: () => api.get<ShopImage[]>('/admin/shop-images') });
  const refreshAfter = useRefreshAfter();
  const action = useAction();
  const [removing, setRemoving] = useState<ShopImage | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Shop screens keep the product list for a while; drop it so the new picture shows there straight away.
  const client = useQueryClient();
  const refresh = () => {
    void refreshAfter('shop-images');
    void client.invalidateQueries({ queryKey: ['shop-products'] });
  };

  async function add(product: ShopProduct) {
    setDone(null);
    action.setFailure(null);
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    const asset = picked.canceled ? null : picked.assets[0];
    if (!asset) return;
    const extension = TYPES[asset.mimeType ?? ''];
    if (!extension) return action.setFailure(t('admin.shopPictures.wrongType'));
    if ((asset.fileSize ?? 0) > MAX_BYTES) return action.setFailure(t('admin.shopPictures.tooBig'));
    const ok = await action.run(async () => {
      const contentType = asset.mimeType as string;
      const { upload_url: url, path } = await api.post<{ upload_url: string; path: string }>('/admin/shop-images/presign', { content_type: contentType, extension });
      const blob = await (await fetch(asset.uri)).blob();
      const sent = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob }).catch(() => null);
      if (!sent?.ok) throw new Error('upload_failed');
      await api.post('/admin/shop-images', { product, path });
    });
    if (ok) {
      setDone(t('admin.shopPictures.added', { product: t(`admin.orders.products.${product}`) }));
      refresh();
    }
  }

  async function makeMain(image: ShopImage) {
    setDone(null);
    if (await action.run(() => api.post(`/admin/shop-images/${image.id}/first`))) {
      setDone(t('admin.shopPictures.madeMain'));
      refresh();
    }
  }

  return (
    <>
      <Text style={adminStyles.cellMuted}>{t('admin.shopPictures.help', { max: MAX_EACH })}</Text>
      {done ? <Message text={done} good /> : null}
      {action.failure ? <Message text={action.failure} alert /> : null}
      <QueryState query={query}>
        {(all) => (
          <>
            {PRODUCTS.map((product) => {
              const images = all.filter((i) => i.product === product);
              const full = images.length >= MAX_EACH;
              return (
                <Panel
                  key={product}
                  title={t(`admin.orders.products.${product}`)}
                  actions={<SecondaryButton main label={t('admin.shopPictures.add')} disabled={action.busy || full} onPress={() => void add(product)} />}
                >
                  <Missing reasons={[full && t('admin.shopPictures.full', { max: MAX_EACH })]} />
                  {images.length === 0 ? (
                    <View style={styles.tile}>
                      <View style={styles.frame}>
                        <ProductPicture product={product} />
                      </View>
                      <Text style={adminStyles.cellMuted}>{t('admin.shopPictures.none')}</Text>
                    </View>
                  ) : (
                    <View style={styles.grid}>
                      {images.map((image, index) => (
                        <View key={image.id} style={styles.tile}>
                          <View style={styles.frame}>
                            {image.url ? <Image source={{ uri: image.url }} resizeMode="cover" accessibilityLabel={t(`admin.orders.products.${product}`)} style={styles.photo} /> : null}
                          </View>
                          {index === 0 ? <Pill label={t('admin.shopPictures.main')} /> : null}
                          <Text style={adminStyles.cellMuted}>
                            {t('admin.shopPictures.addedBy', { name: image.added_by_name ?? t('admin.users.noName'), when: formatDate(image.created_at, i18n.language) })}
                          </Text>
                          <View style={styles.buttons}>
                            {index > 0 ? <SecondaryButton label={t('admin.shopPictures.makeMain')} disabled={action.busy} onPress={() => void makeMain(image)} /> : null}
                            <SecondaryButton danger label={t('admin.shopPictures.remove')} disabled={action.busy} onPress={() => setRemoving(image)} />
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </Panel>
              );
            })}
          </>
        )}
      </QueryState>
      {removing ? (
        <FormDialog
          title={t('admin.shopPictures.removeTitle')}
          text={t('admin.shopPictures.removeText', { product: t(`admin.orders.products.${removing.product}`) })}
          confirmLabel={t('admin.shopPictures.remove')}
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await api.del(`/admin/shop-images/${removing.id}`);
            setRemoving(null);
            setDone(t('admin.shopPictures.removed'));
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  tile: { width: 220, maxWidth: '100%', gap: 8 },
  frame: { width: '100%', aspectRatio: 200 / 130, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.cardBorder },
  photo: { width: '100%', height: '100%' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
