// Персонаж 32×32. Все позы — Пенни.
// Кадры собираются из общих головы, тела, лап и хвоста.
// Все позы смотрят вправо; влево — `flip`.

export const SIZE = 32;

/** Кадр: SIZE строк по SIZE символов, символ — ключ палитры, '.' — пусто. */
export type Frame = string[];

/** Деталь: строки любой длины, '.' не закрашивает то, что под ней. */
type Part = string[];

export const PALETTE: Record<string, string> = {
  // Шерсть и кожа Пенни; ниже — цвета глаз, предметов и эффектов.
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
  j: '#c98d4b', // лакомство в лапках: не относится к кликам по миске
  J: '#8a5a2b',
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

/** Сезонный жирок: 0 — лето, 2 — зима. */
export type Fat = 0 | 1 | 2;
export const FATS: Fat[] = [0, 1, 2];

/** Кошка начинает толстеть в ноябре, к декабрю набирает полностью и худеет к апрелю. */
export function fatOn(date: Date): Fat {
  const m = date.getMonth();
  if (m === 11 || m <= 1) return 2;
  return m === 10 || m === 2 ? 1 : 0;
}

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

const SPREAD: [number, boolean][] = [[-1, false], [1, false], [-1, false], [1, false]];
const LIFT_A: [number, boolean][] = [[0, true], [0, false], [0, false], [0, true]];
const LIFT_B: [number, boolean][] = [[0, false], [0, true], [0, true], [0, false]];

const STAR: Part = ['.s.', 'sss', '.s.'];

// Пыль из-под передних лап на заносе: клубок то поменьше, то побольше.
const DUST_SMALL: Part = ['.u.', 'uuu'];
const DUST_BIG: Part = ['..u..', '.uuu.', 'uuuuu'];

/** Точка переноса остаётся в центре верхнего ряда, независимо от направления. */
export const SCRUFF_AT: [number, number] = [16, 0.5];

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

function pennyStanding(fat: Fat, shut: boolean, sway: boolean, step: [number, boolean][] = [], lift = 0): Frame {
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
    [head, 20, 19 - lift],
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

function pennySitting(fat: Fat, shut: boolean, sway: boolean, lean = false): Frame {
  // Непосредственная сетка верхней левой крыски со стикерного референса.
  // Голова и плечи здесь принадлежат самой сидячей позе, без растяжения шеи.
  const body = PENNY_SIT_REFERENCE.map((row, y) => {
    const start = row.search(/[FL]/);
    return y >= 4 && start >= 0 ? row.slice(0, start) + 'F'.repeat(fat) + row.slice(start) : row;
  });
  const g = body.map((row, y) => [...((lean && y < 4 ? '.' : '') + row).padEnd(14, '.')]);
  for (const [x, y] of [[7, 0], [8, 0], [8, 1], [9, 1], [8, 2]]) g[y][x + Number(lean)] = 'D';
  g[1][7 + Number(lean)] = shut ? 'L' : 'k';
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
    [g.map((row) => row.join('')), 13, 18], [PENNY_PATCH, 14, 28], [PENNY_SIT_EAR, 15 + Number(lean), 16]);
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


type SidePose = 'jump' | 'run' | 'crouch' | 'skid' | 'bonk' | 'fall' | 'angry' | 'squat';
type Point = [number, number];

/** Наклон вниз без нового рисунка мордочки — для сна носом в лапках. */
const turnDown = (part: Part): Part => Array.from({ length: part[0].length }, (_, x) =>
  part.map((row) => row[x]).reverse().join(''));

/** Тонкая непрерывная линия: хвост и согнутые конечности не распадаются на точки. */
function stroke(points: Point[], color: string): Frame {
  const g = compose().map((row) => [...row]);
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let n = 0; n <= steps; n++) {
      const t = steps ? n / steps : 0;
      const x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
      if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) g[y][x] = color;
    }
  }
  return g.map((row) => row.join(''));
}

/** Общая голова референса: меняются только веки и рот, не форма уха или морды. */
function pennyExpression(shut: boolean, mouth: boolean, angry = false): Part {
  const head = pennyHead(shut).map((row) => [...row]);
  if (angry) head[3][4] = 'v';
  if (mouth) { head[6][7] = 'P'; head[6][8] = 'p'; }
  return head.map((row) => row.join(''));
}

/** Круп из принятой стоячей позы, без головы, хвоста и отдельных лап. */
function pennyMovingBody(fat: Fat): Part {
  const body = PENNY_REFERENCE.slice(2, 10).map((row) => pennyFur(row.slice(11, 26))
    .replace(/[pP]/g, 'F'));
  // Клетки за пределами крупа не становятся шерстью при отделении хвоста.
  body[4] = 'F' + body[4].slice(1);
  body[5] = '.' + body[5].slice(1);
  body[6] = '..' + body[6].slice(2);
  body[7] = '...' + body[7].slice(3);
  body.splice(4, 0, ...Array<string>(fat).fill(body[3]));
  return body;
}

/** Движение сохраняет габариты, голову и круп stand; работают лапы и тонкий хвост. */
function pennyMoving(fat: Fat, pose: SidePose, phase: boolean, shut = false): Frame {
  const low = pose === 'crouch' || pose === 'skid' || pose === 'bonk' || pose === 'squat';
  const airborne = pose === 'jump' || pose === 'fall' || (pose === 'run' && !phase);
  const dy = low ? 1 : airborne || pose === 'angry' ? -1 : 0;
  const hx = pose === 'bonk' || pose === 'skid' ? 19 : 20;
  const hy = 19 + (pose === 'fall' ? 0 : dy);
  let back: Point = [13, 31], front: Point = [23, 31];
  if (pose === 'jump' || (pose === 'run' && !phase)) { back = [11, phase ? 29 : 30]; front = [26, phase ? 30 : 29]; }
  if (pose === 'run' && phase) { back = [16, 30]; front = [21, 30]; }
  if (pose === 'crouch') back = [phase ? 12 : 13, 31];
  if (pose === 'skid') front = [26, 31];
  if (pose === 'fall') { back = [phase ? 11 : 13, 31]; front = [phase ? 25 : 23, 31]; }
  if (pose === 'angry') front = [25, phase ? 28 : 29];
  const limb = (joint: Point, toe: Point): [Part, number, number][] => [
    [stroke([joint, [toe[0], toe[1] - 1]], 'L'), 0, 0],
    [PENNY_PAW, toe[0] - 1, toe[1] - 1],
  ];
  const tailY = 26 + dy;
  const tipY = pose === 'squat' ? 24 : airborne ? 28 + Number(phase) : 31;
  return compose(
    [stroke([[11, tailY], [9, tailY + 1], [6, Math.min(30, tailY + 2)], [3, tipY], [2, tipY]], 'P'), 0, 0],
    [stroke([[10, tailY + 1], [7, Math.min(30, tailY + 2)], [3, tipY], [2, tipY]], 'p'), 0, 0],
    [pennyMovingBody(fat), 9, 21 - fat + dy],
    [['v', 'F', 'F', 'F', 'F'], hx, 21 + dy],
    [PENNY_PATCH, 10, 24 + dy],
    ...limb([14, 27 + dy], back), ...limb([23, 27 + dy], front),
    [pennyExpression(shut || pose === 'bonk', pose === 'fall' || pose === 'angry', pose === 'angry'), hx, hy],
    ...(pose === 'bonk' ? [[STAR, phase ? 25 : 27, 9], [STAR, phase ? 28 : 24, 13]] as [Part, number, number][] : []),
    ...(pose === 'skid' ? [[phase ? DUST_BIG : DUST_SMALL, 26, phase ? 28 : 29]] as [Part, number, number][] : []),
  );
}

/** Виляет тонким хвостиком; место крепления и принятый корпус остаются неподвижными. */
function pennyWag(frame: Frame, root: Point, phase: number): Frame {
  const [rx, ry] = root;
  const offset = [0, -2, 0, 2][phase % 4];
  const clean = frame.map((row, y) => [...row].map((c, x) =>
    x < rx && y >= ry - 3 && (c === 'p' || c === 'P') ? '.' : c).join(''));
  const points: Point[] = [root, [rx - 2, ry], [rx - 5, Math.min(31, ry - 1 + offset / 2)], [rx - 8, ry - 2 + offset], [2, ry - 2 + offset]];
  return compose([stroke(points, 'P'), 0, 0], [stroke(points.slice(1), 'p'), 0, 0], [clean, 0, 0]);
}

/** Спокойные сидячие реакции сохраняют принятую сетку sit, включая обе отметины. */
function pennySeated(fat: Fat, phase: boolean, action: 'petted' | 'groggy' | 'smug' | 'lick' | 'pose' | 'crunch' | 'cake' | 'groom' | 'hungry', index = 0): Frame {
  const shut = ['petted', 'smug', 'lick', 'groom', 'crunch'].includes(action) || (action === 'groggy' && index > 0 && index < 5) || (action === 'hungry' && index === 4);
  let frame = pennySitting(fat, shut, phase);
  if (action === 'smug' || action === 'petted') frame = pennyWag(frame, [12, 30], action === 'petted' ? index * 2 + 1 : index);
  const extras: [Part, number, number][] = [];
  if (action === 'petted') extras.push([HEART, 13, phase ? 4 : 5]);
  if (action === 'pose') {
    extras.push([['Pp'], 23, 21]);
    if (index === 1) extras.push([STAR, 3, 4], [STAR, 26, 6]);
  }
  if (action === 'groggy' && index === 4) extras.push([['Pp', '.P'], 23, 21]);
  if (action === 'lick') extras.push([['p'], index === 0 ? 24 : 23, index === 2 ? 20 : 21]);
  if (action === 'crunch') {
    // Держит у мордочки, а не роняет отдельный пиксель в воздухе.
    extras.push([stroke([[21, 26], [23, 24]], 'L'), 0, 0], [PENNY_PAW, 23, 23], [['P'], 23, 22],
      [['jJ', index === 1 || index === 2 ? '..' : 'Jj'], 24, 22], [['Pp'], 23, 21]);
  }
  if (action === 'groom') {
    // От груди к носу или уху: лапка остаётся соединённой с плечом.
    const at: Point = index < 3 ? [24, 21 + Number(phase)] : [18, 18 + Number(phase)];
    extras.push([stroke([[21, 26], [22, 24], at], 'L'), 0, 0], [PENNY_PAW, at[0] - 1, at[1]]);
    if (index < 3 && !phase) extras.push([['p'], 24, 21]);
  }
  if (action === 'hungry') {
    // Пенни приподнимает переднюю лапку, прося еду; без кошачьего открытого рта.
    if (index === 2) extras.push([stroke([[21, 26], [23, 24]], 'L'), 0, 0], [PENNY_PAW, 22, 23]);
    extras.push([BOWL, 0, SIZE - BOWL.length]);
  }
  if (action === 'cake') {
    // Тянется к угощению той же передней лапкой, не меняя посадку.
    if (index === 1 || index === 2) extras.push([stroke([[21, 26], [24, 27]], 'L'), 0, 0], [PENNY_PAW, 23, 26 + Number(phase)]);
    extras.push([CAKE, 24, 24]);
  }
  frame = compose([frame, 0, 0], ...extras);
  return frame;
}

/** Отдых на полу: та же спина и мордочка sleep, опора на y31 вместо y27. */
function pennyRest(fat: Fat, phase: boolean, pose: 'loaf' | 'sideLoaf' | 'faceplant' | 'sidePlant'): Frame {
  const tucked = pose === 'faceplant' || pose === 'sidePlant';
  const body = pennyBody(fat);
  body[body.length - 1] = '.vvvvvvvvvvvvvv..';
  if (phase && tucked) { body.unshift('......vvv........'); body[1] = '.....vFFFv.......'; }
  const head = pennyHead(tucked || phase);
  const frame = compose(
    pennyFloorTail(10, 29, phase), [body, 9, 32 - body.length], [PENNY_PATCH, 11, 27],
    [PENNY_PAW, 22, 30],
    // При опущенной мордочке шея закрыта корпусом и лапками, не обрезана краем кадра.
    [pose === 'faceplant' ? turnDown(head) : tucked ? head.slice(0, 8) : head, 20, pose === 'faceplant' ? 21 : tucked ? 24 : pose === 'loaf' ? 21 : 22],
    ...(tucked ? [[phase ? Z_BIG : Z_SMALL, 26, phase ? 10 : 15]] as [Part, number, number][] : []),
  );
  if (pose === 'faceplant') CROWNS.set(frame, [19, 21]);
  return frame;
}

/** Голова наклонена к миске; ширина миски и сдвиг на 11 клеток — контракт App. */
function pennyEating(fat: Fat, phase: boolean, blink: boolean): Frame {
  // Круп справа от миски: укорочена только середина спины, голова того же размера.
  const body = pennyBody(fat).map((row) => row.slice(0, 8) + row.slice(11));
  body[body.length - 1] = '.vvvvvvvvvvv..';
  const frame = compose(
    [stroke([[29, 27], [30, 29], [29, 30], [27, 31], [blink ? 23 : 24, 31]], 'P'), 0, 0],
    [body, 17, 32 - body.length], [PENNY_PATCH, 27, 26],
    [PENNY_PAW, 23, 30],
    [flip(pennyHead(true).slice(0, 8)), 11, phase ? 22 : 21],
    [KIBBLE, 11, SIZE - 7], [BOWL, 11, SIZE - 5],
  );
  CROWNS.set(frame, [11, phase ? 23 : 22]);
  return frame;
}

/** Единственный необходимый анфас — перенос; силуэт симметричен вокруг точки захвата. */
function pennyCarried(fat: Fat, shut: boolean, sway: boolean): Frame {
  const body = Array.from({ length: 13 }, (_, y) => {
    const half = (y < 2 ? 4 : y > 10 ? 4 : 5) + (y >= 2 ? fat : 0);
    return '.'.repeat(8 - half) + 'v' + (y > 9 ? 'L' : 'F').repeat(half * 2 - 2) + 'v' + '.'.repeat(8 - half);
  });
  const face: Part = [
    '...vvvvvv...', '..vFFFFFFv..', '.vFFFDDFFFv.', 'vFFFDDDDFFFv',
    shut ? 'vFFLFFFFLFFv' : 'vFFkFFFFkFFv', 'vFFFFFFFFFFv', '.vFFFppFFFv.', '..vvFFFFvv..', '....vvvv....',
  ];
  const frame = compose(
    [stroke([[15, 24], [15, 31]], 'P'), 0, 0], [stroke([[16, 24], [16, 31]], 'P'), 0, 0],
    [body, 8, 12], [['.vv.', 'vFFv', 'vFFv', 'vFFv', 'vFFv', 'vFFv'], 14, 0],
    [PENNY_SIT_EAR, 9, 3], [PENNY_SIT_EAR, 19, 3], [face, 10, 5],
    [PENNY_PAW, 10 - Number(sway), 25], [flip(compose([PENNY_PAW, 10 - Number(sway), 25])), 0, 0],
    [['L', 'P', 'p'], 10 - fat, 17], [['L', 'P', 'p'], 21 + fat, 17],
    [PENNY_PATCH, 14, 22],
  );
  CROWNS.set(frame, [10, 6]);
  return frame;
}

/** Привязка анфаса при переносе; остальные головы распознаются по общему уху. */
const CROWNS = new WeakMap<Frame, Point>();

/** Перед лежака закрывает нижнюю часть Пенни и пропускает клики в окно лежака. */
const inBed = (frame: Frame): Frame => compose([frame.slice(0, 31), 0, 1], [BED_FRONT, 1, SIZE - BED_FRONT.length]);

function build(fat: Fat) {
  const repeat = (n: number, make: (index: number) => Frame) => Array.from({ length: n }, (_, i) => make(i));
  return {
    alert: { ms: 350, frames: [pennyStanding(fat, false, false, [], 1), pennyStanding(fat, false, true, [], 1)] },
    curious: { ms: 450, frames: repeat(5, (i) => pennySitting(fat, i === 4, i === 1 || i === 3, i === 1 || i === 3)) },
    stand: { ms: 500, frames: [pennyStanding(fat, false, false), pennyStanding(fat, false, true), pennyStanding(fat, false, false), pennyStanding(fat, true, false)] },
    walk: { ms: 150, frames: [pennyStanding(fat, false, false, SPREAD), pennyStanding(fat, false, true, LIFT_A), pennyStanding(fat, false, false, SPREAD), pennyStanding(fat, false, true, LIFT_B)] },
    jump: { ms: 200, frames: repeat(2, (i) => pennyMoving(fat, 'jump', !!i)) },
    run: { ms: 90, frames: repeat(2, (i) => pennyMoving(fat, 'run', !!i)) },
    crouch: { ms: 220, frames: repeat(2, (i) => pennyMoving(fat, 'crouch', !!i)) },
    skid: { ms: 100, frames: repeat(2, (i) => pennyMoving(fat, 'skid', !!i)) },
    bonk: { ms: 200, frames: repeat(2, (i) => pennyMoving(fat, 'bonk', !!i)) },
    fall: { ms: 150, frames: repeat(2, (i) => pennyMoving(fat, 'fall', !!i)) },
    sit: { ms: 600, frames: repeat(5, (i) => pennySitting(fat, i === 4, i === 1)) },
    loaf: { ms: 1000, frames: repeat(5, (i) => pennyRest(fat, i === 4, 'loaf')) },
    sideLoaf: { ms: 1000, frames: repeat(5, (i) => pennyRest(fat, i === 4, 'sideLoaf')) },
    sleep: { ms: 1500, frames: repeat(2, (i) => pennySleeping(fat, !!i)) },
    bed: { ms: 1500, frames: repeat(2, (i) => inBed(pennySleeping(fat, !!i))) },
    carried: { ms: 450, frames: repeat(4, (i) => pennyCarried(fat, i === 3, i === 1)) },
    faceplant: { ms: 1500, frames: repeat(2, (i) => pennyRest(fat, !!i, 'faceplant')) },
    sidePlant: { ms: 1500, frames: repeat(2, (i) => pennyRest(fat, !!i, 'sidePlant')) },
    hungry: { ms: 600, frames: repeat(5, (i) => pennySeated(fat, i === 2, 'hungry', i)) },
    eat: { ms: 300, frames: repeat(4, (i) => pennyEating(fat, !!(i % 2), i > 1)) },
    groom: { ms: 350, frames: repeat(6, (i) => pennySeated(fat, !!(i % 2), 'groom', i)) },
    petted: { ms: 400, frames: repeat(2, (i) => pennySeated(fat, !!i, 'petted', i)) },
    groggy: { ms: 700, frames: repeat(6, (i) => pennySeated(fat, !!(i % 2), 'groggy', i)) },
    angry: { ms: 250, frames: repeat(4, (i) => pennyMoving(fat, 'angry', !!(i % 2), i === 3)) },
    squat: { ms: 500, frames: repeat(3, (i) => pennyMoving(fat, 'squat', !!i, i === 2)) },
    smug: { ms: 600, frames: repeat(4, (i) => pennySeated(fat, i === 3, 'smug', i)) },
    strut: { ms: 150, frames: [pennyStanding(fat, true, false, SPREAD), pennyStanding(fat, true, true, LIFT_A), pennyStanding(fat, true, false, SPREAD), pennyStanding(fat, true, true, LIFT_B)].map((frame, i) => pennyWag(frame, [10, 26], i)) },
    lick: { ms: 180, frames: repeat(4, (i) => pennySeated(fat, !!(i % 2), 'lick', i)) },
    pose: { ms: 500, frames: repeat(4, (i) => pennySeated(fat, false, 'pose', i)) },
    crunch: { ms: 220, frames: repeat(4, (i) => pennySeated(fat, !!(i % 2), 'crunch', i)) },
    cake: { ms: 450, frames: repeat(4, (i) => pennySeated(fat, i === 2, 'cake', i)) },
    zzz: { ms: 1100, frames: [compose([Z_SMALL, 14, 27]), compose([Z_SMALL, 15, 21]), compose([Z_BIG, 16, 14]), compose(), compose(), compose()] },
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

// Только непрозрачная часть уха: за головой во сне видна спина, а не пустота.
const PENNY_CROWN_ROW = 'PPPppP';
const OUTFITS: Record<Outfit, Part> = {
  hat: ['........kk..', '.......kIIk.', '......kHkk..', '.....kHHk...', '....kHHHHk..', '..kIIIIIIk..'],
  pumpkin: ['.....gk.....', '...kkgkkk...', '..koOoOook..', '..kOoOoOok..', '..kkkkkkkk..'],
};

/**
 * Надеть наряд: ищем общее ухо Пенни или явную привязку анфаса.
 * Позы без узнаваемой головы остаются как есть. Вход не трогает.
 */
export function dress(frame: Frame, outfit: Outfit | null): Frame {
  if (!outfit) return frame;
  const anchor = CROWNS.get(frame);
  const sitEar = frame.findIndex((row) => row.includes(PENNY_SIT_EAR[1]));
  const y = anchor?.[1] ?? (sitEar >= 0 ? sitEar - 1 : frame.findIndex((row) => row.includes(PENNY_CROWN_ROW)));
  if (y < 0) return frame;
  const x = anchor?.[0] ?? (sitEar >= 0 ? frame[sitEar].indexOf(PENNY_SIT_EAR[1]) - 2 : frame[y].indexOf(PENNY_CROWN_ROW) - 1);
  const part = OUTFITS[outfit];
  const g = frame.map((r) => [...r]);
  part.forEach((row, dy) => {
    const ty = y - part.length + dy;
    for (let dx = 0; dx < row.length; dx++)
      if (row[dx] !== '.' && ty >= 0 && ty < SIZE && x + dx >= 0 && x + dx < SIZE) g[ty][x + dx] = row[dx];
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
