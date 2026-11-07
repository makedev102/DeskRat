// Тройной зов Пенни. Только состояние и существующая ходьба по поверхностям; без голоса и IPC.
import { endChase, goTo, inRect, RUN, side, step, surfaces, type Dot, type Goal, type Pet, type RoamEvent, type World } from './roam';
import type { AnimName } from './sprite';

export const CALL_GAP = 8000;
export const NOTICE_MS = 700;
export const CURIOUS_MS = 6000;
export const APPROACH_MS = 20_000;
export interface Summon {
  count: 1 | 2 | 3;
  phase: 'listen' | 'turn' | 'notice' | 'approach' | 'curious';
  last: number;
  since: number;
}

/** Именно три команды: одиночный зов и двойной не запускают движение. */
export function call(previous: Summon | null, now: number): Summon {
  if (previous?.count === 3) return previous;
  const count = !previous || now - previous.last > CALL_GAP ? 1 : previous.count === 1 ? 2 : 3;
  return { count, phase: count === 1 ? 'listen' : count === 2 ? 'turn' : 'notice', last: now, since: now };
}

export const halt = (pet: Pet): Pet => ({ ...endChase(pet), goal: null, exit: 0, move: pet.move === 'walk' ? 'still' : pet.move });

/** Под курсором — ближайшая опора снизу. Оставляет место перед носом и поля у края. */
export function target(world: World, pet: Pet, cursor: Dot): Goal | null {
  if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return null;
  const monitor = world.monitors.findIndex((m) => inRect(m.rect, cursor.x, cursor.y));
  if (monitor < 0) return null;
  const m = world.monitors[monitor], size = side(m);
  const all = surfaces(world).filter((s) => s.monitor === monitor && !s.strip);
  const current = all.find((s) => s.id === pet.on && cursor.x >= s.left && cursor.x < s.right && cursor.y <= s.y && cursor.y >= s.y - size);
  const support = current ?? all.filter((s) => s.left <= cursor.x && s.right > cursor.x && (s.y >= cursor.y || s.kind === 'floor')).sort((a, b) => a.y - b.y)[0];
  if (!support) return null;
  const margin = size / 2 + 16 * m.scale;
  if (support.right - support.left < margin * 2) return null;
  const facing = cursor.x >= pet.x ? 1 : -1;
  const x = Math.max(support.left + margin, Math.min(support.right - margin, cursor.x - facing * 40 * m.scale));
  return { surface: support.id, x };
}

const look = (pet: Pet, cursor: Dot | null): Pet => cursor && Math.abs(cursor.x - pet.x) > 1 ? { ...pet, facing: cursor.x > pet.x ? 1 : -1 } : pet;

export function tick(state: Summon, world: World, pet: Pet, cursor: Dot | null, now: number, dt: number): [Summon | null, Pet, RoamEvent | null] {
  const hold = (): [Summon, Pet, RoamEvent | null] => {
    const [next, event] = step(halt(pet), world, dt);
    return [state, state.phase === 'listen' ? next : look(next, cursor), event];
  };
  if (state.count < 3) return now - state.last > CALL_GAP ? [null, halt(pet), null] : hold();
  if (state.phase === 'curious') return now - state.since >= CURIOUS_MS ? [null, halt(pet), null] : hold();
  if (now - state.last >= APPROACH_MS) return [null, halt(pet), null];
  if (state.phase === 'notice' && now - state.since < NOTICE_MS) return hold();
  state = state.phase === 'notice' ? { ...state, phase: 'approach' } : state;
  const goal = cursor && target(world, pet, cursor);
  if (!goal) return [state, halt(pet), null];
  if (pet.on === goal.surface && pet.move === 'still' && Math.abs(pet.x - goal.x) < 1)
    return [{ ...state, phase: 'curious', since: now }, look(pet, cursor), 'arrived'];
  const [next, event] = step(goTo(pet, world, goal), world, dt, RUN);
  if (next.move === 'still' && next.on === goal.surface && Math.abs(next.x - goal.x) < 1)
    return [{ ...state, phase: 'curious', since: now }, look(next, cursor), event];
  return [state, next, event];
}

export function pose(state: Summon, pet: Pet): AnimName {
  if (pet.move === 'jump' || pet.move === 'fall') return pet.move;
  if (state.phase === 'curious') return 'curious';
  if (state.phase === 'approach' && pet.move !== 'still') return pet.move === 'walk' ? 'run' : pet.move === 'out' ? 'stand' : pet.move;
  return 'alert';
}
