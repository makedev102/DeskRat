// Пиксельные значки интерфейса: рисуются строками, как спрайт кошки, — «#» закрашен, остальное пусто.
// Icon.svelte превращает их в SVG с crispEdges, так что на любом масштабе Windows клетки остаются чёткими.

import { ANIMS } from '../lib/sprite';

export const ICONS = {
  // галочка: в чекбоксе и в меню питомца
  tick: [
    '.......',
    '......#',
    '.....##',
    '#...##.',
    '##.##..',
    '.###...',
    '..#....',
  ],
  // точка выбранного варианта: круг, нарисованный клетками
  dot: [
    '.###.',
    '#####',
    '#####',
    '#####',
    '.###.',
  ],
  minimize: [
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '#######',
    '#######',
  ],
  close: [
    '##...##',
    '###.###',
    '.#####.',
    '..###..',
    '.#####.',
    '###.###',
    '##...##',
  ],
  // Силуэт головы Пенни из принятого кадра переноса.
  rat: ANIMS[1].carried.frames[0].slice(3, 14).map((row, y) => {
    const pixels = [...row.slice(9, 23)];
    if (y < 2) pixels.fill('.', 5, 9); // портрет без загривка
    return pixels.join('').replace(/[kp]/g, '.').replace(/[^.]/g, '#');
  }),
  // «больше такого» под новостью в облачке
  heart: [
    '.##.##.',
    '#######',
    '#######',
    '#######',
    '.#####.',
    '..###..',
    '...#...',
  ],
  // «меньше такого»: то же сердце с трещиной
  broken: [
    '.##.##.',
    '###.###',
    '####.##',
    '###.###',
    '.##.##.',
    '..#.#..',
    '...#...',
  ],
} satisfies Record<string, string[]>;

export type IconName = keyof typeof ICONS;

/**
 * Путь SVG из строк: подряд идущие клетки строки сливаются в один прямоугольник,
 * чтобы между ними не проступали щели сглаживания.
 */
export function pixelPath(rows: readonly string[]): string {
  const parts: string[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (row[x] !== '#') {
        x++;
        continue;
      }
      const from = x;
      while (row[x] === '#') x++;
      parts.push(`M${from} ${y}h${x - from}v1h${from - x}z`);
    }
  });
  return parts.join('');
}

/** Размер сетки значка: ширина — по самой длинной строке. */
export function gridOf(rows: readonly string[]): { w: number; h: number } {
  return { w: Math.max(0, ...rows.map((r) => r.length)), h: rows.length };
}
