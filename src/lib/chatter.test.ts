import { describe, expect, it } from 'vitest';
import {
  CARE_SECS,
  duration,
  FACT_RANGE,
  FACT_WORK_EXTRA,
  factGap,
  fresh,
  GAP_MS,
  HUNGRY_EVERY_MS,
  interval,
  isWork,
  liked,
  load,
  type Moment,
  PRAISE_SECS,
  RANGES,
  retime,
  save,
  say,
  shoo,
  shownFor,
  type Talk,
  vote,
} from './chatter';
import { FACTS } from './facts';
import { setLang } from './i18n';
import { TOPICS } from './settings';

const MIN = 60_000;
/** Суббота, 7 ноября 2026, 14:00 — отдых, ни утро, ни ночь, ни пятница. */
const SAT = new Date(2026, 10, 7, 14, 0);
/** Вторник, 3 ноября 2026, 11:00 — рабочее время. */
const TUE = new Date(2026, 10, 3, 11, 0);
const mid = () => 0.5;

function at(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

function moment(now: Date, over: Partial<Moment> = {}): Moment {
  return { now, pause: true, session: 10 * 60, today: 30 * 60, hungry: false, free: true, topics: [], ...over };
}

/** Состояние, в котором случайная реплика уже подошла. */
function due(now: Date): Talk {
  return { ...fresh(now.getTime(), 'sometimes', mid), next: now.getTime() };
}

describe('interval', () => {
  it('stays within the level range', () => {
    const [lo, hi] = RANGES.sometimes!;
    expect(interval('sometimes', 0, () => 0)).toBe(lo);
    expect(interval('sometimes', 0, () => 0.999999)).toBeCloseTo(hi, -2);
    expect(interval('often', 0, () => 0)).toBeLessThan(lo);
  });

  it('never comes for the quiet one', () => {
    expect(interval('quiet', 0, mid)).toBe(Infinity);
  });

  it('stretches with each shoo, at most three times', () => {
    const base = interval('sometimes', 0, mid);
    expect(interval('sometimes', 2, mid)).toBe(base * 2);
    expect(interval('sometimes', 10, mid)).toBe(base * 3);
  });
});

describe('say', () => {
  it('waits for the random moment', () => {
    const t = fresh(SAT.getTime(), 'sometimes', mid);
    expect(say(t, moment(at(SAT, 5 * MIN)), 'sometimes', mid)[1]).toBeNull();
    const [, line] = say(t, moment(at(SAT, 25 * MIN)), 'sometimes', mid);
    expect(line?.key).toBe('rest');
  });

  it('does not interrupt: away, typing, fullscreen or a busy cat', () => {
    const t = due(SAT);
    expect(say(t, moment(SAT, { pause: false }), 'sometimes', mid)[1]).toBeNull();
    expect(say(t, moment(SAT, { free: false }), 'sometimes', mid)[1]).toBeNull();
    // срок не сгорает: дождалась паузы — говорит
    expect(say(t, moment(at(SAT, 10 * MIN)), 'sometimes', mid)[1]).not.toBeNull();
  });

  it('keeps work and rest apart', () => {
    const work = ['Ты молодец.', 'Я тут, рядом.', 'Хорошо работаем.', 'Я тихонько посижу.'];
    for (let i = 0; i < 20; i++) {
      const r = () => i / 20;
      const [, line] = say(due(TUE), moment(TUE, { today: 0 }), 'sometimes', r);
      expect(line?.key).toBe('work');
      expect(work).toContain(line?.text);
      const [, rest] = say(due(SAT), moment(SAT, { today: 0 }), 'sometimes', r);
      expect(work).not.toContain(rest?.text);
    }
  });

  it('по имени зовёт себя, только если её назвали', () => {
    const texts = (name?: string) =>
      Array.from({ length: 40 }, (_, i) => say(due(SAT), moment(SAT, { today: 0, name }), 'sometimes', () => i / 40)[1]?.text);
    expect(texts().some((t) => t?.includes('{name}') || t?.includes('Это я'))).toBe(false);
    expect(texts('Мурка')).toContain('Это я, Мурка.');
  });

  it('does not repeat the last line', () => {
    let t = due(SAT);
    let prev = '';
    for (let i = 0; i < 10; i++) {
      const now = at(SAT, i * 40 * MIN);
      t = { ...t, next: now.getTime() };
      const [next, line] = say(t, moment(now, { today: 0 }), 'sometimes', () => 0);
      expect(line?.text).not.toBe(prev);
      prev = line!.text;
      t = next;
    }
  });

  it('the quiet one speaks only about hunger', () => {
    const t = { ...fresh(SAT.getTime(), 'quiet', mid), next: 0 };
    expect(say(t, moment(at(SAT, 5 * 3600_000), { session: CARE_SECS * 2 }), 'quiet', mid)[1]).toBeNull();
    expect(say(t, moment(SAT, { hungry: true }), 'quiet', mid)[1]?.key).toBe('hungry');
  });

  it('reminds about hunger once in a while, a new hunger right away', () => {
    let [t, line] = say(fresh(SAT.getTime(), 'sometimes', mid), moment(SAT, { hungry: true }), 'sometimes', mid);
    expect(line?.key).toBe('hungry');
    [t, line] = say(t, moment(at(SAT, GAP_MS), { hungry: true }), 'sometimes', mid);
    expect(line).toBeNull();
    [, line] = say(t, moment(at(SAT, HUNGRY_EVERY_MS), { hungry: true }), 'sometimes', mid);
    expect(line?.key).toBe('hungry');
    // поела и снова проголодалась — скажет, не дожидаясь HUNGRY_EVERY_MS
    [t] = say(t, moment(at(SAT, GAP_MS)), 'sometimes', mid);
    [, line] = say(t, moment(at(SAT, 2 * GAP_MS), { hungry: true }), 'sometimes', mid);
    expect(line?.key).toBe('hungry');
  });

  it('cares after 90 minutes once per session, praises at work after two hours', () => {
    let t = fresh(TUE.getTime(), 'sometimes', mid);
    let line;
    [t, line] = say(t, moment(TUE, { session: CARE_SECS }), 'sometimes', mid);
    expect(line).toEqual({ key: 'care', text: 'Уже 1 ч 30 мин без перерыва. Потянемся?' });
    [t, line] = say(t, moment(at(TUE, GAP_MS), { session: CARE_SECS + 180 }), 'sometimes', mid);
    expect(line).toBeNull();
    [t, line] = say(t, moment(at(TUE, 30 * MIN), { session: PRAISE_SECS }), 'sometimes', mid);
    expect(line).toEqual({ key: 'praise', text: '2 ч в фокусе. Ты молодец.' });
    // отошёл, сессия началась заново — через 90 минут забота снова
    [t] = say(t, moment(at(TUE, 40 * MIN), { session: 0 }), 'sometimes', mid);
    [, line] = say(t, moment(at(TUE, 130 * MIN), { session: CARE_SECS }), 'sometimes', mid);
    expect(line?.key).toBe('care');
  });

  it('does not praise on a weekend', () => {
    const t = { ...fresh(SAT.getTime(), 'sometimes', mid), inSession: ['care'] };
    expect(say(t, moment(SAT, { session: PRAISE_SECS }), 'sometimes', mid)[1]).toBeNull();
  });

  it('greets in the morning once a day', () => {
    const morning = new Date(2026, 10, 7, 8, 30);
    let [t, line] = say(due(morning), moment(morning), 'sometimes', mid);
    expect(line?.key).toBe('morning');
    t = { ...t, next: 0 };
    [, line] = say(t, moment(at(morning, 60 * MIN)), 'sometimes', mid);
    expect(line?.key).not.toBe('morning');
    // назавтра — снова
    [, line] = say(t, moment(at(morning, 24 * 60 * MIN)), 'sometimes', mid);
    expect(line?.key).toBe('morning');
  });

  it('fills the time at night and the friday party', () => {
    const night = new Date(2026, 10, 7, 1, 5);
    expect(say(due(night), moment(night), 'sometimes', mid)[1]).toEqual({ key: 'night', text: 'Уже 1:05. Может, спать?' });
    const friday = new Date(2026, 10, 6, 19, 0);
    expect(say(due(friday), moment(friday), 'sometimes', mid)[1]?.key).toBe('friday');
  });

  it('tells today stats sometimes', () => {
    const [, line] = say(due(SAT), moment(SAT, { today: 3 * 3600 + 15 * 60 }), 'sometimes', () => 0);
    expect(line).toEqual({ key: 'today', text: 'Сегодня мы за компом уже 3 ч 15 мин.' });
  });

  it('keeps a gap after any bubble', () => {
    const [t] = say(due(SAT), moment(SAT), 'sometimes', mid);
    expect(say({ ...t, next: 0 }, moment(at(SAT, GAP_MS - 1), { session: CARE_SECS }), 'sometimes', mid)[1]).toBeNull();
  });
});

describe('shoo and like', () => {
  it('a shoo pushes the next line further', () => {
    const [t] = say(due(SAT), moment(SAT), 'sometimes', mid);
    const s = shoo(t, 'sometimes', mid);
    expect(s.shooed).toBe(1);
    expect(s.next).toBeGreaterThan(t.next);
  });

  it('petting soon after a bubble forgives the shoos', () => {
    const [t] = say(due(SAT), moment(SAT), 'sometimes', mid);
    const s = { ...t, shooed: 3 };
    expect(liked(s, SAT.getTime() + 30_000).shooed).toBe(0);
    expect(liked(s, SAT.getTime() + 5 * MIN).shooed).toBe(3);
  });

  it('a vote on news moves its topic weight but not the talking pace', () => {
    const [t] = say(due(SAT), moment(SAT), 'sometimes', mid);
    const s = { ...t, shooed: 2, topic: 'кино' };
    const up = vote(s, 'космос', true);
    expect(up.weights.космос).toBe(1.5);
    expect(up.shooed).toBe(0);
    expect(up.topic).toBe('');
    const down = vote(s, 'космос', false);
    expect(down.weights.космос).toBe(0.5);
    expect(down.shooed).toBe(2);
    expect(down.next).toBe(s.next);
    let w = s;
    for (let i = 0; i < 10; i++) w = vote(w, 'космос', false);
    expect(w.weights.космос).toBeGreaterThan(0);
  });

  it('retime moves the quiet one back into talking', () => {
    const t = fresh(SAT.getTime(), 'quiet', mid);
    expect(t.next).toBe(Infinity);
    expect(retime(t, 'sometimes', SAT.getTime(), mid).next).toBe(SAT.getTime() + interval('sometimes', 0, mid));
  });
});

/** Факт уже пора сказать: и срок фактов прошёл, и случайная реплика подошла. */
function ripe(now: Date, over: Partial<Talk> = {}): Talk {
  return { ...due(now), factIn: 0, ...over };
}

/** Повторяемая «случайность»: разные значения, но тест каждый раз один и тот же. */
function seq(seed = 1): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

describe('facts', () => {
  it('no topics — no facts, everything as before', () => {
    const [, line] = say(ripe(SAT, { factIn: -FACT_WORK_EXTRA }), moment(SAT, { today: 0 }), 'sometimes', mid);
    expect(line?.key).toBe('rest');
  });

  it('a fact is one of the usual random lines, about a chosen topic', () => {
    expect(say(ripe(SAT, { next: SAT.getTime() + MIN }), moment(SAT, { topics: ['космос'] }), 'sometimes', mid)[1]).toBeNull();
    const [t, line] = say(ripe(SAT), moment(SAT, { topics: ['космос'] }), 'sometimes', mid);
    expect(line?.key).toBe('fact:космос');
    expect(FACTS.ru.космос).toContain(line?.text);
    expect(t.factIn).toBe(factGap(mid));
    expect(t.topic).toBe('космос');
  });

  it('waits at least an hour of clean time after the last fact', () => {
    const r = () => 0; // самый короткий срок — ровно час
    let [t, line] = say(ripe(SAT), moment(SAT, { today: 0, topics: ['кино'] }), 'sometimes', r);
    expect(line?.key).toBe('fact:кино');
    expect(t.factIn).toBe(FACT_RANGE[0]);
    // пять часов на часах, но за компом — без секунды час: факта нет
    let now = at(SAT, 5 * 60 * MIN);
    [t, line] = say({ ...t, next: now.getTime() }, moment(now, { today: 3599, topics: ['кино'] }), 'sometimes', r);
    expect(line?.key).not.toMatch(/^fact:/);
    now = at(now, GAP_MS);
    [, line] = say({ ...t, next: now.getTime() }, moment(now, { today: 3600, topics: ['кино'] }), 'sometimes', r);
    expect(line?.key).toBe('fact:кино');
  });

  it('counts a new day from zero', () => {
    let [t] = say(fresh(SAT.getTime(), 'sometimes', mid), moment(SAT, { pause: false, today: 20_000 }), 'sometimes', mid);
    const before = t.factIn;
    [t] = say(t, moment(at(SAT, 12 * 60 * MIN), { pause: false, today: 100 }), 'sometimes', mid);
    expect(t.factIn).toBe(before - 100);
  });

  it('keeps rest topics out of work hours, work topics come rarely', () => {
    const topics = ['кино', 'техника'] as const;
    // срок у отдыха прошёл — в работе этого мало
    expect(say(ripe(TUE), moment(TUE, { today: 0, topics }), 'sometimes', mid)[1]?.key).toBe('work');
    for (let i = 0; i < 20; i++) {
      const [, line] = say(ripe(TUE, { factIn: -FACT_WORK_EXTRA }), moment(TUE, { today: 0, topics }), 'sometimes', () => i / 20);
      expect(line?.key).toBe('fact:техника');
    }
    // только темы отдыха — в работе фактов нет совсем
    const [, line] = say(ripe(TUE, { factIn: -FACT_WORK_EXTRA }), moment(TUE, { today: 0, topics: ['кино'] }), 'sometimes', mid);
    expect(line?.key).toBe('work');
    // а в выходной — и кино
    const keys = new Set(
      Array.from({ length: 20 }, (_, i) => say(ripe(SAT), moment(SAT, { today: 0, topics }), 'sometimes', () => i / 20)[1]?.key),
    );
    expect(keys).toEqual(new Set(['fact:кино', 'fact:техника']));
  });

  it('does not repeat a fact until the topic runs out', () => {
    const all = FACTS.ru.теннис;
    const rand = seq();
    let t = ripe(SAT);
    const said: string[] = [];
    for (let i = 0; i < all.length + 1; i++) {
      const now = at(SAT, i * 10 * MIN);
      const [next, line] = say({ ...t, next: now.getTime(), factIn: 0 }, moment(now, { today: 0, topics: ['теннис'] }), 'sometimes', rand);
      expect(line?.key).toBe('fact:теннис');
      said.push(line!.text);
      t = next;
    }
    expect(new Set(said.slice(0, all.length)).size).toBe(all.length);
    // второй круг: сказанное по теме забыто, но подряд то же самое — нет
    expect(said[all.length]).not.toBe(said[all.length - 1]);
    expect(t.told).toEqual([said[all.length]]);
  });

  it('fresh facts of the day go first', () => {
    const extra = { космос: ['Сегодня в 1957 году… (Википедия, CC BY-SA)'] };
    const [t, line] = say(ripe(SAT), moment(SAT, { topics: ['космос'], extra }), 'sometimes', mid);
    expect(line?.text).toBe(extra.космос[0]);
    const [, again] = say({ ...t, next: 0, factIn: 0 }, moment(at(SAT, GAP_MS), { topics: ['космос'], extra }), 'sometimes', mid);
    expect(FACTS.ru.космос).toContain(again?.text);
  });

  it('petting after a fact asks for more of it, a shoo for less', () => {
    const [t] = say(ripe(SAT), moment(SAT, { topics: ['кино'] }), 'sometimes', mid);
    const soon = SAT.getTime() + 30_000;
    const l = liked(t, soon);
    expect(l.weights.кино).toBe(1.5);
    expect(liked(l, soon).weights.кино).toBe(1.5); // одна реплика — одна прибавка
    expect(liked(t, SAT.getTime() + 5 * MIN).weights.кино).toBeUndefined();
    expect(shoo(t, 'sometimes', mid).weights.кино).toBe(0.5);
    // смахнули не факт — вес темы не трогаем
    const [plain] = say(due(SAT), moment(SAT), 'sometimes', mid);
    expect(shoo({ ...plain, weights: { кино: 2 } }, 'sometimes', mid).weights).toEqual({ кино: 2 });
  });

  it('weights tip the choice of topic, within bounds', () => {
    const topics = ['кино', 'космос'] as const;
    const pick = (weights: Record<string, number>) => say(ripe(SAT, { weights }), moment(SAT, { topics }), 'sometimes', mid)[1]?.key;
    expect(pick({})).toBe('fact:космос');
    expect(pick({ кино: 4 })).toBe('fact:кино');
    let t = ripe(SAT);
    for (let i = 0; i < 10; i++) t = shoo({ ...t, topic: 'кино' }, 'sometimes', mid);
    expect(t.weights.кино).toBe(0.25);
    for (let i = 0; i < 20; i++) t = liked({ ...t, topic: 'кино', spoke: SAT.getTime() }, SAT.getTime());
    expect(t.weights.кино).toBe(4);
  });

  it('every topic has a few short facts in both languages', () => {
    for (const lang of ['ru', 'en'] as const)
      for (const topic of TOPICS) {
        const list = FACTS[lang][topic];
        expect(list.length, `${lang} ${topic}`).toBeGreaterThanOrEqual(6);
        expect(new Set(list).size, `${lang} ${topic}`).toBe(list.length);
        for (const f of list) expect(f.length, f).toBeLessThanOrEqual(90);
      }
  });

  it('speaks English when asked', () => {
    setLang('en');
    try {
      expect(duration(2 * 3600 + 5 * 60)).toBe('2 h 5 min');
      const [, line] = say(due(TUE), moment(TUE, { today: 0 }), 'sometimes', mid);
      expect(line?.text).toMatch(/^[\x20-\x7e…]+$/);
    } finally {
      setLang('ru');
    }
  });
});

describe('helpers', () => {
  it('guesses work hours', () => {
    expect(isWork(TUE)).toBe(true);
    expect(isWork(SAT)).toBe(false);
    expect(isWork(new Date(2026, 10, 3, 19, 0))).toBe(false);
  });

  it('formats durations', () => {
    expect(duration(40 * 60)).toBe('40 мин');
    expect(duration(3 * 3600)).toBe('3 ч');
    expect(duration(2 * 3600 + 5 * 60 + 59)).toBe('2 ч 5 мин');
  });

  it('shows a bubble long enough to read, not forever', () => {
    expect(shownFor('Мур.')).toBe(4000);
    expect(shownFor('x'.repeat(500))).toBe(9000);
  });
});

describe('save and load', () => {
  it('keeps shoos and what was said today', () => {
    const t: Talk = { ...fresh(0, 'sometimes', mid), shooed: 2, last: 'Мур.', daily: { morning: '2026-11-07' } };
    const back = load(save(t), SAT.getTime(), 'sometimes', mid);
    expect(back.shooed).toBe(2);
    expect(back.last).toBe('Мур.');
    expect(back.daily).toEqual({ morning: '2026-11-07' });
    expect(back.next).toBe(SAT.getTime() + interval('sometimes', 2, mid));
  });

  it('survives garbage', () => {
    for (const raw of [null, '', '{', '{"shooed":-4,"daily":{"a":1}}', '[]']) {
      const t = load(raw, 0, 'sometimes', mid);
      expect(t.shooed).toBe(0);
      expect(t.daily).toEqual({});
    }
  });
});
