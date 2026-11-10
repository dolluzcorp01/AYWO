import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/lib/api';

/** The i18n key to show for a failed call. Anything that is not a server answer is treated as a connection problem. */
export function errorKey(error: unknown): string {
  return error instanceof ApiFailure ? error.messageKey : 'errors.network';
}

export function errorCode(error: unknown): string | null {
  return error instanceof ApiFailure ? error.code : null;
}

/** t(error.messageKey), falling back to the general message when a new code has no text yet. */
export function useErrorText() {
  const { t } = useTranslation();
  return (error: unknown): string => t(errorKey(error), { defaultValue: t('errors.server_error') });
}
