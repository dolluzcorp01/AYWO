// Words for an activity row, and where tapping it goes. Used by Home (F1) and Activity (E4).
import type { Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { shownName } from '@/tree/personName';
import type { ActivityItem, RequestItem } from '@/tree/useEdit';

export function useActivityText() {
  const { t } = useTranslation();

  function request(item: RequestItem, name: string, person: string): string {
    const payload = item.payload;
    if (item.kind === 'access_contacts') return t('activity.text.accessContacts', { name, person });
    if (item.kind === 'access_edit') return t('activity.text.accessEdit', { name });
    if (item.kind === 'role_upgrade') return t('activity.text.roleUpgrade', { name });
    if (item.kind === 'merge') return t('activity.text.merge', { person });
    if (payload?.action === 'add_relative') {
      const relation = payload.relation === 'parent' || payload.relation === 'child' || payload.relation === 'sibling' ? payload.relation : 'spouse';
      // A new person whose name is not known arrives as the stored marker: print the translated words instead.
      const added = payload.person?.display_name ? shownName(t, payload.person.display_name, payload.person.name_unknown) : null;
      return added
        ? t(`activity.text.add.${relation}`, { name, person, added })
        : t(`activity.text.link.${relation}`, { name, person });
    }
    if (payload?.action === 'set_elder_younger') return t('activity.text.elderYounger', { name, person });
    if (payload?.op === 'delete') return t('activity.text.remove', { name, person });
    return t('activity.text.change', { name, person });
  }

  return (item: ActivityItem): string => {
    const name = item.actor_name || t('activity.someone');
    const person = item.person_name ? shownName(t, item.person_name) : t('activity.someone');
    if (item.type === 'request') {
      const text = request(item, name, person);
      if (item.state === 'pending') return text;
      // The request ends in a name, not a full stop: without one the answer ran into it ("Vignesh Done.").
      return `${text.replace(/[.\s]+$/, '')}. ${t(`activity.state.${item.state}`)}`;
    }
    if (item.type === 'claim') return t('activity.text.joined', { name });
    if (item.type === 'share') {
      const grantee = item.grantee_name || t('share.anyoneWithLink');
      if (item.revoked) return t('activity.text.shareRevoked', { name, grantee });
      return item.waiting_for_signup ? t('activity.text.shareWaiting', { name }) : t('activity.text.share', { name, grantee });
    }
    if (item.rows > 1 && !item.person_name) return t('activity.text.batch', { name, count: item.rows });
    if (item.contacts_changed) return t('activity.text.contacts', { name, person });
    if (item.op === 'insert') return t('activity.text.added', { name, person });
    return t('activity.text.changed', { name, person });
  };
}

export function activityRoute(item: ActivityItem): Href {
  if (item.type === 'request' && item.kind === 'merge') {
    return { pathname: '/merge/[requestId]', params: { requestId: item.request_id } };
  }
  return { pathname: '/activity', params: { tab: 'needs_you' } };
}
