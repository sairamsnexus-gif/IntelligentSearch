/**
 * Phone numbers are an identity *signal*, never proof. We only normalise and
 * read offline metadata bundled with libphonenumber-js (country, number type).
 * No carrier/subscriber lookup, no location tracking.
 */
import { parsePhoneNumberFromString, findPhoneNumbersInText, type CountryCode } from "libphonenumber-js/max";

export interface PhoneInfo {
  input: string;
  valid: boolean;
  e164?: string;
  international?: string;
  country?: string;
  type?: string;
}

const COUNTRY_TO_ISO: Record<string, CountryCode> = {
  India: "IN",
  "United Kingdom": "GB",
  "United States": "US",
  Canada: "CA",
  Singapore: "SG",
  "United Arab Emirates": "AE",
  Australia: "AU",
  Germany: "DE",
};

export function isoForCountry(country?: string): CountryCode | undefined {
  return country ? COUNTRY_TO_ISO[country] : undefined;
}

export function normalizePhone(input: string, defaultCountry?: string): PhoneInfo {
  const iso = isoForCountry(defaultCountry) ?? "IN";
  const p = parsePhoneNumberFromString(input, iso);
  if (!p) return { input, valid: false };
  return {
    input,
    valid: p.isValid(),
    e164: p.number,
    international: p.formatInternational(),
    country: p.country,
    type: p.getType() ?? undefined,
  };
}

export function findPhones(text: string, defaultCountry?: string): string[] {
  const iso = isoForCountry(defaultCountry) ?? "IN";
  try {
    return Array.from(new Set(findPhoneNumbersInText(text, iso).filter((m) => m.number.isValid()).map((m) => m.number.number)));
  } catch {
    return [];
  }
}
