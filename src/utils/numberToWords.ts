/**
 * Conclut un montant numérique en lettres françaises (Format DH & Centimes)
 */
export function convertNumberToFrenchWords(total: number): string {
  if (total === 0) return 'Zéro Dirham';

  const units = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
  const teens = [
    'dix',
    'onze',
    'douze',
    'treize',
    'quatorze',
    'quinze',
    'seize',
    'dix-sept',
    'dix-huit',
    'dix-neuf',
  ];
  const tens = [
    '',
    'dix',
    'vingt',
    'trente',
    'quarante',
    'cinquante',
    'soixante',
    'soixante-dix',
    'quatre-vingt',
    'quatre-vingt-dix',
  ];

  function convertGroup(n: number): string {
    let result = '';

    const hundreds = Math.floor(n / 100);
    const remainder = n % 100;

    if (hundreds > 0) {
      if (hundreds === 1) {
        result += 'cent ';
      } else {
        result += units[hundreds] + ' cents ';
      }
    }

    if (remainder > 0) {
      if (remainder < 10) {
        result += units[remainder];
      } else if (remainder < 20) {
        result += teens[remainder - 10];
      } else {
        const tenDigit = Math.floor(remainder / 10);
        const unitDigit = remainder % 10;

        if (tenDigit === 7) {
          if (unitDigit === 1) {
            result += 'soixante et onze';
          } else {
            result += 'soixante-' + teens[unitDigit];
          }
        } else if (tenDigit === 9) {
          result += 'quatre-vingt-' + teens[unitDigit];
        } else {
          if (unitDigit === 1 && tenDigit !== 8) {
            result += tens[tenDigit] + ' et un';
          } else {
            result += tens[tenDigit] + (unitDigit > 0 ? '-' + units[unitDigit] : '');
          }
        }
      }
    }

    return result.trim();
  }

  const integerPart = Math.floor(total);
  const decimalPart = Math.round((total - integerPart) * 100);

  let words = '';

  if (integerPart === 0) {
    words = 'zéro';
  } else {
    let temp = integerPart;
    const billions = Math.floor(temp / 1000000000);
    temp %= 1000000000;
    const millions = Math.floor(temp / 1000000);
    temp %= 1000000;
    const thousands = Math.floor(temp / 1000);
    const ones = temp % 1000;

    if (billions > 0) {
      words += convertGroup(billions) + ' milliard' + (billions > 1 ? 's ' : ' ');
    }
    if (millions > 0) {
      words += convertGroup(millions) + ' million' + (millions > 1 ? 's ' : ' ');
    }
    if (thousands > 0) {
      if (thousands === 1) {
        words += 'mille ';
      } else {
        words += convertGroup(thousands) + ' mille ';
      }
    }
    if (ones > 0) {
      words += convertGroup(ones) + ' ';
    }
  }

  // Trim and append currency
  let result = words.trim() + (integerPart > 1 ? ' Dirhams' : ' Dirham');

  if (decimalPart > 0) {
    const decWords = convertGroup(decimalPart);
    result += ' et ' + decWords + (decimalPart > 1 ? ' centimes' : ' centime');
  }

  // Clean double spaces
  result = result.replace(/\s+/g, ' ');

  // Capitalize first letter
  return result.charAt(0).toUpperCase() + result.slice(1);
}
