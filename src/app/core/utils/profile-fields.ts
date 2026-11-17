import { TranslateService } from '@ngx-translate/core';

/** A clinic profile field a legal document cannot be issued without, named as the server names it. */
export type ProfileField = 'name' | 'ice' | 'taxId' | 'address' | 'city' | 'phone';

/** The problem code the server answers with when it refuses a document for an incomplete profile. */
export const PROFILE_INCOMPLETE = 'CLINIC_PROFILE_INCOMPLETE';

/** Where the person fills those fields in. */
export const PROFILE_LINK = '/settings/practice';

/** The name an empty profile starts with, which is not a clinic's real name. */
const PLACEHOLDER_NAME = 'cabinet';

const LABEL_KEYS: Record<string, string> = {
  name: 'SET.PROFILE.NAME', address: 'SET.PROFILE.ADDRESS', city: 'SET.PROFILE.CITY', phone: 'SET.PROFILE.PHONE',
};
/** ICE and IF are printed as they are in every language, as the settings page labels them. */
const LITERAL_LABELS: Record<string, string> = { ice: 'ICE', taxId: 'IF' };

/** "ICE, IF, Address": the fields, labelled as the settings page labels them. */
export function profileFieldLabels(fields: readonly string[], translate: TranslateService): string {
  return fields.map(f => LITERAL_LABELS[f] ?? (LABEL_KEYS[f] ? translate.instant(LABEL_KEYS[f]) : f)).join(', ');
}

type ProfileValues = Partial<Record<ProfileField, string | null | undefined>>;

/**
 * What each kind of legal document still needs from the profile, with the server's rule
 * (Letterhead.missingFor): invoices, fee notes and care forms need the name, ICE, IF, address
 * and city; prescriptions need the name, address, city and phone.
 */
export function missingForDocuments(p: ProfileValues): { financial: ProfileField[]; prescription: ProfileField[] } {
  const blank = (v: string | null | undefined) => !v || v.trim() === '';
  const nameMissing = blank(p.name) || p.name!.trim().toLowerCase() === PLACEHOLDER_NAME;
  const financial: ProfileField[] = [];
  const prescription: ProfileField[] = [];
  if (nameMissing) { financial.push('name'); prescription.push('name'); }
  if (blank(p.ice)) financial.push('ice');
  if (blank(p.taxId)) financial.push('taxId');
  if (blank(p.address)) { financial.push('address'); prescription.push('address'); }
  if (blank(p.city)) { financial.push('city'); prescription.push('city'); }
  if (blank(p.phone)) prescription.push('phone');
  return { financial, prescription };
}
