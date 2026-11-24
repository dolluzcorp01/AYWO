// What a shop product is called and how it is described: the words staff saved (Admin > App settings > Content >
// Shop products), or the app's own words where they left a box empty. English and Tamil can be set; every other
// language shows staff's English when there is one.
import { useTranslation } from 'react-i18next';
import { useAppConfig } from '@/ops/appConfig';

export function useProductWords(): { name: (product: string) => string; about: (product: string) => string } {
  const { t, i18n } = useTranslation();
  const saved = useAppConfig().data?.shop_text;
  const tamil = i18n.language.startsWith('ta');
  const pick = (product: string, part: 'name' | 'about'): string | null => {
    const words = saved?.[product]?.[part];
    return (tamil && words?.ta?.trim()) || words?.en?.trim() || null;
  };
  return {
    name: (product) => pick(product, 'name') ?? t(`ops.shop.products.${product}`),
    about: (product) => pick(product, 'about') ?? t(`ops.shop.about.${product}`, { defaultValue: '' }),
  };
}
