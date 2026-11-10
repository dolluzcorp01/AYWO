import { useTranslation } from 'react-i18next';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** '2 min ago', '1 hour ago', then a date. */
export function useTimeAgo() {
  const { t, i18n } = useTranslation();
  return (iso: string | null | undefined): string => {
    if (!iso) return '';
    const then = new Date(iso);
    const gap = Date.now() - then.getTime();
    if (Number.isNaN(gap)) return '';
    if (gap < MINUTE) return t('time.justNow');
    if (gap < HOUR) return t('time.minutes', { count: Math.floor(gap / MINUTE) });
    if (gap < DAY) return t('time.hours', { count: Math.floor(gap / HOUR) });
    if (gap < 7 * DAY) return t('time.days', { count: Math.floor(gap / DAY) });
    return then.toLocaleDateString(i18n.language);
  };
}
