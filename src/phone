// Formats a phone number as the user types it into a form field,
// inserting dashes as digits are entered: 858-555-0199.
export function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length < 4) return digits
  if (digits.length < 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}

// Formats a stored phone number for display, regardless of whether it was
// saved with or without dashes (covers records entered before this format
// was enforced at input time).
export function formatPhoneDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits[0] === '1') return `1-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`
  return raw
}
