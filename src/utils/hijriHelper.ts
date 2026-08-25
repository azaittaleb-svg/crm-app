export interface IslamicDateInfo {
  day: number;
  month: number;
  year: number;
  monthName: string;
  formatted: string;
}

export function getIslamicDate(): IslamicDateInfo {
  const isSimulating = localStorage.getItem('simulate_hijri_zakat_reminder') === 'true';

  if (isSimulating) {
    return {
      day: 20,
      month: 1,
      year: 1447,
      monthName: 'Mouharram',
      formatted: '20 Mouharram 1447',
    };
  }

  try {
    const formatter = new Intl.DateTimeFormat('fr-FR-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    });
    const parts = formatter.formatToParts(new Date());
    const day = parseInt(parts.find((p) => p.type === 'day')?.value || '0', 10);
    const month = parseInt(parts.find((p) => p.type === 'month')?.value || '0', 10);
    const year = parseInt(parts.find((p) => p.type === 'year')?.value || '0', 10);

    const frenchMonthNames = [
      'Mouharram',
      'Safar',
      "Rabi' al-awwal",
      "Rabi' ath-thani",
      'Jumada al-ula',
      'Jumada al-akhira',
      'Rajab',
      "Sha'ban",
      'Ramadan',
      'Shawwal',
      "Dhu al-Qi'dah",
      'Dhu al-Hijjah',
    ];

    return {
      day,
      month,
      year,
      monthName: frenchMonthNames[month - 1] || 'Mouharram',
      formatted: `${day} ${frenchMonthNames[month - 1] || 'Mouharram'} ${year}`,
    };
  } catch (error) {
    console.error('Error formatting Hijri date, fallback:', error);
    // Safe standard fallback estimate
    return {
      day: 20,
      month: 1,
      year: 1447,
      monthName: 'Mouharram',
      formatted: '20 Mouharram 1447',
    };
  }
}

/**
 * Checks if the Zakat reminder should be active.
 * Ideally, active when month is Mouharram (month === 1) or simulation is enabled.
 */
export function isZakatReminderActive(): boolean {
  const islamicDate = getIslamicDate();

  // Triggers during the whole month of Mouharram (month 1), and especially highlights on/after the 20th.
  const isDismissed = localStorage.getItem(`zakat_dismissed_year_${islamicDate.year}`) === 'true';
  if (isDismissed) return false;

  const isSimulating = localStorage.getItem('simulate_hijri_zakat_reminder') === 'true';
  if (isSimulating) return true;

  return islamicDate.month === 1;
}

/**
 * Reset simulation state
 */
export function toggleZakatSimulation(enable: boolean): void {
  localStorage.setItem('simulate_hijri_zakat_reminder', enable ? 'true' : 'false');
  if (enable) {
    const date = getIslamicDate();
    localStorage.removeItem(`zakat_dismissed_year_${date.year}`);
    localStorage.removeItem(`zakat_sim_dismissed_year_${date.year}`);
  }
  // Dispatch a custom event to notify components of simulation changes
  window.dispatchEvent(new Event('zakatSimulationChange'));
}

/**
 * Dismiss reminder for current year
 */
export function dismissZakatReminderForYear(): void {
  const date = getIslamicDate();
  localStorage.setItem(`zakat_dismissed_year_${date.year}`, 'true');
  window.dispatchEvent(new Event('zakatSimulationChange'));
}

/**
 * Undismiss/Reset Zakat reminder for year testing
 */
export function resetZakatReminderForYear(): void {
  const date = getIslamicDate();
  localStorage.removeItem(`zakat_dismissed_year_${date.year}`);
  localStorage.removeItem(`zakat_sim_dismissed_year_${date.year}`);
  window.dispatchEvent(new Event('zakatSimulationChange'));
}

export interface ZakatSimulationInfo {
  hasPreviousButNoCurrent: boolean;
  previousName: string;
  previousAmount: number;
  recommendedName: string;
  recommendedAmount: number;
}

export function detectZakatSimulation(templates: any[]): ZakatSimulationInfo | null {
  if (!templates || templates.length === 0) return null;

  const islamicDate = getIslamicDate();
  const currentGregorianYear = new Date().getFullYear();

  // Find the latest template (highest year extracted, or simply the most recently updated/created)
  let latestTemplate = templates[0];
  let maxYearFound = 0;
  let isHijriYear = false;

  for (const t of templates) {
    const name = t.name || '';
    const match = name.match(/\b(14\d{2}|20\d{2})\b/);
    if (match) {
      const yr = parseInt(match[1], 10);
      if (yr > maxYearFound) {
        maxYearFound = yr;
        latestTemplate = t;
        isHijriYear = yr < 1600; // Hijri years are < 1600
      }
    }
  }

  // If no year found, just take the first template in list as the baseline
  if (maxYearFound === 0) {
    latestTemplate = templates[0];
    maxYearFound = currentGregorianYear - 1;
  }

  // Check if we already have a template for the current year
  const currentYearTarget = isHijriYear ? islamicDate.year : currentGregorianYear;

  // Let's check if any template has the currentYearTarget in its name or is the current year
  const hasCurrentYearTemplate = templates.some((t) => {
    const name = (t.name || '').toLowerCase();
    return (
      name.includes(currentYearTarget.toString()) ||
      name.includes(islamicDate.year.toString()) ||
      name.includes(currentGregorianYear.toString())
    );
  });

  if (hasCurrentYearTemplate) {
    return null; // Already setup!
  }

  // Determine the recommended name
  const oldName = latestTemplate.name || '';
  const oldYearStr = maxYearFound > 0 ? maxYearFound.toString() : '';
  const newYearStr = currentYearTarget.toString();

  let recommendedName = `ZAKAT ${newYearStr}`;
  if (oldYearStr && oldName.includes(oldYearStr)) {
    recommendedName = oldName.replace(oldYearStr, newYearStr);
  } else if (oldName) {
    recommendedName = `${oldName} ${newYearStr}`;
  }

  return {
    hasPreviousButNoCurrent: true,
    previousName: oldName,
    previousAmount: latestTemplate.amount,
    recommendedName,
    recommendedAmount: latestTemplate.amount, // Estimate same base as last year
  };
}
