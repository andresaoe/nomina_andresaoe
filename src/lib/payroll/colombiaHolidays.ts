import { addDays, format, startOfDay } from 'date-fns'

function easterSunday(year: number) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

function emilianiMoveToMonday(date: Date) {
  const d = startOfDay(date)
  const day = d.getDay()
  if (day === 1) return d
  const delta = (8 - day) % 7
  return addDays(d, delta === 0 ? 7 : delta)
}

function iso(date: Date) {
  return format(startOfDay(date), 'yyyy-MM-dd')
}

const cacheByYear = new Map<number, Set<string>>()

export function getColombiaHolidaySet(year: number) {
  const cached = cacheByYear.get(year)
  if (cached) return cached

  const set = new Set<string>()

  const fixed = [
    new Date(year, 0, 1),
    new Date(year, 4, 1),
    new Date(year, 6, 20),
    new Date(year, 7, 7),
    new Date(year, 11, 8),
    new Date(year, 11, 25),
  ]
  for (const d of fixed) set.add(iso(d))

  const emiliani = [
    new Date(year, 0, 6),
    new Date(year, 2, 19),
    new Date(year, 5, 29),
    new Date(year, 7, 15),
    new Date(year, 9, 12),
    new Date(year, 10, 1),
    new Date(year, 10, 11),
  ]
  for (const d of emiliani) set.add(iso(emilianiMoveToMonday(d)))

  const easter = easterSunday(year)
  const holyThursday = addDays(easter, -3)
  const goodFriday = addDays(easter, -2)
  set.add(iso(holyThursday))
  set.add(iso(goodFriday))

  const ascension = addDays(easter, 43)
  const corpusChristi = addDays(easter, 64)
  const sacredHeart = addDays(easter, 71)
  set.add(iso(emilianiMoveToMonday(ascension)))
  set.add(iso(emilianiMoveToMonday(corpusChristi)))
  set.add(iso(emilianiMoveToMonday(sacredHeart)))

  cacheByYear.set(year, set)
  return set
}

export function isColombiaHoliday(date: Date) {
  const year = date.getFullYear()
  const set = getColombiaHolidaySet(year)
  return set.has(iso(date))
}

