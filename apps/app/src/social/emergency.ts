// F-SOS-05: the local emergency number. 112 reaches emergency services from any GSM phone, so it is the default.
import { defaultCountry } from '@/lib/phone';
import { useAppConfig } from '@/ops/appConfig';

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

/**
 * The number to offer on the SOS screens: what staff saved for this country (Admin > App settings > Emergency
 * numbers), else the list above, else 112. The list above is also what shows before the settings have loaded.
 */
export function useEmergencyNumber(): string {
  const saved = useAppConfig().data?.emergency_numbers;
  const mine = saved?.[defaultCountry()];
  return typeof mine === 'string' && /^[0-9]{2,6}$/.test(mine) ? mine : emergencyNumber();
}

export function emergencyNumber(): string {
  // From the time zone first: a browser in India that says en-US must still show 112, not 911.
  return BY_REGION[defaultCountry()] ?? '112';
}
