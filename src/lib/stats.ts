// Статистика за всю жизнь программы: питомец сбежал — цифры остаются. Только счётчики и время,
// никаких названий программ и фильмов: файл лежит в папке данных и никуда не уходит.
// Копит окно кошки (App.svelte), показывает окно «Статистика» (Stats.svelte).

import * as affection from './affection';
import * as chrono from './chrono';
import { count, lang, t } from './i18n';

export { plural } from './i18n';

/** Время копится шагами кадра; больше этого за шаг не засчитываем — компьютер спал, а не мы вместе. */
export const MAX_STEP_MS = 60_000;

export const COUNTERS = [
  /** Сколько программа работала с питомцем дома, мс. */
  'together',
  /** Из них засчитанное кино, мс. */
  'filmMs',
  'films',
  'fed',
  'petted',
  'carried',
  'naps',
  /** Разбудили кликом, тряской или взяли на руки спящую. */
  'woken',
  'mice',
  /** Вернулась из-за края облизываясь. */
  'caught',
  'yarns',
  'lasers',
  'revenges',
  'puddles',
  'said',
  /** Пряталась от созвона. */
  'calls',
  /** Ушла насовсем от голода. */
  'runaways',
  /** Сколько тортиков за время вместе уже отмечено (holidays.ts). */
  'cakes',
  /** Сколько годовщин уже отмечено. */
  'years',
] as const;
export type Counter = (typeof COUNTERS)[number];

export type Stats = Record<Counter, number> & {
  /** С какого момента считаем, мс. Старые файлы без даты начинают отсчёт с первой загрузки. */
  since: number;
  /** Мс, когда человек за компьютером и кошка дома, по часам суток 0..23 — для хронотипа. */
  hours: number[];
};

export function fresh(now: number): Stats {
  const s = { since: now, hours: Array(24).fill(0) } as Stats;
  for (const k of COUNTERS) s[k] = 0;
  return s;
}

/** Битое и чужое не роняет программу: непонятное поле — ноль, непонятная дата — сейчас. */
export function load(raw: string | null, now: number): Stats {
  const s = fresh(now);
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw ?? '{}') ?? {};
  } catch {
    return s;
  }
  if (typeof o !== 'object') return s;
  for (const k of COUNTERS) {
    const v = Number(o[k]);
    if (Number.isFinite(v) && v > 0) s[k] = Math.floor(v);
  }
  const since = Number(o.since);
  if (Number.isFinite(since) && since > 0 && since <= now) s.since = since;
  if (Array.isArray(o.hours)) {
    s.hours = s.hours.map((_, h) => {
      const v = Number((o.hours as unknown[])[h]);
      return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    });
  }
  return s;
}

export function save(s: Stats): string {
  return JSON.stringify(s);
}

/**
 * Шаг кадра: дома — время вместе, на засчитанном сеансе — ещё и время кино.
 * `hour` 0..23 — человек за компьютером в этот час (для хронотипа); -1 — отошёл.
 */
export function tick(s: Stats, ms: number, home: boolean, film: boolean, hour = -1): Stats {
  const dt = Math.min(Math.max(ms, 0), MAX_STEP_MS) || 0;
  if (!home || dt === 0) return s;
  const n = { ...s, together: s.together + dt, filmMs: film ? s.filmMs + dt : s.filmMs };
  if (Number.isInteger(hour) && hour >= 0 && hour < 24) {
    n.hours = s.hours.slice();
    n.hours[hour] += dt;
  }
  return n;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Коротко, две старшие единицы: «меньше минуты», «12 мин», «3 ч 5 мин», «2 дн 4 ч» (2d 4h). */
export function duration(ms: number): string {
  if (ms < MIN) return t('меньше минуты', 'under a minute');
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  const m = Math.floor((ms % HOUR) / MIN);
  const [dd, hh, mm] = t([' дн', ' ч', ' мин'], ['d', 'h', 'm']);
  if (d > 0) return h > 0 ? `${d}${dd} ${h}${hh}` : `${d}${dd}`;
  if (h > 0) return m > 0 ? `${h}${hh} ${m}${mm}` : `${h}${hh}`;
  return `${m}${mm}`;
}

/** Сколько календарных дней прошло, считая первый: в день знакомства — 1. */
export function days(since: number, now: number): number {
  const a = new Date(since);
  const b = new Date(now);
  const start = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const end = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.max(1, Math.round((end - start) / DAY) + 1);
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** «6 ноября 2026» / «November 6, 2026»: без Intl, чтобы не зависеть от локали WebView. */
export function date(ms: number): string {
  const d = new Date(ms);
  if (lang() === 'en') return `${MONTHS_EN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export interface Row {
  label: string;
  value: string;
  /** Мелкая приписка под цифрой. */
  hint?: string;
  /** Шкала под цифрой, 0..1. */
  meter?: number;
}

export interface Group {
  title: string;
  rows: Row[];
}

function times(n: number): string {
  return count(n, ['раз', 'раза', 'раз'], ['time', 'times']);
}

/** Готовые строки для окна: разделы, подписи и цифры уже на языке интерфейса. */
export function groups(s: Stats, now: number): Group[] {
  const n = days(s.since, now);
  const caught = s.mice > 0 ? t(`поймана ${s.caught} из ${s.mice}`, `caught ${s.caught} of ${s.mice}`) : undefined;
  const love = affection.level(s);
  return [
    {
      title: t('Вместе', 'Together'),
      rows: [
        { label: t('Знакомы', 'Friends for'), value: count(n, ['день', 'дня', 'дней'], ['day', 'days']), hint: t(`с ${date(s.since)}`, `since ${date(s.since)}`) },
        { label: t('Привязанность', 'Affection'), value: t(`${love} из 100`, `${love} of 100`), hint: affection.word(love), meter: love / 100 },
        { label: t('Рядом на экране', 'On screen together'), value: duration(s.together) },
        {
          label: t('Кино вместе', 'Movies together'),
          value: count(s.films, ['фильм', 'фильма', 'фильмов'], ['movie', 'movies']),
          hint: s.filmMs > 0 ? duration(s.filmMs) : undefined,
        },
      ],
    },
    {
      title: t('Забота', 'Care'),
      rows: [
        { label: t('Покормили', 'Fed'), value: times(s.fed) },
        { label: t('Погладили', 'Petted'), value: times(s.petted) },
        { label: t('Носили на руках', 'Carried'), value: times(s.carried) },
      ],
    },
    {
      title: t('Сон', 'Sleep'),
      rows: [
        { label: t('Уснула', 'Naps'), value: times(s.naps) },
        { label: t('Разбудили', 'Woken up'), value: times(s.woken) },
      ],
    },
    {
      title: t('Игры', 'Games'),
      rows: [
        { label: t('Погоня за мышью (отключена)', 'Mouse chase (disabled)'), value: `${s.mice}`, hint: caught },
        { label: t('Клубки', 'Yarn balls'), value: `${s.yarns}` },
        { label: t('Лазерная указка', 'Laser pointer'), value: times(s.lasers) },
      ],
    },
    {
      title: t('Характер', 'Character'),
      rows: [
        { label: t('Режим дня', 'Daily rhythm'), ...chrono.describe(chrono.kind(s.hours)) },
        { label: t('Мстила', 'Took revenge'), value: times(s.revenges), hint: s.puddles > 0 ? t(`луж: ${s.puddles}`, `puddles: ${s.puddles}`) : undefined },
        { label: t('Пряталась от созвонов', 'Hid from calls'), value: times(s.calls) },
        { label: t('Облачков с мыслями', 'Thought bubbles'), value: `${s.said}` },
        { label: t('Сбежала от голода', 'Ran away hungry'), value: times(s.runaways) },
      ],
    },
  ];
}
