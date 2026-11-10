import type { useRouter } from 'expo-router';

/** Back, or Home when there is nothing behind this screen: a reloaded web page, or a link opened straight here. */
export function goBack(router: ReturnType<typeof useRouter>): void {
  if (router.canGoBack()) router.back();
  else router.replace('/home');
}
