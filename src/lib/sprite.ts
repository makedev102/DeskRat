// Персонаж 32×32. Базовые позы — Пенни; остальные пока upstream.
// Кадры собираются из общих головы, тела, лап и хвоста.
// Все позы смотрят вправо; влево — `flip`.

export const SIZE = 32;

/** Кадр: SIZE строк по SIZE символов, символ — ключ палитры, '.' — пусто. */
export type Frame = string[];

/** Деталь: строки любой длины, '.' не закрашивает то, что под ней. */
type Part = string[];

export const PALETTE: Record<string, string> = {
  // Цвета Пенни отдельно от старых поз и предметов.
  v: '#77717b', // мягкий контур белой шерсти
  F: '#faf7f2', // белая шерсть
  L: '#dedbdc', // тень шерсти, не пятно
  D: '#aaa7ad', // два серых пятнышка
  P: '#d797a6', // тень розовой кожи
  k: '#2b2b33', // контур
  f: '#9aa0ad', // шерсть
  d: '#6f7584', // полоски
  l: '#e4e6ec', // грудка, щёки, живот
  p: '#e98aa0', // уши изнутри, нос
  w: '#ffffff', // блик в глазу
  h: '#e2556b', // сердечко
  z: '#bcd4ff', // «з-з-з» во сне
  s: '#ffd34d', // звёздочки, когда врезалась
  u: '#d9d3c5', // пыль из-под лап на заносе
  B: '#26324a', // контур миски — свой, чтобы клик по миске отличался от клика по кошке
  b: '#5b8fd9', // миска
  c: '#c98d4b', // корм
  C: '#8a5a2b', // корм потемнее
  R: '#5a3a2e', // контур лежака
  r: '#b5654a', // лежак
  q: '#f0dcb8', // подушка в лежаке
  m: '#8d8478', // мышь
  n: '#6e665b', // мышь потемнее, у хвоста
  y: '#e0607e', // клубок
  Y: '#9c3550', // клубок: контур и нитки
  // Лужа мести полупрозрачная: сквозь неё видно окно, на котором она «лежит».
  a: 'rgba(232, 206, 84, 0.7)', // лужа
  A: 'rgba(176, 142, 38, 0.85)', // лужа: край
  W: 'rgba(255, 250, 214, 0.85)', // лужа: блик
  e: 'rgba(232, 206, 84, 0.35)', // лужа высыхает
  H: '#d23a3a', // новогодняя шапка
  I: '#f4f1ea', // мех на шапке
  o: '#f08c2a', // тыква
  O: '#b9561a', // тыква: дольки
  g: '#5c8a3a', // хвостик тыквы
};

/** Миска и корм в ней: клик сюда кормит, а не гладит. */
const BOWL_KEYS = new Set(['B', 'b', 'c', 'C']);

/** Украшения не часть зверя: клик по сердечку, «з-з-з» или звёздочкам проходит насквозь. */
const DECOR = new Set(['h', 'z', 's']);

/** Перед лежака в кадре спящей кошки: клик по нему уходит окну лежака под ней — за него лежак и таскают. */
const THROUGH = new Set([...DECOR, 'R', 'r', 'q']);

// Голова анфас, 12×10: кошка идёт боком, но смотрит на человека.
const HEAD_TOP: Part = [
  '.k........k.',
  'kpk......kpk',
  'kppkkkkkkppk',
  'kfffdffdfffk',
  'kffffffffffk',
];
const HEAD_BOTTOM: Part = [
  'klfffppffflk',
  '.kllllllllk.',
  '..kkkkkkkk..',
];
const EYES_OPEN: Part = ['kfwkffffwkfk', 'kfkkffffkkfk'];
const EYES_SHUT: Part = ['kffffffffffk', 'kfkkffffkkfk'];
const EYES_HAPPY: Part = ['kffkffffkffk', 'kfkfkffkfkfk'];
// Не доспала: веки тяжёлые, глаза полуприкрыты.
const EYES_SLEEPY: Part = ['kfddffffddfk', 'kfkkffffkkfk'];
// Злая: косые щёлки, внутренние концы ниже — «\ /».
const EYES_ANGRY: Part = ['kfkffffffkfk', 'kffkkffkkffk'];

// Мяу: рот открыт, видно язык.
const HEAD_MEOW: Part = ['klfffppffflk', '.kllkppkllk.', '..kkkkkkkk..'];
// Шипит: пасть шире, видны клыки.
const HEAD_HISS: Part = ['klffkppkfflk', '.klkwppwklk.', '..kkkkkkkk..'];

// Уши прижаты к голове и смотрят в стороны.
const HEAD_FLAT: Part = [
  '............',
  'kkk......kkk',
  'kppkkkkkkppk',
  'kfffdffdfffk',
  'kffffffffffk',
];

const head = (eyes: Part, bottom = HEAD_BOTTOM, top = HEAD_TOP): Part => [...top, ...eyes, ...bottom];

// Туловище сбоку, 18×8, полоски на спине.
const BODY: Part = [
  '..kkkkkkkkkkkkkk..',
  '.kffdffdffdfffffk.',
  'kfffdffdffdffffffk',
  'kffffffffffffffffk',
  'kffffffffffffffffk',
  'kffffffffflllllffk',
  '.kfffffflllllllfk.',
  '..kkkkkkkkkkkkkk..',
];

/**
 * Вдох: середина спины приподнимается на пиксель, края и низ на месте.
 * Целый лишний ряд дёргал всё туловище и отвлекал от работы.
 */
function inhale(body: Part): Part {
  const top = body[0];
  const from = top.indexOf('k') + 4;
  const to = top.lastIndexOf('k') - 4;
  const bump = [...top].map((_, x) => (x >= from && x <= to ? 'k' : '.')).join('');
  const lifted = [...top].map((c, x) => (x >= from && x <= to ? 'f' : c)).join('');
  return [bump, lifted, ...body.slice(1)];
}

/** Лапа сбоку, 4 в ширину: начинается на нижнем контуре туловища, `len` рядов, носочек светлый. */
const leg = (len: number): Part => [...Array<string>(len - 2).fill('kffk'), 'kllk', 'kkkk'];

// Хвост трубой, 6×9; основание уходит под туловище.
const TAIL_UP: Part = [
  '.kk...',
  'kddk..',
  'kfk...',
  'kfk...',
  'kfk...',
  'kffk..',
  '.kffk.',
  '..kffk',
  '...kfk',
];
const TAIL_SWAY: Part = [
  '..kk..',
  '.kddk.',
  '.kfk..',
  'kfk...',
  'kfk...',
  'kffk..',
  '.kffk.',
  '..kffk',
  '...kfk',
];

/** Сезонный жирок: 0 — лето, 2 — зима. */
export type Fat = 0 | 1 | 2;
export const FATS: Fat[] = [0, 1, 2];

/** Кошка начинает толстеть в ноябре, к декабрю набирает полностью и худеет к апрелю. */
export function fatOn(date: Date): Fat {
  const m = date.getMonth();
  if (m === 11 || m <= 1) return 2;
  return m === 10 || m === 2 ? 1 : 0;
}

/** Туловище сбоку на `fat` рядов глубже: живот провисает вниз, лапы от этого короче. */
const sideBody = (fat: Fat): Part => [...BODY.slice(0, 6), ...Array<string>(fat).fill(BODY[5]), ...BODY.slice(6)];

/** Полуширина каждого ряда туловища анфас, сверху вниз; последний ряд — нижний контур. */
const SIT_HALF = [3, 3, 4, 4, 5, 6, 6, 6, 6, 6];
const LOAF_HALF = [4, 5, 5, 6, 6, 6, 6];

/**
 * Туловище анфас по центру x 16: узко под головой, ниже бёдра. Жирок раздаёт бока
 * на пиксель за уровень, кроме самых верхних рядов — шея не толстеет.
 * `legs`: прямые передние лапы — светлый столбик в контуре от грудки до пола, носочки
 * разделены только в нижнем ряду; 'right' — левая (для зрителя) поднята к морде, стоит одна правая.
 * Без лап грудка сплошная, лапки рисуются поверх (`PAWS`).
 */
function frontBody(fat: Fat, halves: number[], legs: boolean | 'right'): Part {
  const half = halves.map((h, y) => h + Math.min(fat, y >> 1));
  const widest = Math.max(...half);
  const last = half.length - 1;
  return half.map((h, y) => {
    let row = '.'.repeat(widest - h);
    for (let x = -h; x < h; x++) {
      const edge = x === -h || x === h - 1;
      const chest = y >= 4 ? 2 : 1;
      if (y === last) row += edge ? '.' : 'k';
      else if (edge) row += 'k';
      else if (legs === 'right' && y >= last - 4) row += x === 0 || x === 3 ? 'k' : x > 0 && x < 3 ? 'l' : 'f';
      else if (legs && y === last - 1) row += x === -3 || x === 0 || x === 3 ? 'k' : x > -3 && x < 3 ? 'l' : 'f';
      else if (legs && y >= last - 4) row += x === -3 || x === 2 ? 'k' : x > -3 && x < 2 ? 'l' : 'f';
      else if (x >= -chest && x < chest) row += 'l';
      else row += 'f';
    }
    return row + '.'.repeat(widest - h);
  });
}

// Лапки буханки анфас, 10×4: два светлых овала из-под грудки, нижний ряд ложится на контур туловища.
const PAWS: Part = ['.kkk..kkk.', 'klllkklllk', 'klllkklllk', 'kkkkkkkkkk'];

// Хвост, обёрнутый вокруг лап.
const SIT_TAIL: Part = ['......kk', '.....kdk', 'kk...kfk', 'kfkkkffk', '.kffffk.', '..kkkk..'];

// Во сне хвост свисает с рамки окна.
const SLEEP_TAIL: Part = ['.kfk', '.kfk', '.kfk', '.kdk', '.kdk', '..k.'];
const SLEEP_TAIL_SWAY: Part = ['.kfk', '.kfk', 'kfk.', 'kdk.', 'kdk.', '.k..'];

// Лёжа хвост обёрнут вдоль бока по полу, кончиком вперёд.
const FLOOR_TAIL: Part = ['............', '.kkkkkkkkkk.', 'kffffffdddk.', '.kkkkkkkkkk.'];

// Миска 10×5 и горка корма над ней.
const BOWL: Part = ['BBBBBBBBBB', 'BbbbbbbbbB', 'BbbbbbbbbB', '.BbbbbbbB.', '..BBBBBB..'];
const KIBBLE: Part = ['..cCccCc..', '.cccCcccC.'];
// В кормушке горка растёт с числом порций: одна, две-три, четыре и больше.
const PILES: Part[] = [KIBBLE, ['...cCcc...', ...KIBBLE], ['....cC....', '...cCcc...', ...KIBBLE]];

// Лежак 30×9: задний бортик, подушка, передний бортик (с ряда 4 — он же `BED_FRONT`).
const BED: Part = [
  '...RRRRRRRRRRRRRRRRRRRRRRRR...',
  '..RrrrrrrrrrrrrrrrrrrrrrrrrR..',
  '.RrrRqqqqqqqqqqqqqqqqqqqqRrrR.',
  'RrrrRqqqqqqqqqqqqqqqqqqqqRrrrR',
  'RrrrrRRRRRRRRRRRRRRRRRRRRrrrrR',
  'RrrrrrrrrrrrrrrrrrrrrrrrrrrrrR',
  'RrrrrrrrrrrrrrrrrrrrrrrrrrrrrR',
  '.RrrrrrrrrrrrrrrrrrrrrrrrrrrR.',
  '..RRRRRRRRRRRRRRRRRRRRRRRRRR..',
];
/** Передний бортик закрывает кошку в лежаке снизу; хвост с подушки ложится на левый бортик. */
const BED_FRONT: Part = BED.slice(4);

const HEART: Part = ['.hh.hh.', 'hhhhhhh', 'hhhhhhh', '.hhhhh.', '..hhh..', '...h...'];
const Z_SMALL: Part = ['zzzz', '..z.', '.z..', 'zzzz'];

// Тортик на тарелке, 7×8: свечка, вишенка, крем, корж.
const CAKE: Part = ['...s...', '...k...', '.kkkkk.', '.klhlk.', '.kcccck', '.kcCck.', 'kwwwwwk', '.kkkkk.'];
// Лапа, вытянутая вбок к тарелке.
const PAW_SIDE: Part = ['.kkk', 'klfk', '.kkk'];
const Z_BIG: Part = ['zzzzz', '...z.', '..z..', '.z...', 'zzzzz'];

/** Штампует детали по порядку: следующая рисуется поверх предыдущей. */
function compose(...parts: [Part, number, number][]): Frame {
  const g = Array.from({ length: SIZE }, () => Array<string>(SIZE).fill('.'));
  for (const [part, x0, y0] of parts)
    part.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const x = x0 + dx;
        const y = y0 + dy;
        if (row[dx] !== '.' && x >= 0 && x < SIZE && y >= 0 && y < SIZE) g[y][x] = row[dx];
      }
    });
  return g.map((r) => r.join(''));
}

// Стоит и идёт: туловище x 4–21, низ на y 26 (+жир), голова справа сверху, лапы до земли (y 31).
// Лапы парами с общим контуром: задние x 5–11, передние x 14–20.
const BACK = [5, 8];
const FRONT = [14, 17];
// Голова над передними лапами, на шее: левый край заходит на загривок, морда чуть впереди груди.
const HEAD_AT: [number, number] = [16, 13];

/** `step[i]` — сдвиг i-й лапы (задние, потом передние) по x и подняв ли её. */
function standing(fat: Fat, eyes: Part, tail: Part, step: [number, boolean][] = []): Frame {
  const legs = [...BACK, ...FRONT].map((x, i): [Part, number, number] => {
    const [dx, up] = step[i] ?? [0, false];
    return [leg((up ? 5 : 6) - fat), x + dx, 26 + fat];
  });
  return compose([tail, 0, 12], [sideBody(fat), 4, 19], ...legs, [head(eyes), ...HEAD_AT]);
}

/**
 * Лапа в прыжке, наискось: на ряд ниже — на пиксель дальше. `dir` 1 — вперёд (передние тянутся
 * к цели), -1 — назад (задние только что оттолкнулись). Ставится по верхнему ряду: x — там же, где стоя.
 */
function slantLeg(len: number, dir: 1 | -1): [Part, number] {
  const rows = leg(len).map((r, i) => {
    const shift = dir === 1 ? i : len - 1 - i;
    return '.'.repeat(shift) + r + '.'.repeat(len - 1 - shift);
  });
  return [rows, dir === 1 ? 0 : len - 1];
}

// Хвост в прыжке вытянут назад рулём; кончик то прямо, то вверх.
const TAIL_BACK: Part = ['.kkkk.', 'kdffffk', '.kkkk.'];
const TAIL_BACK_FLICK: Part = ['kk....', 'kdkkk.', '.kdfffk', '..kkkk.'];

/** Прыжок: туловище как стоя, задние лапы вытянуты назад, передние — к цели, хвост рулём. */
function leaping(fat: Fat, tail: Part): Frame {
  const len = 6 - fat;
  const legs = [...BACK, ...FRONT].map((x, i): [Part, number, number] => {
    const [part, back] = slantLeg(len, i < 2 ? -1 : 1);
    return [part, x - back, 26 + fat];
  });
  return compose([tail, 0, 19], [sideBody(fat), 4, 19], ...legs, [head(EYES_OPEN), ...HEAD_AT]);
}

/** Падает: лапы висят прямо, уши прижаты, хвост трубой — «ой». */
function falling(fat: Fat, tail: Part, spread: boolean): Frame {
  const legs = [...BACK, ...FRONT].map((x, i): [Part, number, number] => [leg(6 - fat), x + (spread ? (i < 2 ? -1 : 1) : 0), 26 + fat]);
  return compose([tail, 0, 12], [sideBody(fat), 4, 19], ...legs, [head(EYES_OPEN, HEAD_MEOW, HEAD_FLAT), ...HEAD_AT]);
}

// Шаг на 32 пикселях: лапы то расставлены, то сведены, и поднята то одна диагональ, то другая.
// Сдвинуть лапы навстречу друг другу нельзя — четыре пикселя с контуром слипаются в пятно.
const SPREAD: [number, boolean][] = [[-1, false], [1, false], [-1, false], [1, false]];
const LIFT_A: [number, boolean][] = [[0, true], [0, false], [0, false], [0, true]];
const LIFT_B: [number, boolean][] = [[0, false], [0, true], [0, true], [0, false]];

/** Сидит анфас посередине: голова y 12–21, туловище y 22–31, хвост выглядывает справа. */
function sitting(fat: Fat, eyes: Part, tail: Part, extra: [Part, number, number][] = []): Frame {
  const body = frontBody(fat, SIT_HALF, true);
  const half = body[0].length / 2;
  return compose([tail, 13 + half, 26], [body, 16 - half, 22], [head(eyes), 10, 12], ...extra);
}

/** Разбудили, не доспала: сидит, клюёт носом (`nod` — голова ниже на пиксель) и зевает. */
function groggy(fat: Fat, eyes: Part, nod: boolean, mouth = HEAD_BOTTOM): Frame {
  const body = frontBody(fat, SIT_HALF, true);
  const half = body[0].length / 2;
  return compose([SIT_TAIL, 13 + half, 26], [body, 16 - half, 22], [head(eyes, mouth), 10, nod ? 13 : 12]);
}

// Злая сбоку: спина дугой, по столбцам x 3–21 — верх (y) и нижний контур живота.
const ARCH_TOP = [20, 18, 16, 15, 14, 13, 13, 12, 12, 12, 12, 13, 13, 14, 15, 16, 17, 18, 19];
const ARCH_BOTTOM = [23, 24, 24, 24, 24, 24, 24, 24, 23, 22, 22, 23, 24, 24, 24, 24, 24, 24, 23];

/**
 * Туловище дугой: шерсть дыбом — через столбец торчит на пиксель выше, `bristle` меняет
 * чётность, и шерсть дрожит. Жирок провисает живот под серединой дуги.
 */
function archBody(fat: Fat, bristle: boolean): Part {
  const top = ARCH_TOP.map((t, x) => (x > 1 && x < ARCH_TOP.length - 2 && x % 2 === Number(bristle) ? t - 1 : t));
  const bottom = ARCH_BOTTOM.map((b, x) => (x >= 7 && x <= 12 ? b + Math.min(fat, 24 - b) : b));
  const inside = (x: number, y: number) => x >= 0 && x < top.length && y >= top[x] && y <= bottom[x];
  // ряды сразу в координатах кадра: пустые сверху compose пропустит
  return Array.from({ length: Math.max(...bottom) + 1 }, (_, y) => {
    return top
      .map((_, x) => {
        if (!inside(x, y)) return '.';
        if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) return 'k';
        if ((x === 6 || x === 9 || x === 12) && y <= top[x] + 2) return 'd';
        return 'f';
      })
      .join('');
  });
}

// Хвост ёршиком: распушён вдвое против обычного.
const TAIL_PUFF: Part = ['.kkk..', 'kdddk.', 'kfffk.', 'kdfdk.', 'kfffk.', 'kfffk.', '.kfffk', '..kffk', '...kfk'];
const TAIL_PUFF_SWAY: Part = ['..kkk.', '.kdddk', 'kfffk.', 'kdfdk.', 'kfffk.', 'kfffk.', '.kfffk', '..kffk', '...kfk'];

/** Разбудили второй раз: выгнула спину, стоит на прямых лапах, голова опущена, шипит. */
function angry(fat: Fat, bristle: boolean, mouth: Part, tail: Part): Frame {
  const body = archBody(fat, bristle);
  const legs = [4, 7, 15, 18].map((x): [Part, number, number] => [leg(8), x, 24]);
  return compose([tail, 0, 11], [body, 3, 0], ...legs, [head(EYES_ANGRY, mouth, HEAD_FLAT), 17, 14]);
}

/** Обиделась и спит за краем экрана: самой не видно, только «з-з-з» всплывает снизу и тает. */
const behindEdge = (z: Part, x: number, y: number): Frame => compose([z, x, y]);

// Умывание: левая лапа поднята к морде — у рта, чтобы лизнуть, или у глаза, чтобы потереть.
// Светлая подушечка сверху, ниже предплечье до груди (y 23), иначе лапа висит в воздухе.
const raisedPaw = (y: number): Part => ['.kk.', 'kllk', 'kllk', ...Array<string>(23 - y - 2).fill('kffk')];
const TONGUE: Part = ['pp'];

// Облизывается после погони: язык ходит по губам от одного уголка рта к другому.
const LICK_LEFT: [Part, number, number][] = [[['p'], 13, 20], [['p'], 14, 21]];
const LICK_RIGHT: [Part, number, number][] = [[['p'], 18, 20], [['p'], 17, 21]];

function grooming(fat: Fat, eyes: Part, pawY: number, tongue: boolean): Frame {
  const body = frontBody(fat, SIT_HALF, 'right');
  const half = body[0].length / 2;
  const extra: [Part, number, number][] = tongue ? [[TONGUE, 15, 21]] : [];
  return compose(
    [SIT_TAIL, 13 + half, 26],
    [body, 16 - half, 22],
    [head(eyes), 10, 12],
    ...extra,
    [raisedPaw(pawY), 12, pawY],
  );
}

/** Буханка анфас: ниже, чем сидя, лапки подобраны под грудку. */
function frontLoaf(fat: Fat, eyes: Part): Frame {
  const body = frontBody(fat, LOAF_HALF, false);
  const half = body[0].length / 2;
  const y = SIZE - body.length;
  return compose([SIT_TAIL, 13 + half, 26], [body, 16 - half, y], [PAWS, 11, 28], [head(eyes), 10, y - 10]);
}

/** Спит калачиком; нижний контур туловища (y 27) лежит на рамке окна, жирок растёт вверх. */
function sleeping(body: Part, tail: Part, z: [Part, number, number]): Frame {
  const y = 28 - body.length;
  return compose([tail, 3, 26], [body, 5, y], [head(EYES_SHUT), 17, 17], z);
}

/** Буханка сбоку: лежит на земле, лапы спрятаны под себя, хвост вдоль бока, голова поднята. */
function sideLoaf(body: Part, eyes: Part, tail: Part): Frame {
  const y = SIZE - body.length;
  return compose([body, 5, y], [tail, 3, SIZE - 4], [head(eyes), 17, y - 5]);
}

/** Верх спины лицом в пол сбоку, по столбцам: спина ровная и низкая, у головы скатывается к полу. */
const PLANT_TOP = [3, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 3, 4, 5, 6, 7, 8];

/**
 * Туловище лицом в пол сбоку: контур — всё, что граничит с пустотой, сзади поджатая светлая лапка.
 * На вдохе приподнимается середина спины. Жирок добавляет рядов снизу — кошка выше.
 */
function plantBody(fat: Fat, breath: boolean): Part {
  const top = PLANT_TOP.map((t, x) => (breath && x >= 5 && x <= 10 ? t - 1 : t));
  const h = 9 + fat;
  // нижний задний угол срезан — круп круглый, а не кирпичом
  const inside = (x: number, y: number) => x >= 0 && x < top.length && y >= top[x] && y < h && !(x === 0 && y === h - 1);
  return Array.from({ length: h }, (_, y) =>
    top
      .map((_, x) => {
        if (!inside(x, y)) return '.';
        if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) return 'k';
        if (y >= h - 3 && x <= 4) return 'l';
        if ((x === 5 || x === 8 || x === 11) && y <= top[x] + 2) return 'd';
        return 'f';
      })
      .join(''),
  );
}

/** Спит, уткнувшись головой в пол, сбоку: из пола торчат только уши и лоб, хвост вдоль бока. */
function sidePlant(fat: Fat, breath: boolean, tail: Part, z: [Part, number, number]): Frame {
  const body = plantBody(fat, breath);
  const y = SIZE - body.length;
  return compose([body, 2, y], [tail, 0, SIZE - 4], [[...HEAD_TOP, 'kkkkkkkkkkkk'], 18, SIZE - 6], z);
}

/** Круглая спина анфас, когда голова опущена: по бокам светлые задние лапки. */
function dome(fat: Fat): Part {
  const half = [3, 5, 6, 7, 7, 8, 8, 8, 8, 8, 8, 8].map((h, y) => h + (y >= 2 ? fat : 0));
  const widest = Math.max(...half);
  const last = half.length - 1;
  return half.map((h, y) => {
    let row = '.'.repeat(widest - h);
    for (let x = -h; x < h; x++) {
      const edge = x === -h || x === h - 1;
      if (y === last) row += edge ? '.' : 'k';
      else if (edge || y === 0) row += 'k';
      else if (y >= last - 2 && (x === -h + 1 || x === -h + 2 || x === h - 2 || x === h - 3)) row += 'l';
      else if (y >= 1 && y <= 3 && (x === -2 || x === 1)) row += 'd';
      else row += 'f';
    }
    return row + '.'.repeat(widest - h);
  });
}

/**
 * Спит, уткнувшись головой в пол, анфас: круглая спина закрывает почти всю голову,
 * снизу торчат только уши и лоб — остальное в полу. Хвост над спиной.
 */
function faceplant(fat: Fat, tail: Part, z: [Part, number, number]): Frame {
  const back = dome(fat);
  const y0 = SIZE - back.length;
  const half = back[0].length / 2;
  return compose([tail, 17, y0 - 6], [back, 16 - half, y0], [[...HEAD_TOP, 'kkkkkkkkkkkk'], 10, SIZE - 6], z);
}

/** Просит есть: сидит рядом с пустой миской и смотрит на человека. */
function hungry(fat: Fat, eyes: Part, mouth: Part, tail: Part): Frame {
  const body = frontBody(fat, SIT_HALF, true);
  const half = body[0].length / 2;
  return compose([tail, 13 + half, 26], [body, 16 - half, 22], [head(eyes, mouth), 10, 12], [BOWL, 0, SIZE - 5]);
}

/** Ест: спина горбом, голова опущена в миску, над краем видны уши и лоб; `headY` — кивок жуя. */
function eating(fat: Fat, headY: number, tail: Part): Frame {
  const back = dome(fat);
  const y0 = SIZE - back.length;
  const half = back[0].length / 2;
  return compose(
    [tail, 17, y0 - 6],
    [back, 16 - half, y0],
    [head(EYES_SHUT), 10, headY],
    [KIBBLE, 11, SIZE - 7],
    [BOWL, 11, SIZE - 5],
  );
}

/** Галоп, сбор: лапы подобраны под себя, кошка на миг над землёй; голова клюёт вниз. */
function gathered(fat: Fat): Frame {
  const legs = [6, 9, 13, 16].map((x): [Part, number, number] => [leg(5 - fat), x, 26 + fat]);
  return compose([TAIL_BACK, 0, 19], [sideBody(fat), 4, 19], ...legs, [head(EYES_OPEN), 16, 14]);
}

/**
 * Засада на лазер: туловище прижато к земле на два ряда ниже, голова вытянута вперёд и вниз,
 * хвост низко и неподвижно. `wiggle` — задние лапы переступают: зад «ёрзает» перед прыжком.
 */
function crouching(fat: Fat, wiggle: boolean): Frame {
  const legs = [...BACK, ...FRONT].map((x, i): [Part, number, number] => [leg(4 - fat), x - (wiggle && i < 2 ? 1 : 0), 28 + fat]);
  return compose([TAIL_BACK, 0, 22], [sideBody(fat), 4, 21], ...legs, [head(EYES_OPEN), 17, 15]);
}

/**
 * Месть: присела, как в засаде, только хвост торчком и неподвижен — поза сидя, хвост в ней
 * не дёргается. Уши прижаты; кадры отличаются глазами: зло щурится, потом жмурится от усердия.
 */
function squatting(fat: Fat, eyes: Part): Frame {
  const legs = [...BACK, ...FRONT].map((x): [Part, number, number] => [leg(4 - fat), x, 28 + fat]);
  return compose([TAIL_UP, 0, 14], [sideBody(fat), 4, 21], ...legs, [head(eyes, HEAD_BOTTOM, HEAD_FLAT), 17, 15]);
}

const STAR: Part = ['.s.', 'sss', '.s.'];

// Пыль из-под передних лап на заносе: клубок то поменьше, то побольше.
const DUST_SMALL: Part = ['.u.', 'uuu'];
const DUST_BIG: Part = ['..u..', '.uuu.', 'uuuuu'];

/**
 * Занос на развороте: туловище осело на ряд, передние лапы упёрты вперёд наискось, голова
 * откинута назад, уши прижаты, хвост рулём; перед лапами клубится пыль.
 */
function skidding(fat: Fat, big: boolean): Frame {
  const len = 5 - fat;
  const legs = [...BACK, ...FRONT].map((x, i): [Part, number, number] =>
    i < 2 ? [leg(len), x, 27 + fat] : [slantLeg(len, 1)[0], x, 27 + fat],
  );
  const toe = FRONT[1] + len + 3;
  return compose(
    [TAIL_BACK, 0, 20],
    [sideBody(fat), 4, 20],
    ...legs,
    [head(EYES_OPEN, HEAD_BOTTOM, HEAD_FLAT), HEAD_AT[0] - 1, HEAD_AT[1] + 1],
    big ? [DUST_BIG, toe, SIZE - 3] : [DUST_SMALL, toe + 1, SIZE - 2],
  );
}

/** Врезалась в край окна: отпрянула на пиксель, уши прижаты, глаза зажмурены, хвост ёршиком, над головой звёздочки. */
function bonked(fat: Fat, stars: [number, number][]): Frame {
  const legs = [...BACK, ...FRONT].map((x): [Part, number, number] => [leg(6 - fat), x, 26 + fat]);
  return compose(
    [TAIL_PUFF, 0, 12],
    [sideBody(fat), 4, 19],
    ...legs,
    [head(EYES_SHUT, HEAD_MEOW, HEAD_FLAT), 15, 14],
    ...stars.map(([x, y]): [Part, number, number] => [STAR, x, y]),
  );
}

// На весу за шкирку анфас: кожа на загривке оттянута, лапы и хвост висят.
const SCRUFF: Part = ['.kk.', 'kffk', 'kffk'];
const HANG_HALF = [3, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4];
// Передние лапы висят вдоль боков: наружный контур лапы — контур туловища.
const HANG_FRONT: Part = ['kfk', 'kfk', 'kfk', 'kfk', 'kfk', 'klk', 'klk', '.k.'];
const HANG_BACK: Part = ['kffk', 'kffk', 'kffk', 'kllk', '.kk.'];
// Хвост висит прямо и не дёргается.
const HANG_TAIL: Part = ['kffk', 'kddk', 'kffk', 'kffk', 'kddk', 'kffk', 'kffk', 'kddk', 'kffk', '.kk.'];

/**
 * Загривок в кадре `carried`, в клетках: за эту точку кошка висит на курсоре — середина кадра
 * по x (между клетками 15 и 16) и середина верхнего ряда. Кадр симметричен, flip её не сдвигает.
 */
export const SCRUFF_AT: [number, number] = [16, 0.5];

/** Несут за шкирку: голова сверху, туловище вытянуто, задние лапы (`sway` — разведены на пиксель) и хвост висят. */
function carried(fat: Fat, eyes: Part, sway: boolean): Frame {
  const body = frontBody(fat, HANG_HALF, false);
  const half = body[0].length / 2;
  const d = sway ? 1 : 0;
  return compose(
    [HANG_TAIL, 14, 22],
    [HANG_BACK, 11 - d, 22],
    [HANG_BACK, 17 + d, 22],
    [body, 16 - half, 9],
    [HANG_FRONT, 16 - half, 12],
    [HANG_FRONT, 16 + half - 3, 12],
    [SCRUFF, 14, 0],
    [head(eyes), 10, 1],
  );
}

/** Спит в лежаке: калачик на пиксель ниже — в подушке, — снизу закрыт передним бортиком. */
const inBed = (f: Frame): Frame => compose([['.'.repeat(SIZE), ...f.slice(0, SIZE - 1)], 0, 0], [BED_FRONT, 1, SIZE - BED_FRONT.length]);

export interface Anim {
  frames: Frame[];
  /** Сколько держится один кадр. */
  ms: number;
}

// Сетка второго примера пользователя, 33×13. Цвета шерсти заменены ниже.
// Первые три столбца — только кончик хвоста; его укорочение даёт поля в 32×32.
const PENNY_REFERENCE: Part = [
  '..........................PP.....',
  '.......................PPPppP....',
  '................vvvvvv.Pppvvvv...',
  '..............vvFFFFFFvPppFFFvv..',
  '.............vFFFwwwwFFFPFFvFFFvP',
  '............vFFwwwwwwwwFFFFFFFFFv',
  '...........PwwwwwwFFwwwwFFFFvvvv.',
  '..........pPFwwwwFFFFwwwFFFv.....',
  '.......ppPPPLFwwwLLLLFFFFvv......',
  '.....pPPPP...LFFLFFFFLLFvv.......',
  '...pPP........LLP......vvP.......',
  '..pP..........p.PP.....p.PP......',
  'ppP...........pp.......pp........',
];
const pennyFur = (row: string) => row.replaceAll('w', 'F');
const PENNY_HEAD: Part = PENNY_REFERENCE.slice(0, 10).map((row) => pennyFur(row.slice(22)));
const PENNY_PATCH: Part = ['.DD.', 'DDDD', '.DD.'];
const PENNY_PAW: Part = ['Ppp', '.PP'];
/** Тот же хвост из примера, уложенный под высоту сидячей или спящей позы. */
function pennyFloorTail(baseX: number, baseY: number, sway: boolean): [Part, number, number] {
  const tail = Array.from({ length: SIZE - baseY }, () => Array<string>(16).fill('.'));
  for (let y = 6; y < PENNY_REFERENCE.length; y++)
    for (let x = 0; x < 12; x++) {
      const c = PENNY_REFERENCE[y][x];
      if (c !== 'p' && c !== 'P') continue;
      const tx = 1 + Math.round((baseX - 2) * x / 11) + Number(sway && y === 12);
      const ty = Math.round((SIZE - 1 - baseY) * (y - 6) / 6);
      tail[ty][tx] = c;
    }
  return [tail.map((row) => row.join('')), 1, baseY];
}

function pennyHead(shut: boolean): Part {
  const part = PENNY_HEAD.map((row) => [...row]);
  for (const [x, y] of [[5, 3], [6, 3], [6, 4], [7, 4], [8, 4]]) part[y][x] = 'D';
  part[4][5] = shut ? 'L' : 'k';
  part[4][10] = 'p';
  return part.map((row) => row.join(''));
}

/** Круп с постоянным пятном у основания хвоста; жирок растёт вниз. */
function pennyBody(fat: Fat): Part {
  return [
    '.....vvvvv.......',
    '...vvFFFFFvv.....',
    '..vFFFFFFFFFvv...',
    '.vFFFFFFFFFFFFv..',
    ...Array<string>(2 + fat).fill('vFFFFFFFFFFFFFFFv'),
    '.vLLLLLLLLLLLLv..',
    '..vvv..vvvvvv....',
  ];
}

function pennyStanding(fat: Fat, shut: boolean, sway: boolean, step: [number, boolean][] = []): Frame {
  const head = pennyHead(shut);
  head[3] = 'F' + head[3].slice(1); // внутренняя кромка шеи сливается с плечом
  const body = PENNY_REFERENCE.map((row, y) => [...pennyFur(row.slice(3))].map((c, x) => {
    if (y < 10 && x >= 19) return '.'; // общая голова рисуется отдельно
    if (y >= 10 && x >= 11 && (c === 'p' || c === 'P')) return '.'; // лапки отдельно
    return c;
  }).join(''));
  body[12] = 'pp' + body[12].slice(2); // целый кончик вместо обрезанных трёх клеток
  if (sway) body[12] = '.p' + body[12].slice(2);
  body.splice(6, 0, ...Array<string>(fat).fill(body[5]));
  const legs = [12, 21].map((x, i): [Part, number, number] => {
    const [dx, up] = step[i === 0 ? 0 : 2] ?? [0, false];
    return [[ '..P.', 'p.PP', 'pp..' ], x + dx, 29 - Number(up)];
  });
  return compose(
    [body, 1, 19 - fat],
    [['v', 'F', 'F', 'F', 'F'], 20, 21], // диагональная ступенька от спины к уху
    [PENNY_PATCH, 10, 24],
    ...legs,
    [head, 20, 19],
  );
}

const PENNY_SIT_REFERENCE: Part = [
  '.....FFFF...',
  '.....FFkFFp.',
  '...ppFFFFF..',
  '....FFFF....',
  '...FFFL.....',
  '..FFFFF.....',
  '..FFFFF.....',
  '.FFFFLF.....',
  '.FFFpLLP....',
  'FFFFLL......',
  'FFFFLL......',
  'FFFFLLF.....',
  'FFFLLLF.....',
  'FFppLLFPP...',
];
const PENNY_SIT_EAR: Part = ['.PP.', 'PppP', 'PppP', '.PP.'];

function pennySitting(fat: Fat, shut: boolean, sway: boolean): Frame {
  // Непосредственная сетка верхней левой крыски со стикерного референса.
  // Голова и плечи здесь принадлежат самой сидячей позе, без растяжения шеи.
  const body = PENNY_SIT_REFERENCE.map((row, y) => {
    const start = row.search(/[FL]/);
    return y >= 4 && start >= 0 ? row.slice(0, start) + 'F'.repeat(fat) + row.slice(start) : row;
  });
  const g = body.map((row) => [...row.padEnd(14, '.')]);
  for (const [x, y] of [[7, 0], [8, 0], [8, 1], [9, 1], [8, 2]]) g[y][x] = 'D';
  g[1][7] = shut ? 'L' : 'k';
  // Однопиксельная кромка снаружи шерсти; хвост и розовые лапы без обводки.
  const outline = Array.from({ length: 15 }, () => Array<string>(16).fill('.'));
  g.forEach((row, y) => row.forEach((c, x) => {
    if (!'FLDk'.includes(c)) return;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const tx = x + dx + 1, ty = y + dy + 1;
      if (tx >= 0 && tx < 16 && ty >= 0 && ty < 15) outline[ty][tx] = 'v';
    }
  }));
  return compose(pennyFloorTail(13, 30, sway), [outline.map((row) => row.join('')), 12, 17],
    [g.map((row) => row.join('')), 13, 18], [PENNY_PATCH, 14, 28], [PENNY_SIT_EAR, 15, 16]);
}

function pennySleeping(fat: Fat, breath: boolean): Frame {
  const body = pennyBody(fat);
  // Во сне поджатые бёдра образуют сплошную линию опоры.
  body[body.length - 1] = '.vvvvvvvvvvvvvv..';
  // Низ y27: контракт сна на рамке. На вдохе движется только спина.
  if (breath) {
    body.unshift('......vvv........');
    body[1] = '.....vFFFv.......';
  }
  return compose(
    pennyFloorTail(10, 26, breath),
    [body, 9, 28 - body.length],
    [PENNY_PATCH, 11, 23],
    [PENNY_PAW, 22, 26],
    [pennyHead(true), 20, 18],
    breath ? [Z_BIG, 26, 6] : [Z_SMALL, 25, 11],
  );
}

function build(fat: Fat) {
  const body = sideBody(fat);
  const bedSleep: Anim = {
    ms: 1500,
    frames: [
      sleeping(body, SLEEP_TAIL, [Z_SMALL, 25, 11]),
      sleeping(inhale(body), SLEEP_TAIL_SWAY, [Z_BIG, 26, 6]),
    ],
  };
  return {
    stand: {
      ms: 500,
      frames: [
        pennyStanding(fat, false, false),
        pennyStanding(fat, false, true),
        pennyStanding(fat, false, false),
        pennyStanding(fat, true, false),
      ],
    },
    walk: {
      ms: 150,
      frames: [
        pennyStanding(fat, false, false, SPREAD),
        pennyStanding(fat, false, true, LIFT_A),
        pennyStanding(fat, false, false, SPREAD),
        pennyStanding(fat, false, true, LIFT_B),
      ],
    },
    jump: {
      ms: 200,
      frames: [leaping(fat, TAIL_BACK), leaping(fat, TAIL_BACK_FLICK)],
    },
    // охота за лазером: галоп вдвое чаще шага, засада, «бум» об край окна
    run: {
      ms: 90,
      frames: [leaping(fat, TAIL_BACK), gathered(fat)],
    },
    crouch: {
      ms: 220,
      frames: [crouching(fat, false), crouching(fat, true)],
    },
    // занос: держится, пока едет по инерции (SKID_MS), пыль клубится
    skid: {
      ms: 100,
      frames: [skidding(fat, false), skidding(fat, true)],
    },
    bonk: {
      ms: 200,
      frames: [
        bonked(fat, [[26, 9], [29, 12]]),
        bonked(fat, [[28, 8], [24, 11]]),
      ],
    },
    fall: {
      ms: 150,
      frames: [falling(fat, TAIL_UP, false), falling(fat, TAIL_SWAY, true)],
    },
    sit: {
      ms: 600,
      frames: [
        pennySitting(fat, false, false),
        pennySitting(fat, false, true),
        pennySitting(fat, false, false),
        pennySitting(fat, false, false),
        pennySitting(fat, true, false),
      ],
    },
    loaf: {
      ms: 1000,
      frames: [
        frontLoaf(fat, EYES_OPEN),
        frontLoaf(fat, EYES_OPEN),
        frontLoaf(fat, EYES_OPEN),
        frontLoaf(fat, EYES_OPEN),
        frontLoaf(fat, EYES_SHUT),
      ],
    },
    sideLoaf: {
      ms: 1000,
      frames: [
        sideLoaf(body, EYES_OPEN, FLOOR_TAIL),
        sideLoaf(body, EYES_OPEN, FLOOR_TAIL),
        sideLoaf(body, EYES_OPEN, FLOOR_TAIL),
        sideLoaf(body, EYES_OPEN, FLOOR_TAIL),
        sideLoaf(body, EYES_SHUT, FLOOR_TAIL),
      ],
    },
    sleep: { ms: 1500, frames: [pennySleeping(fat, false), pennySleeping(fat, true)] },
    // Лежак и остальные позы переводятся на образ Пенни на этапе 3.
    bed: { ms: bedSleep.ms, frames: bedSleep.frames.map(inBed) },
    carried: {
      ms: 450,
      frames: [
        carried(fat, EYES_OPEN, false),
        carried(fat, EYES_OPEN, true),
        carried(fat, EYES_OPEN, false),
        carried(fat, EYES_SHUT, false),
      ],
    },
    faceplant: {
      ms: 1500,
      frames: [
        faceplant(fat, TAIL_UP, [Z_SMALL, 25, 9]),
        faceplant(fat, TAIL_SWAY, [Z_BIG, 26, 4]),
      ],
    },
    sidePlant: {
      ms: 1500,
      frames: [
        sidePlant(fat, false, FLOOR_TAIL, [Z_SMALL, 27, 16]),
        sidePlant(fat, true, FLOOR_TAIL, [Z_BIG, 27, 11]),
      ],
    },
    hungry: {
      ms: 600,
      frames: [
        hungry(fat, EYES_OPEN, HEAD_BOTTOM, SIT_TAIL),
        hungry(fat, EYES_OPEN, HEAD_BOTTOM, SIT_TAIL),
        hungry(fat, EYES_OPEN, HEAD_MEOW, SIT_TAIL),
        hungry(fat, EYES_OPEN, HEAD_BOTTOM, SIT_TAIL),
        hungry(fat, EYES_SHUT, HEAD_BOTTOM, SIT_TAIL),
      ],
    },
    eat: {
      ms: 300,
      frames: [eating(fat, 20, TAIL_UP), eating(fat, 21, TAIL_UP), eating(fat, 20, TAIL_SWAY), eating(fat, 21, TAIL_SWAY)],
    },
    groom: {
      ms: 350,
      frames: [
        grooming(fat, EYES_SHUT, 18, true),
        grooming(fat, EYES_SHUT, 19, false),
        grooming(fat, EYES_SHUT, 18, true),
        grooming(fat, EYES_SHUT, 14, false),
        grooming(fat, EYES_SHUT, 16, false),
        grooming(fat, EYES_SHUT, 14, false),
      ],
    },
    petted: {
      ms: 400,
      frames: [
        sitting(fat, EYES_HAPPY, SIT_TAIL, [[HEART, 13, 5]]),
        sitting(fat, EYES_HAPPY, SIT_TAIL, [[HEART, 13, 4]]),
      ],
    },
    groggy: {
      ms: 700,
      frames: [
        groggy(fat, EYES_SLEEPY, false),
        groggy(fat, EYES_SHUT, true),
        groggy(fat, EYES_SHUT, true),
        groggy(fat, EYES_SLEEPY, false),
        groggy(fat, EYES_SHUT, false, HEAD_MEOW),
        groggy(fat, EYES_SLEEPY, false),
      ],
    },
    angry: {
      ms: 250,
      frames: [
        angry(fat, false, HEAD_HISS, TAIL_PUFF),
        angry(fat, true, HEAD_HISS, TAIL_PUFF_SWAY),
        angry(fat, false, HEAD_HISS, TAIL_PUFF),
        angry(fat, true, HEAD_BOTTOM, TAIL_PUFF_SWAY),
      ],
    },
    // месть (revenge.ts): присела над лужей, потом сидит довольная и уходит вразвалку, жмурясь
    squat: {
      ms: 500,
      frames: [squatting(fat, EYES_ANGRY), squatting(fat, EYES_ANGRY), squatting(fat, EYES_SHUT)],
    },
    smug: {
      ms: 600,
      frames: [
        sitting(fat, EYES_HAPPY, SIT_TAIL),
        sitting(fat, EYES_HAPPY, SIT_TAIL),
        sitting(fat, EYES_HAPPY, SIT_TAIL),
        sitting(fat, EYES_SHUT, SIT_TAIL),
      ],
    },
    strut: {
      ms: 150,
      frames: [
        standing(fat, EYES_HAPPY, TAIL_UP, SPREAD),
        standing(fat, EYES_HAPPY, TAIL_SWAY, LIFT_A),
        standing(fat, EYES_HAPPY, TAIL_UP, SPREAD),
        standing(fat, EYES_HAPPY, TAIL_SWAY, LIFT_B),
      ],
    },
    lick: {
      ms: 180,
      frames: [
        sitting(fat, EYES_HAPPY, SIT_TAIL, LICK_LEFT),
        sitting(fat, EYES_HAPPY, SIT_TAIL, [[TONGUE, 15, 21]]),
        sitting(fat, EYES_HAPPY, SIT_TAIL, LICK_RIGHT),
        sitting(fat, EYES_HAPPY, SIT_TAIL, [[TONGUE, 15, 21]]),
      ],
    },
    // снимают экран (PrintScreen, Win+Shift+S): сидит ровно, жмурится, «сы-ыр»; сбоку мигает вспышка
    pose: {
      ms: 500,
      frames: [
        sitting(fat, EYES_HAPPY, SIT_TAIL, [[HEAD_MEOW, 10, 19]]),
        sitting(fat, EYES_HAPPY, SIT_TAIL, [[HEAD_MEOW, 10, 19], [STAR, 3, 4], [STAR, 26, 6]]),
        sitting(fat, EYES_HAPPY, SIT_TAIL, [[HEAD_MEOW, 10, 19]]),
        sitting(fat, EYES_HAPPY, SIT_TAIL, [[HEAD_MEOW, 10, 19]]),
      ],
    },
    // очистили корзину: хрумкает выброшенное, крошки сыплются с подбородка
    crunch: {
      ms: 220,
      frames: [
        sitting(fat, EYES_SHUT, SIT_TAIL, [[HEAD_MEOW, 10, 19], [['c'], 14, 23]]),
        sitting(fat, EYES_SHUT, SIT_TAIL, [[['C'], 17, 24]]),
        sitting(fat, EYES_SHUT, SIT_TAIL, [[HEAD_MEOW, 10, 19], [['c'], 18, 23]]),
        sitting(fat, EYES_HAPPY, SIT_TAIL, [[['c'], 14, 25]]),
      ],
    },
    // праздник: сидит у тортика и, как положено кошке, спихивает тарелку лапой
    cake: {
      ms: 450,
      frames: [
        sitting(fat, EYES_OPEN, SIT_TAIL, [[CAKE, 1, 24]]),
        sitting(fat, EYES_OPEN, SIT_TAIL, [[CAKE, 1, 24], [PAW_SIDE, 8, 28]]),
        sitting(fat, EYES_SHUT, SIT_TAIL, [[CAKE, 0, 24], [PAW_SIDE, 7, 28]]),
        sitting(fat, EYES_HAPPY, SIT_TAIL, [[CAKE, 0, 24]]),
      ],
    },
    zzz: {
      ms: 1100,
      frames: [
        behindEdge(Z_SMALL, 14, 27),
        behindEdge(Z_SMALL, 15, 21),
        behindEdge(Z_BIG, 16, 14),
        compose(),
        compose(),
        compose(),
      ],
    },
  } satisfies Record<string, Anim>;
}

export type Anims = ReturnType<typeof build>;
export type AnimName = keyof Anims;

/** Все позы при данном жирке; собираются один раз на уровень. */
export const ANIMS: Record<Fat, Anims> = { 0: build(0), 1: build(1), 2: build(2) };

/**
 * Ряд кадра, которым поза стоит на поверхности. Обычно нижний; калачик лежит контуром живота
 * на ряду 27, а хвост свешивается ниже — с рамки окна или с панели задач.
 */
export function ground(anim: AnimName): number {
  return anim === 'sleep' ? 27 : SIZE - 1;
}

/** Наряд по случаю: шапка на Новый год, тыква на Хэллоуин. */
export type Outfit = 'hat' | 'pumpkin';

// Наряды ставятся над рядом макушки (уши + темя) головы анфас, по её левому краю; 12 в ширину.
const CROWN_ROW = 'kppkkkkkkppk';
// Только непрозрачная часть уха: за головой во сне видна спина, а не пустота.
const PENNY_CROWN_ROW = 'PPPppP';
const OUTFITS: Record<Outfit, Part> = {
  hat: ['........kk..', '.......kIIk.', '......kHkk..', '.....kHHk...', '....kHHHHk..', '..kIIIIIIk..'],
  pumpkin: ['.....gk.....', '...kkgkkk...', '..koOoOook..', '..kOoOoOok..', '..kkkkkkkk..'],
};

/**
 * Надеть наряд: ищем макушку старой головы или ухо Пенни.
 * Позы без узнаваемой головы остаются как есть. Вход не трогает.
 */
export function dress(frame: Frame, outfit: Outfit | null): Frame {
  if (!outfit) return frame;
  const sitEar = frame.findIndex((row) => row.includes(PENNY_SIT_EAR[1]));
  const crown = frame.some((row) => row.includes(PENNY_CROWN_ROW)) ? PENNY_CROWN_ROW : CROWN_ROW;
  const y = sitEar >= 0 ? sitEar - 1 : frame.findIndex((row) => row.includes(crown));
  if (y < 0) return frame;
  const x = sitEar >= 0 ? frame[sitEar].indexOf(PENNY_SIT_EAR[1]) - 2 : frame[y].indexOf(crown) - Number(crown === PENNY_CROWN_ROW);
  const part = OUTFITS[outfit];
  const g = frame.map((r) => [...r]);
  part.forEach((row, dy) => {
    const ty = y - part.length + dy;
    for (let dx = 0; dx < row.length; dx++)
      if (row[dx] !== '.' && ty >= 0 && ty < SIZE && x + dx < SIZE) g[ty][x + dx] = row[dx];
  });
  return g.map((r) => r.join(''));
}

export function flip(frame: Frame): Frame {
  return frame.map((r) => [...r].reverse().join(''));
}

export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  ctx.clearRect(0, 0, SIZE, SIZE);
  frame.forEach((row, y) => {
    for (let x = 0; x < SIZE; x++) {
      const c = PALETTE[row[x]];
      if (c) {
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
}

/**
 * Левый столбец миски в окне миски. Миска у правого края кадра — там же, где она в позе
 * `hungry`, отражённой влево: кошка у миски стоит слева от неё, и две миски совпадают пиксель в пиксель.
 */
export const BOWL_X = SIZE - BOWL[0].length;

/** Кадр окна миски: пустая или с горкой корма по числу порций. */
export function bowlFrame(portions: number): Frame {
  const pile = portions <= 0 ? null : PILES[portions === 1 ? 0 : portions <= 3 ? 1 : 2];
  const bowl: [Part, number, number] = [BOWL, BOWL_X, SIZE - BOWL.length];
  return pile ? compose([pile, BOWL_X, SIZE - BOWL.length - pile.length], bowl) : compose(bowl);
}

/** Левый столбец миски в кадре кошки; null — миски в кадре нет. */
export function bowlLeft(frame: Frame): number | null {
  let left: number | null = null;
  for (const row of frame) {
    const x = row.indexOf('B');
    if (x >= 0 && (left === null || x < left)) left = x;
  }
  return left;
}

/** Попал ли клик в клетке (x, y) по миске. */
export function onBowl(frame: Frame, x: number, y: number): boolean {
  return BOWL_KEYS.has(frame[y]?.[x] ?? '.');
}

/**
 * Маска для Rust: по числу на строку, бит x = в этой клетке нарисован зверь (не украшение
 * и не перед лежака). `through` — какие цвета пропускают клик насквозь.
 */
export function hitMask(frame: Frame, through: ReadonlySet<string> = THROUGH): number[] {
  return frame.map((row) => {
    let bits = 0;
    for (let x = 0; x < SIZE; x++) if (row[x] !== '.' && !through.has(row[x])) bits |= 1 << x;
    return bits >>> 0;
  });
}

// Мышь, за которой гоняется кошка: маленькая, у самого пола, смотрит вправо, хвост слева.
const MOUSE: Part = [
  '...........kk.....',
  '..........kppk....',
  '......kkkkkppk....',
  '....kkmmmmmkkmk...',
  '...kmmmmmmmmmmmk..',
  '..kmmmmmmmmmkmmmk.',
  '..kmmmmmmmmmmmmmpk',
  '..knmmmmmmlllllkk.',
  '...kkkkkkkkkkkkk..',
];
/** Сидит и принюхивается: нос на пиксель выше. */
const MOUSE_SNIFF: Part = MOUSE.map((r, y) => (y === 5 ? '..kmmmmmmmmmkmmmpk' : y === 6 ? '..kmmmmmmmmmmmmmk.' : r));

/** Мышь бежит: тело подпрыгивает, лапки и хвост через кадр. */
const mouseRun = (up: boolean): Frame =>
  up
    ? compose([['pp...', '.ppp.', '....p'], 4, 24], [MOUSE, 8, 22], [['..kk......kk'], 8, 31])
    : compose([['p....', '.pp..', '...pp'], 4, 25], [MOUSE, 8, 23], [['....kk..kk'], 8, 31]);

/** Мышь сидит: тело на полу, хвост лежит. */
const mouseSit = (body: Part): Frame => compose([['p...', '.pp.', '...p'], 5, 28], [body, 8, 23]);

/** Клубок 8×8: нитки наискосок, кадр i сдвигает их — катится. */
const yarnBall = (i: number): Part =>
  ['..YYYY..', '.YyyyyY.', 'YyyyyyyY', 'YyyyyyyY', 'YyyyyyyY', 'YyyyyyyY', '.YyyyyY.', '..YYYY..'].map((r, y) =>
    [...r].map((c, x) => (c === 'y' && (x + y + i) % 4 === 0 ? 'Y' : c)).join(''),
  );

/** Клубок на полу посередине кадра, нитка тянется влево — нарисован катящимся вправо. */
const yarn = (i: number): Frame => compose([['...YY', 'YYY..'], 8, 30], [yarnBall(i), 12, 24]);

/** Позы мыши; кликов она не ловит — маска у её окна всегда пустая. */
export const MOUSE_ANIMS = {
  run: { ms: 90, frames: [mouseRun(true), mouseRun(false)] },
  sit: { ms: 400, frames: [mouseSit(MOUSE), mouseSit(MOUSE_SNIFF), mouseSit(MOUSE), mouseSit(MOUSE)] },
  // клубок в том же окне; кадр ему задаёт пройденный путь, а не время — `ms` на всякий случай
  yarn: { ms: 150, frames: [0, 1, 2, 3].map(yarn) },
} satisfies Record<string, Anim>;

// Лужа мести, нарисована попиксельно: растёт из капли, разливается с бликом и каплей сбоку,
// высыхает — бледнеет и сжимается. Лежит у нижнего края кадра посередине.
const PUDDLE_SMALL: Part = ['..AAAAAA..', 'AAaaWaaaAA', '.AAAAAAAA.'];
const PUDDLE_MID: Part = [
  '.....AAAAAAAA.....',
  '..AAAaaaWWaaaAAA..',
  '.AaaaaWWaaaaaaaaA.',
  'AaaaaaaaaaaaaaaaaA',
  '.AAAAAAAAAAAAAAAA.',
];
const PUDDLE_FULL: Part = [
  '.........AAAAAAAA...........',
  '.....AAAAaaaaaaaaAAAA.......',
  '..AAAaaaaWWWWaaaaaaaaAAA....',
  '.AaaaaaWWaaaaaaaaaaaaaaaA...',
  'AaaaaaaaaaaaaaaaaaaaaaaaA...',
  '.AAaaaaaaaaaaaaaaaaaaaAA.AA.',
  '...AAAAAAAAAAAAAAAAAAA..AAAA',
];
/** Высыхает: цвета бледнеют на ступень — блик и вода в бледное, край в воду (или тоже в бледное). */
const fade = (part: Part, edge: string): Part => part.map((r) => r.replace(/[aW]/g, 'e').replace(/A/g, edge));
/** Деталь лужи посередине кадра, низом в нижний ряд. */
const puddle = (part: Part): Frame => compose([part, 16 - Math.floor(part[0].length / 2), SIZE - part.length]);

/** Самая большая лужа в клетках: столько места ей нужно на окне. */
export const PUDDLE_W = PUDDLE_FULL[0].length;
export const PUDDLE_H = PUDDLE_FULL.length;
/** Кадры лужи: 0–2 растёт, 2 — разлилась, 3–4 высыхает. Кадр задаёт revenge.ts по времени. */
export const PUDDLE_FRAMES: Frame[] = [PUDDLE_SMALL, PUDDLE_MID, PUDDLE_FULL, fade(PUDDLE_FULL, 'a'), fade(PUDDLE_MID, 'e')].map(puddle);

/** Кадр окна лежака. */
export const bedFrame = (): Frame => compose([BED, 1, SIZE - BED.length]);

/** Маска окна лежака: в нём сам лежак и кликабелен. */
export const bedMask = (frame: Frame): number[] => hitMask(frame, DECOR);
