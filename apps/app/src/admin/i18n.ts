import i18n from '@/i18n';
import enUSAdmin from '../../../../locales/en-US.admin.json';
import taAdmin from '../../../../locales/ta.admin.json';

// src/i18n joins the area files with a shallow spread, so one area's `errors` block replaces another's.
// This adds the admin error words on top of whatever is there, without touching the other areas.
i18n.addResourceBundle('en-US', 'translation', { errors: enUSAdmin.errors }, true, true);
i18n.addResourceBundle('ta', 'translation', { errors: taAdmin.errors }, true, true);
