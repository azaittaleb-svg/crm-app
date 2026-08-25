export function deduplicateExpenses(data: any[], toDeleteOutput: string[]) {
  const seenNames = new Map<string, any>();

  for (const exp of data) {
    const isRecurring = exp.templateId && exp.templateId !== 'instant';
    const strName = (exp.name || '')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    const templateKey = isRecurring ? `tpl_${exp.monthYear}_${strName}` : null;
    let collisionKey: string | null = null;

    if (templateKey && seenNames.has(templateKey)) {
      collisionKey = templateKey;
    }

    if (collisionKey) {
      const existing = seenNames.get(collisionKey)!;
      if (existing.status === 'PENDING' && exp.status === 'PAID') {
        toDeleteOutput.push(existing.id);
        seenNames.set(collisionKey, exp);
      } else if (existing.status === 'PAID' && exp.status === 'PENDING') {
        toDeleteOutput.push(exp.id);
      } else {
        toDeleteOutput.push(exp.id);
      }
    } else {
      if (templateKey) {
        seenNames.set(templateKey, exp);
      } else {
        const safeKey = `inst_${exp.id}_${strName}`;
        seenNames.set(safeKey, exp);
      }
    }
  }

  return Array.from(new Set(seenNames.values()));
}
