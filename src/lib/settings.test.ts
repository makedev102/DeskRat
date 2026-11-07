import { describe, expect, it } from 'vitest';
import { cleanName, defaults, NAME_MAX, NAMES, parse, serialize, suggestName } from './settings';

describe('настройки', () => {
  it('по умолчанию осторожная версия, но от записи экрана прячемся', () => {
    const d = defaults();
    expect(d).toMatchObject({ feeder: false, bed: false, gameWindow: false, sites: false, reviews: false, hideFromCapture: true });
    expect(d).toMatchObject({ mode: 'calm', chatter: 'sometimes', topics: [], tmdbKey: '' });
    // охотник выключен; включили — по панели задач
    expect(d).toMatchObject({ hunter: false, hunterArea: 'taskbar' });
    // клубок тихий — включён сразу; у старых настроек без поля — тоже
    expect(d.yarn).toBe(true);
    expect(parse(JSON.stringify({ feeder: true })).yarn).toBe(true);
    expect(parse(JSON.stringify({ yarn: false })).yarn).toBe(false);
    expect(parse(JSON.stringify({ yarn: 'нет' })).yarn).toBe(true);
    expect(parse(JSON.stringify({ updates: true }))).not.toHaveProperty('updates');
  });

  it('туда и обратно без потерь', () => {
    const s = { ...defaults(), feeder: true, topics: ['аниме', 'космос'] as const, mode: 'pranks', tmdbKey: 'abc' } as const;
    const copy = { ...s, topics: [...s.topics] };
    expect(parse(serialize(copy))).toEqual(copy);
  });

  it('нет файла, битый JSON или не объект — значения по умолчанию', () => {
    for (const raw of [null, '{', '[]', '42', 'null']) expect(parse(raw)).toEqual(defaults());
  });

  it('битое поле заменяется поштучно, остальные живут', () => {
    const s = parse(JSON.stringify({ feeder: true, bed: 'yes', mode: 'chaos', chatter: 1, topics: ['космос', 'вязание', 7], tmdbKey: '  k  ' }));
    expect(s).toMatchObject({ feeder: true, bed: false, mode: 'calm', chatter: 'sometimes', topics: ['космос'], tmdbKey: 'k' });
  });

  it('охотник: битое поле — по умолчанию, остальное живёт', () => {
    expect(parse(JSON.stringify({ hunter: true, hunterArea: 'screen' }))).toMatchObject({ hunter: true, hunterArea: 'screen' });
    expect(parse(JSON.stringify({ hunter: 'да', hunterArea: 'desk', feeder: true }))).toMatchObject({
      hunter: false,
      hunterArea: 'taskbar',
      feeder: true,
    });
  });

  it('имя: старые настройки без имени — пусто, мусор вычищается', () => {
    expect(parse('{"feeder":true}').name).toBe('');
    expect(parse('{"name":42}').name).toBe('');
    expect(parse(JSON.stringify({ name: '  Мурка  ' })).name).toBe('Мурка');
    expect(cleanName('Му\u0000р\nка  Пуш')).toBe('Мурка Пуш');
    expect([...cleanName('я'.repeat(50))]).toHaveLength(NAME_MAX);
    // эмодзи не режется посередине
    expect(cleanName('🐱'.repeat(30))).toBe('🐱'.repeat(NAME_MAX));
  });

  it('«Другое» предлагает имя из списка и не то же самое', () => {
    for (let i = 0; i < 20; i++) {
      const n = suggestName(() => i / 20, 'Мурка');
      expect(NAMES.ru).toContain(n);
      expect(n).not.toBe('Мурка');
    }
  });

  it('темы — в порядке списка и без повторов', () => {
    expect(parse(JSON.stringify({ topics: ['космос', 'кино', 'космос'] })).topics).toEqual(['кино', 'космос']);
  });
});
