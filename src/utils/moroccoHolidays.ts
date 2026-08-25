export interface Holiday {
  id: string;
  name: string;
  dateStr: string; // MM-DD for fixed, or special logic for Hijri
  type: 'national' | 'school' | 'religious';
  daysUntil: number;
}

export function getUpcomingHolidays(): Holiday[] {
  const now = new Date();
  const year = now.getFullYear();

  // Static Morocco National Holidays (Gregorian)
  const fixedHolidays = [
    { name: 'Nouvel An', month: 1, day: 1 },
    { name: "Manifeste de l'Indépendance", month: 1, day: 11 },
    { name: 'Fête du Travail', month: 5, day: 1 },
    { name: 'Fête du Trône', month: 7, day: 30 },
    { name: 'Oued Ed-Dahab', month: 8, day: 14 },
    { name: 'Révolution du Roi et du Peuple', month: 8, day: 20 },
    { name: 'Fête de la Jeunesse', month: 8, day: 21 },
    { name: 'Marche Verte', month: 11, day: 6 },
    { name: "Fête de l'Indépendance", month: 11, day: 18 },
  ];

  const upcomingHolidays: Holiday[] = [];

  // Helper to check within 3 days
  const addIfUpcoming = (name: string, date: Date, type: 'national' | 'school' | 'religious') => {
    // Reset hours for accurate day difference
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    // Also include if it's today
    const diffTime = target.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Show upcoming holidays within 3 days (or happened today)
    if (diffDays >= 0 && diffDays <= 3) {
      upcomingHolidays.push({
        id: `${name}-${target.getTime()}`,
        name,
        dateStr: target.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }),
        type,
        daysUntil: diffDays,
      });
    }
  };

  for (const h of fixedHolidays) {
    let date = new Date(year, h.month - 1, h.day);
    // If passed this year, check next year
    if (date.getTime() + 86400000 < now.getTime()) {
      date = new Date(year + 1, h.month - 1, h.day);
    }
    addIfUpcoming(h.name, date, 'national');
  }

  // School and Religious Holidays (Examples for demonstration, usually dynamic)
  // For Moroccan religious holidays, they follow the Hijri calendar, but we can set some hardcoded approximate dates for the current year
  const dynamicHolidays = [
    { name: 'Aïd al-Fitr', month: 3, day: 20, type: 'religious' }, // Approximate
    { name: 'Aïd al-Adha', month: 5, day: 27, type: 'religious' }, // Approximate
    { name: 'Fatih Mouharram', month: 6, day: 16, type: 'religious' }, // Approximate
    { name: 'Aïd Al Mawlid', month: 8, day: 24, type: 'religious' }, // Approximate
    { name: "Vacances d'Hiver", month: 1, day: 26, type: 'school' },
    { name: 'Vacances de Printemps', month: 4, day: 15, type: 'school' },
    { name: "Vacances d'Été", month: 7, day: 1, type: 'school' },
  ];

  for (const h of dynamicHolidays) {
    let date = new Date(year, h.month - 1, h.day);
    if (date.getTime() + 86400000 < now.getTime()) {
      date = new Date(year + 1, h.month - 1, h.day);
    }
    addIfUpcoming(h.name, date, h.type as 'school' | 'religious');
  }

  upcomingHolidays.sort((a, b) => a.daysUntil - b.daysUntil);
  return upcomingHolidays;
}
