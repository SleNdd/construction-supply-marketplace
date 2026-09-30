const astrakhanDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Astrakhan', year: 'numeric', month: '2-digit', day: '2-digit',
});

// Дата поставки считается по календарю Астрахани, независимо от часового пояса сервера.
export function todayInAstrakhan(now = new Date()): string {
  const parts = Object.fromEntries(astrakhanDate.formatToParts(now).map(({type,value})=>[type,value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function earliestDateInAstrakhan(days: number, now = new Date()): string {
  const date = new Date(`${todayInAstrakhan(now)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}
