import { describe, expect, it } from 'vitest';
import { spawn, type World, type Pet } from './roam';
import { APPROACH_MS, CALL_GAP, CURIOUS_MS, NOTICE_MS, call, halt, pose, target, tick, type Summon } from './summon';

const world: World = { monitors: [{ rect: { left: 0, top: 0, right: 1000, bottom: 800 }, work: { left: 0, top: 0, right: 1000, bottom: 760 }, scale: 1, primary: true }], ledges: [] };
const pet = (): Pet => ({ ...spawn(world), x: 200, y: 760, facing: -1 });
const third = () => call(call(call(null, 0), 200), 400);

describe('тройной зов Пенни', () => {
  it('первый зов настораживает, второй поворачивает, только третий готовит подбегание', () => {
    let state = call(null, 0), p = pet();
    let next: Summon | null;
    [next, p] = tick(state, world, p, { x: 700, y: 700 }, 40, 40);
    expect(next?.phase).toBe('listen'); expect(p.x).toBe(200); expect(p.facing).toBe(-1); expect(pose(next!, p)).toBe('alert');
    state = call(state, 200);
    [next, p] = tick(state, world, p, { x: 700, y: 700 }, 240, 40);
    expect(next?.phase).toBe('turn'); expect(p.facing).toBe(1); expect(p.x).toBe(200);
    state = call(state, 400);
    [next, p] = tick(state, world, p, { x: 700, y: 700 }, 400 + NOTICE_MS - 1, 40);
    expect(next?.phase).toBe('notice'); expect(p.x).toBe(200);
    [next, p] = tick(state, world, p, { x: 700, y: 700 }, 400 + NOTICE_MS, 40);
    expect(next?.phase).toBe('approach'); expect(p.x).toBeGreaterThan(200); expect(pose(next!, p)).toBe('run');
  });

  it('поздний повтор снова считается первым; незавершённый зов истекает', () => {
    const first = call(null, 0);
    expect(call(first, CALL_GAP + 1).count).toBe(1);
    expect(tick(first, world, pet(), null, CALL_GAP + 1, 40)[0]).toBeNull();
    expect(call(third(), 600)).toEqual(third());
  });

  it('бежит по поверхности, останавливается перед курсором и шесть секунд любопытно смотрит', () => {
    let state: Summon | null = third(), p = pet(), now = 400 + NOTICE_MS;
    const cursor = { x: 700, y: 700 };
    while (state && state.phase !== 'curious' && now < APPROACH_MS) { [state, p] = tick(state, world, p, cursor, now, 40); now += 40; }
    expect(state?.phase).toBe('curious'); expect(p.x).toBe(660); expect(p.y).toBe(760); expect(p.move).toBe('still'); expect(p.facing).toBe(1); expect(p.goal).toBeNull();
    expect(pose(state!, p)).toBe('curious');
    expect(tick(state!, world, p, cursor, state!.since + CURIOUS_MS - 1, 40)[0]?.phase).toBe('curious');
    expect(tick(state!, world, p, cursor, state!.since + CURIOUS_MS, 40)[0]).toBeNull();
    expect(halt({ ...p, move: 'walk', goal: { surface: 'floor:0', x: 800 } }).goal).toBeNull();
  });

  it('не уходит за экран и не придумывает цель при недоступном курсоре', () => {
    for (const cursor of [{ x: -1, y: 0 }, { x: NaN, y: 200 }, { x: 200, y: Infinity }]) expect(target(world, pet(), cursor)).toBeNull();
    expect(target(world, pet(), { x: 999, y: 780 })?.x).toBe(920);
    const state = third();
    expect(tick(state, world, pet(), null, 2000, 40)[1].x).toBe(200);
    expect(tick(state, world, pet(), null, state.last + APPROACH_MS, 40)[0]).toBeNull();
  });

  it('выбирает верхнюю доступную опору под курсором, исключает узкие края и полосы сна', () => {
    const ledge = { hwnd: 1, y: 400, left: 100, right: 900, frame: { left: 100, top: 400, right: 900, bottom: 700 } };
    const w = { ...world, ledges: [ledge] };
    expect(target(w, pet(), { x: 600, y: 300 })?.surface).not.toBe('floor:0');
    expect(target(w, pet(), { x: 600, y: 500 })?.surface).toBe('floor:0');
    expect(target({ ...world, ledges: [{ ...ledge, left: 580, right: 650 }] }, pet(), { x: 600, y: 300 })?.surface).toBe('floor:0');
    expect(target({ ...world, strips: [ledge] }, pet(), { x: 600, y: 300 })?.surface).toBe('floor:0');
  });

  it('во время ожидания поверхность может исчезнуть — Пенни падает обычной физикой', () => {
    const p: Pet = { ...pet(), on: 'missing', hwnd: 123, y: 400 };
    const state = { ...third(), phase: 'curious' as const, since: 1000 };
    const [next, falling] = tick(state, world, p, null, 1040, 40);
    expect(falling.move).toBe('fall'); expect(pose(next!, falling)).toBe('fall');
  });

  it('на другом мониторе учитывает физические координаты и DPI', () => {
    const second = { rect: { left: -1600, top: 0, right: 0, bottom: 1200 }, work: { left: -1600, top: 0, right: 0, bottom: 1120 }, scale: 2, primary: false };
    const w = { ...world, monitors: [...world.monitors, second] };
    expect(target(w, pet(), { x: -500, y: 900 })).toEqual({ surface: 'floor:1', x: -420 });
    expect(target(w, pet(), { x: -1599, y: 900 })?.x).toBe(-1440);
  });
});
