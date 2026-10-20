// Calendar days as the service desks see them: Pacific time, as YYYY-MM-DD
// strings, whatever time zone the browser is in.

const PACIFIC_TZ = 'America/Los_Angeles'
const DATE_LOCALES: Record<string, string> = { en: 'en-US', es: 'es', zh: 'zh-CN', vi: 'vi' }

/** Today's date at the service desks. (en-CA formats dates as YYYY-MM-DD.) */
export const pacificToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: PACIFIC_TZ }).format(new Date())

const dayToUtc = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** The day `days` after (or, if negative, before) `day`. */
export const shiftDay = (day: string, days: number) => {
  const date = dayToUtc(day)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** "Oct 21, 2026" in English; the equivalent short form in other languages. */
export const formatDay = (day: string, lang: string) =>
  dayToUtc(day).toLocaleDateString(DATE_LOCALES[lang] ?? 'en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
