// main/apps/web/src/features/settings/utils/phoneFormatting.ts

const MAX_PHONE_DIGITS = 15;

function getDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, MAX_PHONE_DIGITS);
}

function hasLeadingPlus(value: string): boolean {
  return value.trimStart().startsWith('+');
}

function formatNanpNationalNumber(digits: string): string {
  if (digits.length === 0) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function groupSubscriberDigits(digits: string): string {
  if (digits.length <= 4) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  if (digits.length <= 10) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }

  const groups = [digits.slice(0, 3), digits.slice(3, 7), digits.slice(7, 11)];
  const remainder = digits.slice(11);
  return remainder.length > 0 ? [...groups, remainder].join(' ') : groups.join(' ');
}

function formatInternationalDigits(digits: string): string {
  if (digits.startsWith('1')) {
    const national = digits.slice(1);
    return national.length > 0 ? `+1 ${formatNanpNationalNumber(national)}` : '+1';
  }

  if (digits.startsWith('7')) {
    const subscriber = digits.slice(1);
    return subscriber.length > 0 ? `+7 ${groupSubscriberDigits(subscriber)}` : '+7';
  }

  const countryCodeLength = digits.length <= 2 ? digits.length : 2;
  const countryCode = digits.slice(0, countryCodeLength);
  const subscriber = digits.slice(countryCodeLength);

  return subscriber.length > 0
    ? `+${countryCode} ${groupSubscriberDigits(subscriber)}`
    : `+${countryCode}`;
}

export function formatInternationalPhoneInput(value: string): string {
  const digits = getDigits(value);
  const shouldUseInternationalFormat =
    hasLeadingPlus(value) || (digits.length === 11 && digits.startsWith('1'));

  if (digits.length === 0) {
    return shouldUseInternationalFormat ? '+' : '';
  }

  if (shouldUseInternationalFormat) {
    return formatInternationalDigits(digits);
  }

  if (digits.length <= 10) {
    return formatNanpNationalNumber(digits);
  }

  return groupSubscriberDigits(digits);
}

export function normalizeInternationalPhoneInput(value: string): string {
  const digits = getDigits(value);
  if (digits.length === 0) return '';
  if (hasLeadingPlus(value) || (digits.length === 11 && digits.startsWith('1'))) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  return digits;
}
