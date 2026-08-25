export class OcrService {
  /**
   * Cleans raw text of whitespace and unprintable characters.
   */
  public static cleanText(text: string): string {
    if (!text) return '';
    return text
      .replace(/[\r\n]+/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  /**
   * Resolves common OCR character swaps for numbers (e.g. 'O'/'o' for '0', 'I'/'l' for '1').
   */
  public static cleanNumberString(str: string): string {
    if (!str) return '0';
    let cleaned = str.trim().replace(/[oO]/g, '0').replace(/[Il|]/g, '1').replace(/\s/g, ''); // remove inner spaces

    // Normalize decimal comma to dot
    if (cleaned.includes(',') && !cleaned.includes('.')) {
      cleaned = cleaned.replace(',', '.');
    } else if (cleaned.includes(',') && cleaned.includes('.')) {
      // European format 1.000,50 -> 1000.50
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    }

    // Extract first valid decimal number pattern
    const match = cleaned.match(/[-+]?[0-9]*\.?[0-9]+/);
    return match ? match[0] : '0';
  }

  /**
   * Attempts to parse dates from various French and common formats into YYYY-MM-DD.
   */
  public static parseStandardDate(dateStr: string): string {
    if (!dateStr) return '';

    let cleaned = dateStr.trim().toLowerCase();

    // Replace French months
    const months: { [key: string]: string } = {
      janvier: '01',
      janv: '01',
      jan: '01',
      février: '02',
      fevrier: '02',
      févr: '02',
      fev: '02',
      mars: '03',
      mar: '03',
      avril: '04',
      avr: '04',
      mai: '05',
      juin: '06',
      jui: '06',
      juillet: '07',
      juil: '07',
      août: '08',
      aout: '08',
      ao: '08',
      septembre: '09',
      sept: '09',
      sep: '09',
      octobre: '10',
      oct: '10',
      novembre: '11',
      nov: '11',
      décembre: '12',
      decembre: '12',
      dec: '12',
    };

    for (const [monthName, monthNum] of Object.entries(months)) {
      if (cleaned.includes(monthName)) {
        // e.g., "12 mai 2026" or "12-mai-2026"
        const parts = cleaned.split(/[\s\-\/\,]+/);
        const dayPart = parts.find((p) => !isNaN(parseInt(p)) && parseInt(p) <= 31);
        const yearPart = parts.find((p) => !isNaN(parseInt(p)) && p.length === 4);

        if (dayPart && yearPart) {
          const dd = dayPart.padStart(2, '0');
          return `${yearPart}-${monthNum}-${dd}`;
        }
      }
    }

    // Handles formats like DD/MM/YYYY or DD-MM-YYYY
    const numericMatch = cleaned.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
    if (numericMatch) {
      const dd = numericMatch[1].padStart(2, '0');
      const mm = numericMatch[2].padStart(2, '0');
      let yyyy = numericMatch[3];
      if (yyyy.length === 2) {
        yyyy = '20' + yyyy;
      }
      return `${yyyy}-${mm}-${dd}`;
    }

    // Return original cleaned if matches YYYY-MM-DD
    const isoMatch = cleaned.match(/^\d{4}-\d{2}-\d{2}$/);
    if (isoMatch) return cleaned;

    return dateStr;
  }
}
