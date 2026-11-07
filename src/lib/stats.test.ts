import { describe, expect, it } from 'vitest';
import { date, days, duration, fresh, groups, load, MAX_STEP_MS, plural, save, tick } from './stats';

const NOW = new Date(2026, 10, 6, 15, 0).getTime();

describe('stats', () => {
  it('новая статистика: всё по нулям, отсчёт с сейчас', () => {
    const s = fresh(NOW);
    expect(s.since).toBe(NOW);
    expect(s.fed + s.petted + s.together + s.films).toBe(0);
  });

  it('старый файл { fed, petted } читается, дата начинается с загрузки', () => {
    const s = load('{"fed":7,"petted":40}', NOW);
    expect(s.fed).toBe(7);
    expect(s.petted).toBe(40);
    expect(s.mice).toBe(0);
    expect(s.since).toBe(NOW);
  });

  it('битое и чужое не роняет: мусор — ноль, дата из будущего — сейчас', () => {
    expect(load('{oops', NOW)).toEqual(fresh(NOW));
    expect(load('null', NOW)).toEqual(fresh(NOW));
    expect(load('42', NOW)).toEqual(fresh(NOW));
    const s = load(JSON.stringify({ fed: 'много', petted: -3, naps: 2.7, since: NOW + 1000 }), NOW);
    expect(s.fed).toBe(0);
    expect(s.petted).toBe(0);
    expect(s.naps).toBe(2);
    expect(s.since).toBe(NOW);
  });

  it('сохраняется и читается обратно', () => {
    const s = { ...fresh(NOW - 1000), fed: 3, caught: 1, mice: 2, filmMs: 5000 };
    expect(load(save(s), NOW)).toEqual(s);
  });

  it('время копится только дома, кино — только на сеансе, сон компьютера не в счёт', () => {
    let s = fresh(NOW);
    s = tick(s, 1000, true, false);
    s = tick(s, 2000, true, true);
    s = tick(s, 5000, false, true);
    expect(s.together).toBe(3000);
    expect(s.filmMs).toBe(2000);
    s = tick(s, 8 * 3600_000, true, false);
    expect(s.together).toBe(3000 + MAX_STEP_MS);
    expect(tick(s, -5, true, true)).toBe(s);
  });

  it('часы активности копятся по часу суток и переживают сохранение', () => {
    let s = fresh(NOW);
    s = tick(s, 1000, true, false, 22);
    s = tick(s, 1000, true, false, 22);
    s = tick(s, 1000, true, false);
    s = tick(s, 1000, false, false, 9);
    s = tick(s, 1000, true, false, 99);
    expect(s.hours[22]).toBe(2000);
    expect(s.hours.reduce((a, b) => a + b, 0)).toBe(2000);
    expect(load(save(s), NOW).hours).toEqual(s.hours);
    // битые часы — нули, а не NaN
    expect(load('{"hours":[1,"x",-3,null]}', NOW).hours.slice(0, 4)).toEqual([1, 0, 0, 0]);
    expect(load('{"hours":"oops"}', NOW).hours).toHaveLength(24);
  });

  it('склоняет числа', () => {
    const f: [string, string, string] = ['день', 'дня', 'дней'];
    expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map((n) => plural(n, f))).toEqual([
      'дней', 'день', 'дня', 'дня', 'дней', 'дней', 'дней', 'дней', 'день', 'дня', 'дней', 'день', 'дней',
    ]);
  });

  it('длительность — две старшие единицы', () => {
    expect(duration(0)).toBe('меньше минуты');
    expect(duration(59_999)).toBe('меньше минуты');
    expect(duration(12 * 60_000)).toBe('12 мин');
    expect(duration(3 * 3600_000)).toBe('3 ч');
    expect(duration(3 * 3600_000 + 5 * 60_000 + 30_000)).toBe('3 ч 5 мин');
    expect(duration(2 * 86400_000 + 4 * 3600_000 + 59 * 60_000)).toBe('2 дн 4 ч');
    expect(duration(86400_000)).toBe('1 дн');
  });

  it('дни знакомства — календарные, первый день считается', () => {
    expect(days(NOW, NOW)).toBe(1);
    const lateNight = new Date(2026, 10, 5, 23, 50).getTime();
    expect(days(lateNight, NOW)).toBe(2);
    expect(days(new Date(2026, 9, 7).getTime(), NOW)).toBe(31);
  });

  it('дата по-русски', () => {
    expect(date(NOW)).toBe('6 ноября 2026');
    expect(date(new Date(2027, 0, 1).getTime())).toBe('1 января 2027');
  });

  it('окно получает готовые строки', () => {
    const s = { ...fresh(new Date(2026, 10, 1).getTime()), fed: 1, petted: 22, mice: 5, caught: 3, films: 2, filmMs: 4 * 3600_000 };
    const g = groups(s, NOW);
    const row = (label: string) => g.flatMap((x) => x.rows).find((r) => r.label === label)!;
    expect(row('Знакомы')).toEqual({ label: 'Знакомы', value: '6 дней', hint: 'с 1 ноября 2026' });
    expect(row('Покормили').value).toBe('1 раз');
    expect(row('Погладили').value).toBe('22 раза');
    expect(row('Погоня за мышью (отключена)')).toEqual({ label: 'Погоня за мышью (отключена)', value: '5', hint: 'поймана 3 из 5' });
    expect(row('Кино вместе')).toEqual({ label: 'Кино вместе', value: '2 фильма', hint: '4 ч' });
    // без мышей и без кино приписки нет, а не «0 из 0»
    const empty = groups(fresh(NOW), NOW).flatMap((x) => x.rows);
    expect(empty.find((r) => r.label === 'Погоня за мышью (отключена)')!.hint).toBeUndefined();
    expect(empty.find((r) => r.label === 'Кино вместе')!.hint).toBeUndefined();
  });
});
