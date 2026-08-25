/**
 * Basic input sanitization utilities to prevent XSS and command injections.
 */

export function sanitizeString(val: string, maxLength?: number): string {
  if (typeof val !== 'string') return '';

  let cleaned = val.trim();

  // Strip null bytes
  cleaned = cleaned.replace(/\0/g, '');

  // HTML escaping for safe rendering to prevent XSS if outputted directly
  cleaned = cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');

  if (maxLength && cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength);
  }

  return cleaned;
}

export function sanitizeHtml(val: string, maxLength?: number): string {
  if (typeof val !== 'string') return '';
  let cleaned = val.trim();

  // Strip null bytes
  cleaned = cleaned.replace(/\0/g, '');

  // Strip potentially malicious scripts/tags but preserve safe layout elements (like divs, tables, style) for emails
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  cleaned = cleaned.replace(/on\w+="[^"]*"/g, '');
  cleaned = cleaned.replace(/on\w+='[^']*'/g, '');
  cleaned = cleaned.replace(/javascript:[^\s]*/gi, '');

  if (maxLength && cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength);
  }

  return cleaned;
}
