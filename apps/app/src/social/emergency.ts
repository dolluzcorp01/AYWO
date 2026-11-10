// F-SOS-05: the local emergency number. 112 reaches emergency services from any GSM phone, so it is the default.
import { getLocales } from 'expo-localization';

const BY_REGION: Record<string, string> = {
  IN: '112',
  US: '911',
  CA: '911',
  MX: '911',
  GB: '999',
  IE: '112',
  AU: '000',
  NZ: '111',
  SG: '995',
  MY: '999',
  AE: '999',
  SA: '911',
  QA: '999',
  KW: '112',
  OM: '9999',
  BH: '999',
  LK: '119',
  NP: '112',
  BD: '999',
  PK: '1122',
  ZA: '112',
  JP: '119',
  CN: '120',
  HK: '999',
  TH: '1669',
};

export function emergencyNumber(): string {
  const region = getLocales()[0]?.regionCode ?? '';
  return BY_REGION[region] ?? '112';
}
