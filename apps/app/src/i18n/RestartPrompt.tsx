// Shown after choosing a language that reads the other way. Native only: the web changes direction at once.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, ErrorText } from '@/components/ui';
import { dismissRestart, restartApp, useRestartNeeded } from '@/i18n/rtl';

export function RestartPrompt() {
  const { t } = useTranslation();
  const needed = useRestartNeeded();
  const [failed, setFailed] = useState(false);
  return (
    <ConfirmDialog
      visible={needed}
      title={t('language.restartTitle')}
      message={t('language.restartHelp')}
      confirmLabel={t('language.restartNow')}
      onConfirm={() => {
        setFailed(false);
        restartApp().catch(() => setFailed(true));
      }}
      onCancel={dismissRestart}
    >
      {failed ? <ErrorText>{t('language.restartFailed')}</ErrorText> : null}
    </ConfirmDialog>
  );
}
