// «Охотник»: по экрану бегает нарисованная мышь, кошка за ней гонится. Мышь никогда не ловят.
// Мышь ходит тем же движком, что и кошка (roam.ts), только быстрее: пол, кромки окон, на весь
// экран ещё и рамки внутри окон (полки, `arena`). Куда дальше — каждый раз случайно: на пол, на
// кромку, за край экрана; на бегу иногда резко разворачивается, и кошку, бегущую следом, заносит.
// Кошка подкралась или припала — мышь бросает передышку и удирает в сторону от неё.
// Погоня длится от CHASE_MIN до CHASE_MAX, потом финал: мышь уходит за край. Либо кошка остаётся
// ни с чем ('escape'), либо бежит за ней, пропадает за тем же краем и возвращается облизываясь
// ('together'): тогда приходит событие 'lick'.
// Чистые функции: без DOM и часов, `now` и `rand` — параметрами. Приложение зовёт `tick` вместо
// `roam.step`, пока погоня не 'done'.

import {
  behind,
  chase,
  endChase,
  enter,
  exits,
  goTo,
  leaveBy,
  monitorOf,
  RUN,
  side,
  SIDE,
  spawn,
  step,
  surfaces,
  type ChaseEvent,
  type Exit,
  type Ledge,
  type Pet,
  type RoamEvent,
  type Surface,
  type World,
} from './roam';
import type { HunterArea } from './settings';

/** Кошачья погоня отключена для Пенни; настройки и общее окно клубка сохранены. */
export const ENABLED = false;

/** Скорость мыши, логич. px/с: быстрее бегущей кошки (RUN). */
export const MOUSE_RUN = 150;
/** Погоня длится от CHASE_MIN до CHASE_MAX мс. */
export const CHASE_MIN = 2 * 60_000;
export const CHASE_MAX = 4 * 60_000;
/** Добежав, мышь переводит дух от REST_MIN до REST_MAX мс... */
export const REST_MIN = 400;
export const REST_MAX = 2500;
/** ...а с такой вероятностью сразу бежит дальше. */
export const NO_REST = 0.25;
/** За краем экрана сидит от HIDE_MIN до HIDE_MAX мс... */
export const HIDE_MIN = 2000;
export const HIDE_MAX = 6000;
/** ...и с такой вероятностью выходит оттуда же, откуда ушла. */
export const SAME_DOOR = 0.4;
/** Кошка ближе стольких сторон спрайта — мышь бросает передышку и удирает. */
export const SCARE = 1;
/** На бегу каждые ZIG_MIN..ZIG_MAX сторон пути — шанс TURN резко развернуться... */
export const ZIG_MIN = 1;
export const ZIG_MAX = 4;
export const TURN = 0.5;
/** ...и пробежать назад TURN_MIN..TURN_MAX сторон. */
export const TURN_MIN = 1.5;
export const TURN_MAX = 4;
/** Веса выбора следующей цели: пол, кромка (в окне или на окне), за край. */
export const W_FLOOR = 1;
export const W_LEDGE = 3;
export const W_EXIT = 0.6;
/** Кошка за краем после финала вместе — от AWAY_MIN до AWAY_MAX мс. */
export const AWAY_MIN = 4000;
export const AWAY_MAX = 8000;
/** Кошка не дошла до края или обратно за столько мс — финал без неё. */
export const GIVE_UP = 20_000;

/**
 * hunt — погоня; finale — мышь уходит за край насовсем; follow — кошка бежит за ней за край;
 * away — кошка за краем; return — возвращается; bolt — погоню прервали, мышь уходит, кошкой
 * правит приложение; done — всё.
 */
export type Phase = 'hunt' | 'finale' | 'follow' | 'away' | 'return' | 'bolt' | 'done';
export type End = 'escape' | 'together';
export interface Chase {
  mouse: Pet;
  phase: Phase;
  end: End;
  /** Когда начать финал, мс. */
  until: number;
  /** Мышь стоит до этого момента, мс. */
  rest: number;
  /** Физ. px пути до следующего шанса развернуться. */
  zig: number;
  /** Край, за которым сидит мышь (а в финале — за который ушла). */
  door: Exit | null;
  /** hunt — когда мыши выйти из-за края; follow, return — срок кошке; away — когда ей вернуться. */
  back: number;
}
/** lick — кошка вернулась из-за края облизываясь; done — погоня кончилась (без облизывания). */
export type HuntEvent = ChaseEvent | RoamEvent | 'lick' | 'done';

/** Что рисовать в окне мыши: лапы в (x, y) физ. px, бежит или сидит, куда смотрит. */
export interface MouseView {
  x: number;
  y: number;
  anim: 'run' | 'sit';
  facing: 1 | -1;
}

/** Мир погони: у панели задач — только полы; на весь экран — ещё полки внутри окон. Полос заголовков нет. */
export function arena(world: World, area: HunterArea, shelves: Ledge[] = []): World {
  return area === 'screen'
    ? { ...world, ledges: [...world.ledges, ...shelves], strips: [] }
    : { ...world, ledges: [], strips: [] };
}

const roll = (rand: () => number): number => Math.min(Math.max(rand() || 0, 0), 0.999999);
const between = (rand: () => number, lo: number, hi: number): number => lo + roll(rand) * (hi - lo);
const any = <T>(rand: () => number, xs: T[]): T => xs[Math.floor(roll(rand) * xs.length)];
const sideAt = (world: World, p: Pet): number => {
  const m = monitorOf(world, p);
  return m ? side(m) : SIDE;
};
const zigLen = (world: World, p: Pet, rand: () => number): number => between(rand, ZIG_MIN, ZIG_MAX) * sideAt(world, p);

/** Мышь выходит из-за случайного края; финал — случайный, длительность — от CHASE_MIN до CHASE_MAX. */
export function start(world: World, now: number, rand: () => number): Chase {
  const doors = exits(world);
  const base = spawn(world);
  const mouse = doors.length ? enter(behind(world, any(rand, doors), base), world) : base;
  return {
    mouse,
    phase: 'hunt',
    end: roll(rand) < 0.5 ? 'escape' : 'together',
    until: now + between(rand, CHASE_MIN, CHASE_MAX),
    rest: now,
    zig: zigLen(world, mouse, rand),
    door: null,
    back: now,
  };
}

/** Куда бежать: точка на поверхности или за край. */
type Dest = { surface: Surface; x: number } | { exit: Exit };

/** Точка на s, где мышь помещается целиком; на той же поверхности — не ближе стороны спрайта. */
function spotOn(world: World, s: Surface, m: Pet, rand: () => number): Dest {
  const sd = side(world.monitors[s.monitor]);
  const lo = s.left + sd / 2;
  const hi = s.right - sd / 2;
  if (lo >= hi) return { surface: s, x: (s.left + s.right) / 2 };
  let x = between(rand, lo, hi);
  for (let i = 0; i < 4 && s.id === m.on && Math.abs(x - m.x) < sd; i++) x = between(rand, lo, hi);
  return { surface: s, x };
}

/** Случайная цель по весам W_*. */
function pick(world: World, m: Pet, rand: () => number): Dest {
  const all = surfaces(world).filter((s) => !s.strip);
  const floors = all.filter((s) => s.kind === 'floor');
  const ledges = all.filter((s) => s.kind === 'ledge');
  const doors = exits(world);
  const w = [floors.length ? W_FLOOR : 0, ledges.length ? W_LEDGE : 0, doors.length ? W_EXIT : 0];
  let r = roll(rand) * (w[0] + w[1] + w[2]);
  if (r < w[0]) return spotOn(world, any(rand, floors), m, rand);
  r -= w[0];
  if (r < w[1]) return spotOn(world, any(rand, ledges), m, rand);
  return { exit: any(rand, doors) };
}

/** Куда цель ведёт мышь: точка лап (у края — сразу за ним). */
function destAt(world: World, d: Dest): { x: number; y: number } {
  if ('surface' in d) return { x: d.x, y: d.surface.y };
  const mon = world.monitors[d.exit.monitor];
  return { x: d.exit.dir > 0 ? mon.work.right : mon.work.left, y: mon.work.bottom };
}

/** Цель уводит от кошки: дальше от неё, чем мышь сейчас, и не мимо неё по тому же уровню. */
function away(world: World, d: Dest, m: Pet, cat: Pet): boolean {
  const p = destAt(world, d);
  const sd = sideAt(world, m);
  const past = Math.sign(p.x - m.x) === Math.sign(cat.x - m.x) && Math.abs(p.y - m.y) < sd / 2;
  return !past && Math.hypot(p.x - cat.x, p.y - cat.y) > Math.hypot(m.x - cat.x, m.y - cat.y);
}

/** Край, за который уйти от кошки: на мониторе мыши в сторону от кошки, если он внешний. */
function doorFrom(world: World, m: Pet, cat: Pet, rand: () => number): Exit | null {
  const doors = exits(world);
  if (!doors.length) return null;
  const mon = monitorOf(world, m);
  const i = mon ? world.monitors.indexOf(mon) : -1;
  const dir = m.x >= cat.x ? 1 : -1;
  return doors.find((e) => e.monitor === i && e.dir === dir) ?? doors.find((e) => e.monitor === i) ?? any(rand, doors);
}

/** Новая цель мыши; flee — удирать от кошки. */
function go(c: Chase, world: World, cat: Pet, rand: () => number, flee: boolean): Chase {
  const m = c.mouse;
  let d: Dest = pick(world, m, rand);
  if (flee) {
    let found = away(world, d, m, cat);
    for (let i = 0; i < 8 && !found; i++) {
      d = pick(world, m, rand);
      found = away(world, d, m, cat);
    }
    if (!found) {
      const door = doorFrom(world, m, cat, rand);
      if (door) d = { exit: door };
    }
  }
  const mouse = 'surface' in d ? goTo(m, world, { surface: d.surface.id, x: d.x }) : leaveBy(m, world, d.exit);
  return { ...c, mouse, zig: zigLen(world, mouse, rand) };
}

/** Кошка рядом или припала: стоять мыши нельзя. */
function scared(world: World, m: Pet, cat: Pet): boolean {
  if (cat.move === 'out') return false;
  return cat.hunt?.mode === 'crouch' || Math.hypot(cat.x - m.x, cat.y - m.y) < SCARE * sideAt(world, m);
}

/** Один кадр мыши. */
function mouseStep(c: Chase, world: World, cat: Pet, now: number, dt: number, rand: () => number): Chase {
  const m = c.mouse;
  if (m.move === 'out') {
    if (c.phase === 'hunt' && now >= c.back) {
      const doors = exits(world);
      const door = c.door && roll(rand) < SAME_DOOR ? c.door : doors.length ? any(rand, doors) : c.door;
      if (door) return { ...c, mouse: enter(behind(world, door, m), world), door: null, zig: zigLen(world, m, rand) };
    }
    return { ...c, mouse: step(m, world, dt)[0] };
  }
  const [p, e] = step(m, world, dt, MOUSE_RUN);
  let next: Chase = { ...c, mouse: p };
  if (e === 'gone') {
    const mon = monitorOf(world, p);
    const door: Exit = { monitor: mon ? world.monitors.indexOf(mon) : 0, dir: p.exit === -1 ? -1 : 1 };
    return { ...next, door, back: now + between(rand, HIDE_MIN, HIDE_MAX) };
  }
  if (e === 'arrived') next = { ...next, rest: now + (roll(rand) < NO_REST ? 0 : between(rand, REST_MIN, REST_MAX)) };
  if (next.phase !== 'hunt') return next;

  if (p.move === 'still') {
    const fear = scared(world, p, cat);
    return fear || now >= next.rest ? go(next, world, cat, rand, fear) : next;
  }
  // Резкий разворот на бегу по той же поверхности.
  if (p.move === 'walk' && p.goal && p.goal.surface === p.on && p.exit === 0) {
    const zig = next.zig - Math.abs(p.x - m.x);
    if (zig > 0) return { ...next, zig };
    next = { ...next, zig: zigLen(world, p, rand) };
    if (roll(rand) >= TURN) return next;
    const s = surfaces(world).find((a) => a.id === p.on);
    if (!s) return next;
    const sd = side(world.monitors[s.monitor]);
    const x = p.x - p.facing * between(rand, TURN_MIN, TURN_MAX) * sd;
    const gx = Math.min(Math.max(x, s.left + sd / 2), s.right - sd / 2);
    if (Math.abs(gx - p.x) < sd) return next;
    return { ...next, mouse: goTo(p, world, { surface: s.id, x: gx }) };
  }
  return next;
}

/** Время вышло: мышь уходит за край насовсем, подальше от кошки. */
function finale(c: Chase, world: World, cat: Pet, rand: () => number): Chase {
  const door = c.mouse.move === 'out' ? null : doorFrom(world, c.mouse, cat, rand);
  return { ...c, phase: 'finale', mouse: door ? leaveBy(c.mouse, world, door) : c.mouse };
}

/** Кошка встала там, где её застал конец, без цели и ухода за край. */
const halt = (p: Pet): Pet => ({ ...endChase(p), goal: null, exit: 0, move: p.move === 'walk' ? 'still' : p.move });

/**
 * Один кадр погони: мышь бежит, кошка гонится (roam.chase) или идёт за мышью за край.
 * world — мир погони (`arena`). Возвращает погоню, кошку и событие: события roam от кошки,
 * 'lick' — вернулась облизываясь, 'done' — кончилось без облизывания. В 'bolt' кошка не меняется.
 */
export function tick(c: Chase, world: World, cat: Pet, now: number, dt: number, rand: () => number): [Chase, Pet, HuntEvent | null] {
  if (c.phase === 'hunt' && now >= c.until) c = finale(c, world, cat, rand);
  switch (c.phase) {
    case 'hunt':
    case 'finale':
    case 'bolt': {
      c = mouseStep(c, world, cat, now, dt, rand);
      if (c.phase !== 'hunt' && c.mouse.move === 'out') {
        if (c.phase === 'bolt') return [{ ...c, phase: 'done' }, cat, null];
        if (c.end === 'escape' || !c.door) return [{ ...c, phase: 'done' }, halt(cat), 'done'];
        return [{ ...c, phase: 'follow', back: now + GIVE_UP }, leaveBy(halt(cat), world, c.door), null];
      }
      if (c.phase === 'bolt') return [c, cat, null];
      return [c, ...chase(cat, world, { x: c.mouse.x, y: c.mouse.y - 1 }, dt)];
    }
    case 'follow': {
      const [p, e] = step(cat, world, dt, RUN);
      if (e === 'gone') return [{ ...c, phase: 'away', back: now + between(rand, AWAY_MIN, AWAY_MAX) }, p, null];
      if (now >= c.back) return [{ ...c, phase: 'done' }, halt(p), 'done'];
      return [c, p, e];
    }
    case 'away':
      if (now >= c.back) return [{ ...c, phase: 'return', back: now + GIVE_UP }, enter(cat, world), null];
      return [c, step(cat, world, dt)[0], null];
    case 'return': {
      const [p, e] = step(cat, world, dt);
      if (e === 'arrived') return [{ ...c, phase: 'done' }, p, 'lick'];
      if (now >= c.back) return [{ ...c, phase: 'done' }, halt(p), 'done'];
      return [c, p, e];
    }
    case 'done':
      return [c, cat, null];
  }
}

/**
 * Погоню прервали (лазер, кошку взяли, охотника выключили): мышь уходит за край подальше от
 * кошки, кошкой дальше правит приложение. Кошка уже ушла за мышью за край — сразу 'done'.
 */
export function bolt(c: Chase, world: World, cat: Pet, rand: () => number): Chase {
  if (c.phase !== 'hunt' && c.phase !== 'finale') return c.phase === 'bolt' ? c : { ...c, phase: 'done' };
  const door = c.mouse.move === 'out' ? null : doorFrom(world, c.mouse, cat, rand);
  return { ...c, phase: 'bolt', mouse: door ? leaveBy(c.mouse, world, door) : c.mouse };
}

/** Кошкой правит погоня (а не приложение). */
export const owns = (c: Chase | null): boolean => c !== null && c.phase !== 'bolt' && c.phase !== 'done';

/** Мышь на экране: что рисовать; за краем или погоня кончилась — null. */
export function view(c: Chase | null): MouseView | null {
  if (!c || c.phase === 'done' || c.mouse.move === 'out') return null;
  const m = c.mouse;
  return { x: m.x, y: m.y, anim: m.move === 'still' ? 'sit' : 'run', facing: m.facing };
}
