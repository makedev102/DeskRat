// Облачка-реплики: когда кошке заговорить и что сказать. Только решения — без окон и таймеров;
// окно облачка (Bubble.svelte, bubble.rs) показывает то, что выбрано здесь.
//
// Говорит редко и только в паузу: человек тут, ничего не набирает, на весь экран ничего нет.
// «Иногда» — раз в 10–30 минут, интервал каждый раз случайный; «часто» — для тех, кому нужна
// компания; «молчун» говорит только по делу (голод). Отмахнулись подряд — болтает реже.
// Работа и отдых не смешиваются: в рабочее время — только тихое «ты молодец» и забота.
//
// Факты по темам из настроек — одно из тех же случайных облачков, а не лишнее сверху: раз в
// 1–3 часа чистого времени очередная реплика становится фактом. В работу — только рабочие темы,
// и то реже. Погладили вскоре после факта — тема в почёте, отмахнулись — звучит реже.

import { FACTS } from './facts';
import { pick, type Lang } from './i18n';
import type { Chatter, Topic } from './settings';

const MIN = 60_000;

/** Между двумя случайными репликами; у молчуна их нет. */
export const RANGES: Record<Chatter, [number, number] | null> = {
  quiet: null,
  sometimes: [10 * MIN, 30 * MIN],
  often: [5 * MIN, 15 * MIN],
};
/** После любого облачка — хотя бы столько тишины, даже для заботы. */
export const GAP_MS = 3 * MIN;
/** Голодная напоминает не чаще. */
export const HUNGRY_EVERY_MS = 20 * MIN;
/** Без перерыва столько — тянется и зовёт размяться. */
export const CARE_SECS = 90 * 60;
/** Столько в фокусе — хвалит. Кошка хвалит редко, зато ценно: раз за сессию. */
export const PRAISE_SECS = 2 * 60 * 60;
/** Каждое «отмахнулись подряд» растягивает интервал на столько, но не больше чем втрое. */
const SHOO_STRETCH = 0.5;
const SHOO_MAX = 3;
/** Погладили кошку вскоре после облачка — реплика понравилась. */
export const LIKED_MS = MIN;
/** Между фактами — столько чистого времени за компом, секунды; момент внутри — случайный. */
export const FACT_RANGE: [number, number] = [3600, 3 * 3600];
/** В рабочее время факт ждёт сверх срока ещё столько: можно, но редко. */
export const FACT_WORK_EXTRA = 2 * 3600;
/** О чём можно и в рабочее время; остальные темы — для отдыха. */
export const WORK_TOPICS: readonly Topic[] = ['наука', 'техника', 'программирование'];
/** Вес темы: погладили после факта — умножаем, отмахнулись — делим. Ноль нельзя: тему человек выбрал сам. */
const WEIGHT_UP = 1.5;
const WEIGHT_DOWN = 0.5;
const WEIGHT_MIN = 0.25;
const WEIGHT_MAX = 4;
/** Сказанные факты помним не больше стольких: свежие из сети прибавляются каждый день. */
const TOLD_MAX = 500;

export interface Talk {
  /** Раньше этого случайной реплики не будет, мс эпохи. */
  next: number;
  /** Когда было последнее облачко, мс эпохи; 0 — ещё не говорила. */
  spoke: number;
  /** Сколько облачков подряд смахнули кликом. */
  shooed: number;
  /** Последняя реплика: одно и то же два раза подряд не говорим. */
  last: string;
  /** Когда напоминала про голод. */
  hungryAt: number;
  /** Длина сессии на прошлом шаге: стала меньше — человек отходил, сессия новая. */
  session: number;
  /** Что в этой сессии уже сказано: забота, похвала. */
  inSession: string[];
  /** Раз в день: ключ события → день (YYYY-MM-DD), когда его сказали. */
  daily: Record<string, string>;
  /** Сколько ещё чистого времени до факта, секунды; меньше нуля — факт ждёт своей реплики. */
  factIn: number;
  /** «Сегодня за компом» на прошлом шаге: по разнице считается чистое время; -1 — ещё не видели. */
  clean: number;
  /** Сказанные факты — чтобы не повторяться, пока по теме есть несказанные. */
  told: string[];
  /** Тема → вес при выборе факта; нет записи — 1. */
  weights: Record<string, number>;
  /** Тема последнего облачка, если это был факт: на неё ляжет «погладили» или «отмахнулись». */
  topic: string;
}

/** Что питомец знает о моменте. */
export interface Moment {
  now: Date;
  /** Человек тут и не занят: не отошёл, не набирает текст, ничего на весь экран. */
  pause: boolean;
  /** Секунды текущей сессии без перерыва. */
  session: number;
  /** Чистое время за компом сегодня, секунды. */
  today: number;
  hungry: boolean;
  /** Кошке есть когда: дома, бодрая, стоит на месте. */
  free: boolean;
  /** Темы из настроек; пусто — фактов нет. */
  topics: readonly Topic[];
  /** Свежие факты дня по темам (из сети); их — раньше встроенных. */
  extra?: Partial<Record<Topic, readonly string[]>>;
  /** Имя питомца; пусто — реплики с {name} не звучат. */
  name?: string;
}

export interface Line {
  /** Откуда реплика — по нему считаются «раз за сессию» и «раз в день». */
  key: string;
  text: string;
}

interface Lines {
  hungry: readonly string[];
  work: readonly string[];
  rest: readonly string[];
  today: string;
  care: string;
  praise: string;
  morning: string;
  night: string;
  friday: string;
}

const LINES: Record<Lang, Lines> = {
  ru: {
    hungry: ['Миска пустая. Подсыплешь?', 'Есть хочу. Клик по миске?'],
    work: ['Ты молодец.', 'Я тут, рядом.', 'Хорошо работаем.', 'Я тихонько посижу.', '{name} на посту.'],
    rest: ['Я здесь.', 'Хорошо сидим.', 'Погладишь?', 'А я бы вздремнула.', 'Что там интересного?', 'Ничего не происходит. Красота.', 'Это я, {name}.'],
    today: 'Сегодня мы за компом уже {today}.',
    care: 'Уже {session} без перерыва. Потянемся?',
    praise: '{session} в фокусе. Ты молодец.',
    morning: 'Доброе утро!',
    night: 'Уже {time}. Может, спать?',
    friday: 'Пятница! Маленькая вечеринка?',
  },
  en: {
    hungry: ['The bowl is empty. A little food?', "I'm hungry. Click the bowl?"],
    work: ["You're doing great.", "I'm right here.", 'Good work, team.', "I'll sit quietly.", '{name} on duty.'],
    rest: ['Here I am.', 'Nice and cozy.', 'Pet me?', 'I could use a nap.', 'Anything interesting over there?', 'Nothing is happening. Lovely.', "It's me, {name}."],
    today: "We've been at the computer for {today} today.",
    care: '{session} without a break. Time to stretch?',
    praise: '{session} of focus. Well done.',
    morning: 'Good morning!',
    night: "It's {time} already. Bedtime, maybe?",
    friday: "It's Friday! Tiny party?",
  },
};

export function fresh(now: number, level: Chatter, rand: () => number): Talk {
  return {
    next: now + interval(level, 0, rand),
    spoke: 0,
    shooed: 0,
    last: '',
    hungryAt: 0,
    session: 0,
    inSession: [],
    daily: {},
    factIn: factGap(rand),
    clean: -1,
    told: [],
    weights: {},
    topic: '',
  };
}

/** Между фактами, секунды чистого времени. */
export function factGap(rand: () => number): number {
  return FACT_RANGE[0] + rand() * (FACT_RANGE[1] - FACT_RANGE[0]);
}

/** Между репликами: случайно в пределах уровня, растянуто отмахиваниями. Молчуну — никогда. */
export function interval(level: Chatter, shooed: number, rand: () => number): number {
  const r = RANGES[level];
  if (!r) return Infinity;
  return (r[0] + rand() * (r[1] - r[0])) * Math.min(1 + shooed * SHOO_STRETCH, SHOO_MAX);
}

/** Рабочее время — догадка, пока человек не сказал сам: будни с 9 до 18. */
export function isWork(d: Date): boolean {
  const day = d.getDay();
  return day >= 1 && day <= 5 && d.getHours() >= 9 && d.getHours() < 18;
}

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** «2 ч 15 мин», «40 мин», «3 ч»; по-английски — «2 h 15 min». */
export function duration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const [hh, mm] = pick({ ru: ['ч', 'мин'], en: ['h', 'min'] });
  if (!h) return `${m} ${mm}`;
  return m ? `${h} ${hh} ${m} ${mm}` : `${h} ${hh}`;
}

function fill(text: string, m: Moment): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return text
    .replace('{time}', `${m.now.getHours()}:${p(m.now.getMinutes())}`)
    .replace('{session}', duration(m.session))
    .replace('{today}', duration(m.today))
    .replace('{name}', m.name ?? '');
}

/** Реплики с именем — только если питомца назвали. */
function named(list: readonly string[], m: Moment): readonly string[] {
  return m.name ? list : list.filter((t) => !t.includes('{name}'));
}

/** Случайная из списка, но не та же, что в прошлый раз. */
function any(list: readonly string[], last: string, rand: () => number): string {
  const pool = list.length > 1 ? list.filter((t) => t !== last) : list;
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

/** Событие дня, если оно уместно сейчас и сегодня ещё не звучало. */
function daily(t: Talk, d: Date): Line | null {
  const today = dayKey(d);
  const h = d.getHours();
  const due = (key: string) => t.daily[key] !== today;
  const l = pick(LINES);
  if (h >= 5 && h < 11 && due('morning')) return { key: 'morning', text: l.morning };
  if (h < 4 && due('night')) return { key: 'night', text: l.night };
  if (d.getDay() === 5 && h >= 18 && due('friday')) return { key: 'friday', text: l.friday };
  return null;
}

/** Все факты темы: свежие из сети — первыми. */
function factsOf(topic: Topic, m: Moment): readonly string[] {
  const extra = m.extra?.[topic] ?? [];
  const own = pick(FACTS)[topic];
  return extra.length ? [...extra, ...own] : own;
}

/**
 * Факт, если ему пора: тема — по весам из того, что уместно сейчас, факт — ещё не сказанный.
 * Вместе с репликой — новый список сказанного: по теме всё сказано — тема идёт по второму кругу.
 */
function fact(t: Talk, m: Moment, rand: () => number): [Line, string[]] | null {
  const work = isWork(m.now);
  if (t.factIn > (work ? -FACT_WORK_EXTRA : 0)) return null;
  const topics = m.topics.filter((x) => (!work || WORK_TOPICS.includes(x)) && factsOf(x, m).length);
  if (!topics.length) return null;
  const weight = (x: Topic) => t.weights[x] ?? 1;
  let r = rand() * topics.reduce((sum, x) => sum + weight(x), 0);
  const topic = topics.find((x) => (r -= weight(x)) < 0) ?? topics[topics.length - 1];
  const all = factsOf(topic, m);
  // свежие из сети — первыми, пока есть несказанные; дальше встроенные вперемешку
  const untold = all.filter((x) => !t.told.includes(x));
  const extra = untold.filter((x) => m.extra?.[topic]?.includes(x));
  const text = extra.length ? extra[0] : any(untold.length ? untold : all, t.last, rand);
  const told = untold.length ? t.told : t.told.filter((x) => !all.includes(x));
  return [{ key: `fact:${topic}`, text }, [...told, text].slice(-TOLD_MAX)];
}

/** Вес темы после «погладили» или «отмахнулись» — в пределах. */
function weigh(w: Record<string, number>, topic: string, k: number): Record<string, number> {
  return { ...w, [topic]: Math.min(Math.max((w[topic] ?? 1) * k, WEIGHT_MIN), WEIGHT_MAX) };
}

/**
 * Сказать ли что-то сейчас. Возвращает новое состояние и реплику (null — молчим).
 * Голод — по делу, его скажет и молчун. Забота и похвала — как только пора, но не чаще GAP_MS.
 * Остальное — когда подошёл случайный срок; срок подошёл, а человек занят — ждёт паузы.
 */
export function say(talk: Talk, m: Moment, level: Chatter, rand: () => number): [Talk, Line | null] {
  const now = m.now.getTime();
  let t = talk;
  if (m.session < t.session) t = { ...t, inSession: [] };
  if (m.session !== t.session) t = { ...t, session: m.session };
  if (!m.hungry && t.hungryAt) t = { ...t, hungryAt: 0 };
  if (m.today !== t.clean) {
    // «сегодня» стало меньше — наступил новый день, и всё его время — новое
    const gone = t.clean < 0 ? 0 : m.today > t.clean ? m.today - t.clean : m.today;
    t = { ...t, clean: m.today, factIn: Math.max(t.factIn - gone, -FACT_WORK_EXTRA) };
  }
  if (!m.pause || !m.free || now - t.spoke < GAP_MS) return [t, null];

  let line: Line | null = null;
  let told: string[] | null = null;
  const l = pick(LINES);
  if (m.hungry && now - t.hungryAt >= HUNGRY_EVERY_MS) {
    line = { key: 'hungry', text: any(l.hungry, t.last, rand) };
  } else if (level !== 'quiet') {
    const once = (key: string) => !t.inSession.includes(key);
    if (m.session >= CARE_SECS && once('care')) line = { key: 'care', text: l.care };
    else if (m.session >= PRAISE_SECS && isWork(m.now) && once('praise')) line = { key: 'praise', text: l.praise };
    else if (now >= t.next) {
      line = daily(t, m.now);
      const f = line ? null : fact(t, m, rand);
      if (f) [line, told] = f;
      if (!line && m.today >= 3600 && rand() < 0.2) line = { key: 'today', text: l.today };
      line ??= { key: isWork(m.now) ? 'work' : 'rest', text: any(named(isWork(m.now) ? l.work : l.rest, m), t.last, rand) };
    }
  }
  if (!line) return [t, null];

  const text = fill(line.text, m);
  t = { ...t, spoke: now, last: line.text, next: now + interval(level, t.shooed, rand), topic: '' };
  if (told) t = { ...t, told, factIn: factGap(rand), topic: line.key.slice('fact:'.length) };
  if (line.key === 'hungry') t.hungryAt = now;
  if (line.key === 'care' || line.key === 'praise') t.inSession = [...t.inSession, line.key];
  if (line.key === 'morning' || line.key === 'night' || line.key === 'friday') t.daily = { ...t.daily, [line.key]: dayKey(m.now) };
  return [t, { key: line.key, text }];
}

/** Сколько висит облачко: успеть прочитать, но не застревать. */
export function shownFor(text: string): number {
  return Math.min(Math.max(3000 + text.length * 70, 4000), 9000);
}

/**
 * Облачко смахнули кликом: следующая реплика — позже, и с каждым разом подряд ещё позже.
 * Смахнули факт — его тема звучит реже.
 */
export function shoo(t: Talk, level: Chatter, rand: () => number): Talk {
  const shooed = t.shooed + 1;
  const s = { ...t, shooed, next: t.spoke + interval(level, shooed, rand) };
  return t.topic ? { ...s, topic: '', weights: weigh(t.weights, t.topic, WEIGHT_DOWN) } : s;
}

/** Погладили вскоре после облачка — болтать можно снова как обычно; после факта — «ещё такого». */
export function liked(t: Talk, now: number): Talk {
  if (!t.spoke || now - t.spoke > LIKED_MS) return t;
  const s = t.shooed ? { ...t, shooed: 0 } : t;
  // одна реплика — одна прибавка, сколько ни гладь
  return t.topic ? { ...s, topic: '', weights: weigh(t.weights, t.topic, WEIGHT_UP) } : s;
}

/**
 * Лайк или диз на новость в облачке: тема звучит чаще или реже. Это не «отмахнулись» — болтать
 * реже кошка не станет, а лайк, как и поглаживание, прощает прошлые отмашки.
 */
export function vote(t: Talk, topic: string, up: boolean): Talk {
  const s = up && t.shooed ? { ...t, shooed: 0 } : t;
  return { ...s, topic: '', weights: weigh(t.weights, topic, up ? WEIGHT_UP : WEIGHT_DOWN) };
}

/** Уровень сменили в настройках — срок пересчитываем от последней реплики (или от сейчас). */
export function retime(t: Talk, level: Chatter, now: number, rand: () => number): Talk {
  return { ...t, next: (t.spoke || now) + interval(level, t.shooed, rand) };
}

/**
 * На диск — только то, что должно пережить перезапуск: отмахивания, сказанное сегодня,
 * срок факта, сказанные факты и веса тем.
 */
export function save(t: Talk): string {
  return JSON.stringify({ shooed: t.shooed, last: t.last, daily: t.daily, factIn: t.factIn, told: t.told, weights: t.weights });
}

/** Старые сохранения — без полей фактов: тогда срок факта новый, сказанного нет, веса ровные. */
export function load(raw: string | null, now: number, level: Chatter, rand: () => number): Talk {
  const t = fresh(now, level, rand);
  try {
    const s = JSON.parse(raw ?? '{}');
    const shooed = Number.isInteger(s.shooed) && s.shooed > 0 ? Math.min(s.shooed, 10) : 0;
    const daily: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.daily ?? {})) if (typeof v === 'string') daily[k] = v;
    const factIn =
      typeof s.factIn === 'number' && Number.isFinite(s.factIn) ? Math.min(Math.max(s.factIn, -FACT_WORK_EXTRA), FACT_RANGE[1]) : t.factIn;
    const told = Array.isArray(s.told) ? s.told.filter((x: unknown) => typeof x === 'string').slice(-TOLD_MAX) : [];
    const weights: Record<string, number> = {};
    for (const [k, v] of Object.entries(s.weights ?? {}))
      if (typeof v === 'number' && Number.isFinite(v)) weights[k] = Math.min(Math.max(v, WEIGHT_MIN), WEIGHT_MAX);
    return {
      ...t,
      shooed,
      last: typeof s.last === 'string' ? s.last : '',
      daily,
      factIn,
      told,
      weights,
      next: now + interval(level, shooed, rand),
    };
  } catch {
    return t;
  }
}
