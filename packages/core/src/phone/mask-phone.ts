import type { PhoneMarket } from './normalize-phone.js';

/**
 * A number shown to the team without revealing it (FEAT-022-VIS06: « Airtel
 * Money 66 •• •• 00 »): the first two and the last two digits of the national
 * number. Pure; anything that is not a number of `market` is fully hidden.
 */
export function maskNationalPhone(e164: string, market: PhoneMarket): string {
  if (!e164.startsWith(market.dialCode)) return '•• •• •• ••';
  const national = e164.slice(market.dialCode.length);
  if (!/^\d+$/.test(national) || national.length !== market.nationalNumberLength) {
    return '•• •• •• ••';
  }
  return `${national.slice(0, 2)} •• •• ${national.slice(-2)}`;
}
