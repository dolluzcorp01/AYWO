// The first page. On the website it is the front page that sends people to the apps (with the web app still one
// tap away). In the phone apps it is the Welcome screen, as before.
import { Platform } from 'react-native';
import { Landing } from '@/landing/Landing';
import Welcome from './welcome';

export default function Index() {
  return Platform.OS === 'web' ? <Landing /> : <Welcome />;
}
