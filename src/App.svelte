<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo, listen } from '@tauri-apps/api/event';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { cursorPosition } from '@tauri-apps/api/window';
  import { onMount } from 'svelte';
  import * as calls from './lib/call';
  import * as chatter from './lib/chatter';
  import { feedBowl, fresh, isHungry, load, refill, save, starve, step, takeOut, type Belly } from './lib/hunger';
  import * as mouse from './lib/mouse';
  import * as movie from './lib/movie';
  import { verdict, type Film, type Verdict } from './lib/reviews';
  import * as yarn from './lib/yarn';
  import * as revenge from './lib/revenge';
  import * as roam from './lib/roam';
  import * as summon from './lib/summon';
  import * as news from './lib/news';
  import { parse, serialize, TOPICS, type Chatter, type HunterArea, type Settings, type Topic } from './lib/settings';
  import * as sleepy from './lib/sleep';
  import * as tally from './lib/stats';
  import * as chrono from './lib/chrono';
  import * as holidays from './lib/holidays';
  import { ANIMS, BOWL_X, bowlLeft, draw, dress, fatOn, flip, ground, hitMask, onBowl, SCRUFF_AT, SIZE, type AnimName, type Frame } from './lib/sprite';
  import { memoryStore, open, tauriBackend, type Store } from './lib/store';
  import * as wiki from './lib/wiki';
  import { count, t } from './lib/i18n';

  const PETTED_MS = 1500;
  /** Поза отдыха держится от 2 до 5 минут, потом кошка может перелечь. */
  const REST_MIN_MS = 2 * 60_000;
  const REST_MAX_MS = 5 * 60_000;
  /** Позы отдыха с весами: чаще сидит, иногда буханкой анфас или боком. */
  const RESTS: [AnimName, number][] = [['sit', 2], ['loaf', 1], ['sideLoaf', 1]];
  /** Как засыпает: обычно калачиком, иногда уткнувшись головой в пол — анфас или боком. */
  const SLEEPS: [AnimName, number][] = [['sleep', 3], ['faceplant', 1], ['sidePlant', 1]];
  /** Разбудили, не доспала — засыпает на ходу, где стояла: носом в пол. */
  const DOZES: [AnimName, number][] = [['faceplant', 1], ['sidePlant', 1]];
  const GROOM_MS = 6000;
  /** Ест столько, потом умывается. */
  const EAT_MS = 8000;
  /** Сколько стоит со звёздочками, врезавшись в край окна на охоте. */
  const BONK_MS = 800;
  /**
   * Точку замечает не сразу: Ctrl+C с заминкой перед буквой зажигает указку на миг (laser.rs, HOLD),
   * и без задержки кошка срывалась через весь экран за вспышкой и шла обратно.
   */
  const DOT_NOTICE_MS = 500;
  /** Охотник: мышь пробегает раз в HUNT_MIN..HUNT_MAX мс, когда кошка свободна. */
  const HUNT_MIN = 15 * 60_000;
  const HUNT_MAX = 40 * 60_000;
  /** Клубок: раз в YARN_MIN..YARN_MAX мс, когда кошка свободна и мыши нет. */
  const YARN_MIN = 60 * 60_000;
  const YARN_MAX = 120 * 60_000;
  /** Вернулась из-за края за мышью — столько облизывается. */
  const LICK_MS = 3000;
  /** Экран был заблокирован хотя бы столько — после разблокировки радуется человеку. */
  const LOCK_JOY_MS = 30_000;
  /** Столько радуется: сердечко, как от ласки. */
  const JOY_MS = 3000;
  /**
   * Ввод на экране блокировки трекер не видит: после пароля человек для него «отошёл», пока не
   * тронет мышь (tracker.rs, IDLE_AFTER). Столько после разблокировки не скучаем.
   */
  const UNLOCK_GRACE_MS = 120_000;
  /** Снимают экран — столько позирует. */
  const POSE_MS = 4000;
  /** Очистили корзину — столько хрумкает. */
  const CRUNCH_MS = 3000;
  /** Праздник: столько сидит у тортика. */
  const CAKE_MS = 8000;
  /** От батареи устаёт во столько раз быстрее: бережёт заряд и спит чаще. */
  const BATTERY_TIRED = 1.5;
  /** Полки внутри окон перечитываются не чаще: детей у окон много, а мышь бегает долго. */
  const SHELVES_MS = 1000;
  /** Шаг движения: 25 раз в секунду — окно едет ровно, а Rust успевает его двигать. */
  const MOVE_MS = 40;
  /** Мониторы и окна перечитываются раз в секунду; пока кошка, миска или лежак на чужом окне — чаще: его могут потащить. */
  const WORLD_MS = 1000;
  const PERCH_WORLD_MS = 200;
  /** С такой вероятностью, сменив позу отдыха, кошка перебирается на другое место. */
  const WANDER = 0.5;
  /** Как часто спрашивать у Rust, что делает человек. Питомцу спешить некуда. */
  const SENSES_MS = 2000;
  /** Голод пишется на диск раз в минуту и на каждом событии: упадёт программа — потеряется не больше минуты. */
  const SAVE_MS = 60_000;
  /** Википедия не ответила — следующая попытка через час: факты не срочные. */
  const WIKI_RETRY_MS = 60 * 60_000;
  /** Новостей нет (лента ещё не скачана, нет сети) — спросить снова через столько. */
  const NEWS_RETRY_MS = 10 * 60_000;
  /** Новость старше — уже не новость: отложенную до вечера выбрасываем и берём свежую. */
  const NEWS_STALE_S = 2 * 24 * 3600;
  /** Пока кошки нет на экране, проверять, не вернулась ли, раз в секунду. */
  const AWAY_TICK_MS = 1000;
  /** С лежаком засыпать уходит в него чаще, чем куда-то ещё. */
  const BED_SLEEP = 0.8;
  const NO_MASK: number[] = Array(SIZE).fill(0);

  /** Крайние столбцы «з-з-з»: из-за края экрана выглядывают только они, а не пустое окно. */
  const [Z_LEFT, Z_RIGHT] = ANIMS[0].zzz.frames.reduce(
    ([lo, hi], f) => {
      for (const row of f) for (let x = 0; x < SIZE; x++) if (row[x] !== '.') [lo, hi] = [Math.min(lo, x), Math.max(hi, x)];
      return [lo, hi];
    },
    [SIZE, -1],
  );

  /** Ответ команды `senses`; здесь только то, что уже нужно. */
  interface Senses {
    idle: boolean;
    typing: boolean;
    session_secs: number;
    active_today_secs: number;
    /** Только в Windows: почему сейчас лучше не мешать; 'no' — можно. */
    quiet?: string;
    /** Только в Windows: идёт ли видео (media.rs). */
    media?: { watching: boolean; title: string; loud: boolean };
    /** Программа в активном окне (имя, не заголовок): месть выбирает, мстить ли в её окно. */
    app?: string | null;
    /** Только в Windows: идёт созвон — занят микрофон или камера, или Zoom показывает экран. Месть тоже молчит. */
    call?: boolean;
    /** Только в Windows: ноутбук работает от батареи. */
    battery?: boolean;
  }

  /** Файлы в папке, выбранной на первом запуске; до открытия — память, чтобы не ловить null. */
  let store: Store = memoryStore();

  /** Где кошку оставили. Без места — появится у правого края, как в первый раз. */
  function loadSpot(): roam.Spot | null {
    try {
      const s = JSON.parse(store.get('spot') ?? 'null');
      if (!Number.isFinite(s?.x) || !Number.isFinite(s?.y)) return null;
      return { x: s.x, y: s.y, exit: s.exit === 1 || s.exit === -1 ? s.exit : 0 };
    } catch {
      return null;
    }
  }

  /** Где человек поставил миску или лежак. Без места — по углам основного монитора. */
  function loadPlace(key: 'bowl' | 'bed'): roam.Place | null {
    try {
      const p = JSON.parse(store.get(key) ?? 'null');
      return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? { x: p.x, y: p.y } : null;
    } catch {
      return null;
    }
  }

  /** Галочка «Кормушка»: из файла настроек, ПКМ-меню кошки или окна настроек. */
  let feederOn = false;
  /** Галочка «Лежак» — оттуда же. */
  let bedOn = false;
  let bowlPlace: roam.Place | null = null;
  let bedPlace: roam.Place | null = null;
  /** Миска или лежак упали: окно вещи покажет падение, а не прыгнет на место. */
  let bowlFall = false;
  let bedFall = false;
  /** Этот сон — в лежаке: пока спит, идёт к нему, куда бы его ни унесли. */
  let bedBound = false;
  /** Окно настроек переносит папку данных: до перезапуска ничего не пишем, иначе запись уйдёт мимо переезда. */
  let frozen = false;
  let belly: Belly = fresh();
  let nap: sleepy.Sleep = sleepy.fresh();
  /** Копится за всю жизнь программы (lib/stats); питомец сбежал — цифры остаются. */
  let stats = tally.fresh(Date.now());
  /** Покормили, а кошка не у миски: сначала дойдёт, потом ест. Корм тем временем лежит в миске. */
  let mealPending = false;
  let lastBowl = '';
  let lastBed = '';
  /** ЛКМ зажата на кошке: потянут — понесут, отпустят на месте — погладили. */
  let holding = false;
  /** Несут за шкирку: окно двигает Rust, мир кошку не трогает. */
  let carried = false;
  /** Разговорчивость из настроек и что кошка уже наговорила. */
  let chatterLevel: Chatter = 'sometimes';
  let talk: chatter.Talk = chatter.fresh(Date.now(), chatterLevel, Math.random);
  /** О чём рассказывать факты; пусто — фактов нет. */
  let topics: Topic[] = [];
  /** Имя из настроек: в облачках и шапке меню. */
  let petName = '';
  /** Факты «В этот день» по темам — вперёд встроенных; пусто, пока Википедия не ответила. */
  let wikiFacts: Partial<Record<Topic, string[]>> = {};
  /** За какой день wikiFacts; другой — пора спросить снова. */
  let wikiDay = '';
  /** Раньше этого не спрашиваем: идёт запрос или сети не было — ждём, а не долбим. */
  let wikiNext = 0;
  /**
   * Одна новость про запас, пока её не скажут: news_pick помечает выданное показанным, поэтому
   * берём по одной, а не пачкой. Идёт первой среди фактов своей темы.
   */
  let held: { topic: Topic; text: string; date: number; source: string } | null = null;
  /** На облачке сейчас новость — под ней лайк/диз; голос пойдёт ей. */
  let voteFor: { topic: Topic; source: string } | null = null;
  /** Раньше этого за новостью не ходим: запрос в пути или новостей не было. */
  let newsNext = 0;
  /** Облачко висит до этих пор; 0 — молчит. */
  let speakingUntil = 0;
  /** Облачко вызвано из трея dev-сборки: висит, даже если кошке не до разговоров. */
  let forced = false;
  /** Последний ответ `senses`; null — Rust ещё не ответил. */
  let senses: Senses | null = null;
  /** Прятки на созвоне: прячется сразу, выходит через calls.RETURN_MS тишины. */
  let hide: calls.Hide = calls.fresh();
  /** Макушка кошки над серединой силуэта, физ. px: сюда облачко ставит хвостик. */
  let head: { x: number; top: number } | null = null;

  let canvas: HTMLCanvasElement;
  let anim: AnimName | null = 'sit';
  let frame: Frame = [];
  let tick = 0;
  let pettedUntil = 0;
  let humanIdle = false;
  /** «Кино вместе»: сеанс, вердикт отзывов о нём и галочка «Подтягивать отзывы». */
  let film: movie.Movie = movie.fresh();
  let filmTitle = '';
  let filmVerdict: Verdict = 'unknown';
  let reviewsOn = false;
  /** Вердикты по названию: один фильм — один запрос за жизнь программы (Rust ещё и кэширует на диске). */
  const verdicts = new Map<string, Verdict>();
  /** За краем она спит от скуки на фильме, а не в обиде: громкая сцена может её позвать. */
  let filmNap = false;
  /** Монитор фильма на этот сеанс (movie.screen); null — сеанса нет или место ещё не выбрано. */
  let filmScreen: number | null = null;
  /** Выглянула на громкой сцене: дойдёт до края экрана — спросит, что пропустила. */
  let peekPending = false;
  let lastFilm = Date.now();
  let seenHuman = false;
  /** До этих пор позирует для снимка экрана. */
  let poseUntil = 0;
  /** До этих пор хрумкает содержимым корзины. */
  let crunchUntil = 0;
  /** До этих пор празднует у тортика. */
  let cakeUntil = 0;
  /** «Босс идёт» (Ctrl+Alt+Shift+H или трей): окна спрятаны Rust'ом, кошка молчит и не затевает игр. */
  let bossed = false;
  /** Когда заблокировали экран (Win+L); 0 — не заблокирован. */
  let lockedAt = 0;
  /** До этих пор простой после разблокировки не считается «отошёл». */
  let graceUntil = 0;
  let rest: AnimName = 'sit';
  let restUntil = 0;
  /** Поза сна выбирается при засыпании и держится до пробуждения. */
  let sleepPose: AnimName | null = null;
  let groomUntil = 0;
  let eatUntil = 0;
  /** Мониторы и окна-насесты; null — Rust их не дал (не Windows или ошибка), кошка стоит, где поставили. */
  let world: roam.World | null = null;
  let pet: roam.Pet | null = null;
  /** Лазерная точка, физ. px рабочего стола; null — лазер выключен. */
  let dot: roam.Dot | null = null;
  /** Когда точка зажглась; охота — только через DOT_NOTICE_MS. */
  let dotSince = 0;
  /** На прошлом шаге охотилась: бросила — снять охоту один раз. */
  let hunted = false;
  /** Врезалась — до этих пор ошалело стоит со звёздочками. */
  let bonkUntil = 0;
  /** Галочка «Охотник» и где бегает мышь. */
  let hunterOn = false;
  let hunterArea: HunterArea = 'taskbar';
  /** Погоня за мышью; null — мыши нет. */
  let hunt: mouse.Chase | null = null;
  let summoned: summon.Summon | null = null;
  let summonCursor: roam.Dot | null = null;
  let cursorReading = false;
  let cursorReadAt = 0;
  /** Когда пустить следующую мышь; кошка занята — мышь подождёт, пока освободится. */
  let nextHunt = 0;
  /** Мышь вызвана из трея dev-сборки: выбегает, как только кошка дома и не спит, — без ожидания безделья. */
  let huntNow = false;
  /** Галочка «Клубок»; игра с ним (null — нет); когда вынести следующий; вызван из трея dev-сборки. */
  let yarnOn = false;
  let game: yarn.Game | null = null;
  let nextYarn = 0;
  let yarnNow = false;
  /** Режим из настроек: месть — только в «Шалостях». */
  let mode = 'calm';
  /** Обида и перезарядка мести (revenge.ts); сама месть (null — нет); лужа на экране; месть из трея dev-сборки. */
  let grudge = revenge.fresh();
  let payback: revenge.Mission | null = null;
  let puddle: revenge.Puddle | null = null;
  let revengeNow = false;
  /** Самая важная программа дня по трекеру: спрашиваем, только пока кошка в обиде. */
  let topApp: string | null = null;
  let lastPuddle = '';
  /** Верхние кромки рамок внутри окон — полки для мыши на весь экран. */
  let shelves: roam.Ledge[] = [];
  let lastShelves = 0;
  let lastMouse = '';
  let lickUntil = 0;
  /** Вернулась из-за края — умывается, когда дойдёт до места. */
  let groomOnArrival = false;
  let surveying = false;
  let lastStep = Date.now();
  let lastMove = Date.now();
  let lastWorld = 0;
  let lastSave = 0;
  let lastMask = '';
  let lastPlace = '';
  let timer: ReturnType<typeof setTimeout>;

  function persist(now: number) {
    if (frozen) return;
    lastSave = now;
    store.set('belly', save(belly));
    store.set('sleep', sleepy.save(nap));
    store.set('stats', tally.save(stats));
    store.set('revenge', revenge.save(grudge));
    store.set('talk', chatter.save(talk));
    if (pet) store.set('spot', JSON.stringify(roam.spotOf(pet)));
    // окно-опору не храним: после перезапуска у окон другие hwnd — вещь найдёт рамку по точке
    if (bowlPlace) store.set('bowl', JSON.stringify({ x: Math.round(bowlPlace.x), y: Math.round(bowlPlace.y) }));
    if (bedPlace) store.set('bed', JSON.stringify({ x: Math.round(bedPlace.x), y: Math.round(bedPlace.y) }));
  }

  /** Где стоит вещь — в координаты окна для place_pet; мира нет — null, окно стоит, где стояло. */
  function windowAt(t: roam.Thing | null): { x: number | null; bottom: number | null } {
    return t ? { x: Math.round(t.x), bottom: Math.round(t.y) } : { x: null, bottom: null };
  }

  /** Вещь упала, а не уехала с окном: опустилась и стоит уже не на своём окне. */
  const fell = (was: roam.Place, now: roam.Thing): boolean =>
    now.y > was.y + 1 && !(was.hwnd != null && was.hwnd === now.hwnd);

  /** Мир сменился: вещи на рамках едут за окнами, а без окна под собой падают ниже. */
  function resettle() {
    if (!world) return;
    const bowl = bowlPlace && roam.bowlAt(world, bowlPlace);
    if (bowlPlace && bowl) [bowlFall, bowlPlace] = [bowlFall || fell(bowlPlace, bowl), bowl];
    const bed = bedPlace && roam.bedAt(world, bedPlace);
    if (bedPlace && bed) [bedFall, bedPlace] = [bedFall || fell(bedPlace, bed), bed];
  }

  /**
   * Окно миски рисует корм: запас кормушки (виден и при выключенной) и насыпанное, пока кошка идёт есть.
   * И встаёт, куда его поставили: место считаем здесь, тут же, где кошка к нему ходит.
   */
  function tellBowl() {
    const portions = belly.feeder + (mealPending ? 1 : 0);
    const at = windowAt(world && roam.bowlAt(world, bowlPlace));
    const fall = bowlFall;
    bowlFall = false;
    const key = `${portions} ${at.x} ${at.bottom}`;
    if (key === lastBowl) return;
    lastBowl = key;
    emitTo('bowl', 'bowl', { portions, ...at, fall }).catch(console.error);
  }

  /** Окно лежака: выключен — пустое и сквозное; включён — там, где поставили. */
  function tellBed() {
    const at = windowAt(world && roam.bedAt(world, bedPlace));
    const fall = bedFall;
    bedFall = false;
    const key = `${bedOn} ${at.x} ${at.bottom}`;
    if (key === lastBed) return;
    lastBed = key;
    emitTo('bed', 'bed', { on: bedOn, ...at, fall }).catch(console.error);
  }

  /** Миску или лежак перетащили и бросили: падает на ближайшую рамку окна под собой или на пол. */
  function putDown(thing: 'bowl' | 'bed', x: number, bottom: number) {
    const place = world && (thing === 'bowl' ? roam.bowlAt : roam.bedAt)(world, { x, y: bottom });
    if (place) {
      // окно вещи осталось там, где отпустили: оттуда и падает
      if (thing === 'bowl') [bowlPlace, bowlFall] = [place, true];
      else [bedPlace, bedFall] = [place, true];
      persist(Date.now());
    }
    // бросили туда же, откуда взяли, — ключ не сменился, а окно надо вернуть на опору
    lastBowl = lastBed = '';
    render();
  }

  /** Мира нет (не Windows, экран блокировки) — миска нарисована в кадре кошки, идти никуда не надо. */
  const atBowl = (): boolean => !pet || !world || roam.atBowl(pet, world, bowlPlace);

  /** К миске; у миски — мордой к ней, она справа. */
  function toBowl() {
    if (!pet || !world || pet.move === 'out' || away() || pet.hunt || revenge.owns(payback)) return;
    const b = roam.bowlAt(world, bowlPlace);
    if (!b) return;
    if (roam.atBowl(pet, world, bowlPlace)) pet = { ...pet, facing: -1 };
    else if (pet.goal?.surface !== b.surface || pet.goal.x !== b.x) pet = roam.goTo(pet, world, { surface: b.surface, x: b.x });
  }

  /** Еда в миске: у миски — ест сразу, иначе сначала идёт к ней. */
  function serve(now: number) {
    if (atBowl()) {
      toBowl();
      meal(now);
    } else {
      mealPending = true;
      toBowl();
    }
  }

  /**
   * Клик по миске — в окне кошки (поза hungry) или в отдельном окне миски. ПКМ забирает порцию из запаса.
   * С кормушкой ЛКМ досыпает порцию (кошка съест её сама, когда проголодается), без неё — кормит сейчас,
   * и сытой кошке не насыпают.
   */
  function bowlClick(button: number, now: number) {
    if (button === 2) {
      belly = takeOut(belly);
    } else if (feederOn) {
      belly = refill(belly);
      stats.fed++;
    } else {
      if (mealPending) return;
      const fed = feedBowl(belly);
      if (fed === belly) return;
      belly = fed;
      stats.fed++;
      serve(now);
    }
    persist(now);
    render();
  }

  function pick(options: [AnimName, number][]): AnimName {
    let r = Math.random() * options.reduce((sum, [, w]) => sum + w, 0);
    for (const [name, w] of options) if ((r -= w) < 0) return name;
    return options[0][0];
  }

  /** Поела — потом умывается. */
  function meal(now: number) {
    eatUntil = now + EAT_MS;
    groomUntil = eatUntil + GROOM_MS;
  }

  /** Кошке нечего делать на экране: ушла за едой, сбежала, досыпает в обиде или у человека созвон. */
  function away(): boolean {
    return belly.gone || belly.away > 0 || sleepy.mood(nap) === 'away' || onCall();
  }

  /**
   * У человека созвон: кошка за краем, молчит, не играет и не мстит — чтобы не спалить его на
   * демонстрации экрана. Сон и голод идут своим чередом: спящая уходит и досыпает там же.
   */
  function onCall(): boolean {
    return calls.onCall(hide);
  }

  /** Вернулась из-за края — выспавшейся или сытой, всё равно сначала умывается. */
  function comeBack(now: number) {
    // поела или простила, а созвон ещё идёт — выйдет, когда кончится (live: !away())
    if (onCall()) return;
    if (pet && world) {
      pet = roam.enter(pet, world);
      groomOnArrival = true;
    } else groomUntil = now + GROOM_MS;
  }

  /**
   * Идёт видео: сеанс засчитан или ещё копится (movie.START_MS). Уже в эти первые секунды не бродит
   * и не играет — иначе после перезапуска успевала уйти на другой монитор и шла обратно.
   */
  function filming(): boolean {
    return film.active || !!senses?.media?.watching;
  }

  /** Перебраться на другое место: посидеть у края пола или на окне, поспать — лучше на окне, а есть лежак — в нём. */
  function wander(kind: 'rest' | 'sleep') {
    if (!pet || !world || pet.move === 'out' || away() || pet.hunt || filming() || revenge.owns(payback)) return;
    const bed = kind === 'sleep' && bedOn && Math.random() < BED_SLEEP ? roam.bedAt(world, bedPlace) : null;
    bedBound = bed !== null;
    pet = roam.goTo(pet, world, bed ? { surface: bed.surface, x: bed.x } : roam.pickSpot(world, pet, kind, Math.random));
  }

  /** Смотрит кино: идёт в угол у края монитора с фильмом; уже там — сидит. */
  function toSeat() {
    if (!pet || !world || pet.move === 'out' || pet.hunt || bedBound) return;
    filmScreen = movie.screen(world, pet, filmScreen);
    const g = movie.seat(world, pet, filmScreen);
    if (movie.seated(pet, g)) return;
    if (pet.goal?.surface !== g.surface || pet.goal.x !== g.x) pet = roam.goTo(pet, world, g);
  }

  /**
   * Фильм по сигналу из Rust: сеанс начался — молчит и садится в угол; заскучала — уходит спать
   * за край; громкая сцена, пока она там от скуки, — выглядывает. Название уходит в сеть
   * только с галочкой «Подтягивать отзывы».
   */
  function watch(now: number, s: Senses) {
    const media = s.media;
    const dt = now - lastFilm;
    lastFilm = now;
    const title = media?.watching ? media.title : filmTitle;
    if (title !== filmTitle) {
      filmTitle = title;
      filmVerdict = 'unknown';
      if (film.active) askReviews(title);
    }
    const [next, event] = movie.step(film, dt, !!media?.watching, filmVerdict, Math.random);
    film = next;
    if (event === 'start') {
      stats.films++;
      if (speakingUntil) hush();
      askReviews(filmTitle);
    }
    if (event === 'doze' && sleepy.mood(nap) === 'awake' && !carried) {
      nap = sleepy.bored(nap);
      filmNap = true;
      persist(now);
    }
    if (event === 'end') {
      peekPending = false;
      filmScreen = null;
    }
    // уснула до фильма или в первые секунды сеанса — кино её будит, без обид; нудное — пусть спит
    if (film.active && filmVerdict !== 'dull' && sleepy.mood(nap) === 'asleep' && !carried) {
      nap = sleepy.stir(nap);
      sleepPose = null;
      persist(now);
    }
    // зовёт только ушедшую за край: по пути туда громкая сцена её не разворачивает
    if (film.active && media?.loud && filmNap && sleepy.mood(nap) === 'away' && pet?.move === 'out') {
      nap = sleepy.call(nap);
      film = movie.awake(film);
      filmNap = false;
      peekPending = true;
      persist(now);
    }
  }

  /** Скучный ли фильм: только с галочкой отзывов и известным названием; ответ кэшируется. */
  function askReviews(title: string) {
    if (!reviewsOn || !title) return;
    const known = verdicts.get(title);
    if (known) return void (filmVerdict = known);
    invoke<Film | null>('film_reviews', { title })
      .then((f) => {
        const v = verdict(f);
        verdicts.set(title, v);
        if (filmTitle === title) filmVerdict = v;
      })
      .catch((e) => console.warn(e));
  }

  /**
   * Уснула с мыслью о лежаке: лежак сдвинули, окно под ним уехало или пропало — идёт к нему заново,
   * а не засыпает там, где цель потерялась. Лежак выключили — спит, где стоит.
   */
  function toBed() {
    if (!pet || !world || pet.move === 'out' || away() || pet.hunt || revenge.owns(payback)) return;
    const b = bedOn ? roam.bedAt(world, bedPlace) : null;
    if (!b) return void (bedBound = false);
    if (roam.atBed(pet, world, bedPlace)) return;
    if (pet.goal?.surface !== b.surface || pet.goal.x !== b.x) pet = roam.goTo(pet, world, { surface: b.surface, x: b.x });
  }

  /**
   * Побудка кликом или тряской курсора. Бодрую не касается — тогда false, и клик просто гладит.
   * Выспавшаяся проснулась и умывается; не доспавшая вялая, злая, а на третий раз уходит за край.
   */
  function disturb(now: number): boolean {
    const [next, result] = sleepy.poke(nap);
    if (!result) return false;
    nap = next;
    sleepPose = null;
    // не доспавшая может затаить обиду (revenge.ts: шанс зависит от того, как разбудили)
    grudge = revenge.provoke(grudge, result, now, Math.random, mode);
    stats.woken++;
    if (result === 'wake') groomUntil = now + GROOM_MS;
    // 'leave' — за край она уйдёт сама: это заметит live()
    persist(now);
    return true;
  }

  /** Во сколько раз быстрее копится усталость. */
  /** Во сколько раз быстрее устаёт: от батареи и в «не свои» по хронотипу часы. */
  function tired(): number {
    return (senses?.battery ? BATTERY_TIRED : 1) * chrono.tired(stats.hours, new Date().getHours());
  }

  /** Голод и сон живут по времени работы программы; их события превращаются в позы. */
  function live(now: number) {
    const dt = now - lastStep;
    lastStep = now;
    const [next, event] = step(belly, dt);
    belly = next;
    if (event === 'gone') stats.runaways++;
    stats = tally.tick(stats, dt, !away(), film.active, humanIdle ? -1 : new Date(now).getHours());
    if (event === 'eat') serve(now);
    // поела где-то там
    if (event === 'return') comeBack(now);

    // пока смотрит кино, сама не устаёт: когда уснуть на фильме, решает movie.ts. Видео уже
    // играет, но сеанс ещё не засчитан (START_MS) — тоже: иначе успеет уйти спать на лежак
    const watching = filming() && sleepy.mood(nap) === 'awake';
    const [rested, mood] = watching ? [nap, null] : sleepy.step(nap, dt, humanIdle, tired());
    nap = rested;
    if (mood === 'sleep') {
      stats.naps++;
      sleepPose = pick(SLEEPS);
      wander('sleep');
    }
    if (mood === 'doze') sleepPose = pick(DOZES);
    // полный сон — не меньше NAP_MS, по кошачьим меркам долго: проснувшись, умывается
    if (mood === 'wake') groomUntil = now + GROOM_MS;
    if (mood === 'return') {
      comeBack(now);
      // выспалась за краем посреди фильма — досматривает
      if (filmNap) film = movie.awake(film);
      filmNap = false;
    }

    // Уход и возвращение сверяются с голодом и сном каждый кадр, а не только по событиям:
    // так их не потерять ни при запуске, ни при побудке, ни при «Новом котике».
    // несомую мир не двигает: уйти за край или к миске она успеет, когда отпустят
    if (pet && world && !carried && !summoned && !mouse.owns(hunt) && !yarn.owns(game) && !revenge.owns(payback)) {
      if (!away()) {
        if (pet.move === 'out') comeBack(now);
      } else if (pet.move !== 'out' && pet.exit === 0) pet = roam.leave(pet, world);
      // на полосе заголовка только спят: проснулась — слезает
      if (roam.onStrip(pet) && pet.move === 'still' && sleepy.mood(nap) !== 'asleep') wander('rest');
      // голодная и бодрая — идёт к миске; спящую голод не будит
      if ((isHungry(belly) || mealPending) && sleepy.mood(nap) === 'awake') toBowl();
      else if (film.active && sleepy.mood(nap) === 'awake' && !away()) toSeat();
      // разбудили — про лежак забыла до следующего сна
      if (bedBound && sleepy.mood(nap) === 'asleep') toBed();
      else bedBound = false;
    }

    if (event || mood || now - lastSave >= SAVE_MS) persist(now);
  }

  /**
   * Охотится, пока светит лазер, — бодрая и дома. Спящую точка не будит, едящую не отвлекает:
   * лазер — игра, а не побудка.
   */
  function hunting(now: number): boolean {
    return (
      dot !== null &&
      now - dotSince >= DOT_NOTICE_MS &&
      !!pet &&
      !!world &&
      pet.move !== 'out' &&
      !away() &&
      sleepy.mood(nap) === 'awake' &&
      now >= eatUntil
    );
  }

  /** Гоняться за мышью можно: охотник включён, кошка дома, бодрая, не ест, не в руках и лазер не светит. */
  function canHunt(now: number): boolean {
    return (
      mouse.ENABLED &&
      hunterOn &&
      !bossed &&
      !!pet &&
      !!world &&
      !carried &&
      !holding &&
      dot === null &&
      !filming() &&
      !away() &&
      sleepy.mood(nap) === 'awake' &&
      now >= eatUntil &&
      !revenge.owns(payback)
    );
  }

  /** Играть с клубком можно: как с мышью, только ещё и сытой — голодная идёт к миске, а не играет. */
  function canYarn(now: number): boolean {
    return (
      !summoned &&
      yarnOn &&
      !bossed &&
      !!pet &&
      !!world &&
      !carried &&
      !holding &&
      dot === null &&
      !filming() &&
      !away() &&
      sleepy.mood(nap) === 'awake' &&
      now >= eatUntil &&
      !isHungry(belly) &&
      !mealPending &&
      !revenge.owns(payback)
    );
  }

  /**
   * Мстить можно: дома, стоит, ни с кем не играет, не в руках, лазер не светит, не ест и не голодна.
   * Злая или вялая спросонья — тоже: так даже понятнее, за что.
   */
  function canRevenge(now: number): boolean {
    const mood = sleepy.mood(nap);
    return (
      !summoned &&
      !!pet &&
      !!world &&
      !carried &&
      !holding &&
      dot === null &&
      !away() &&
      pet.move === 'still' &&
      !pet.hunt &&
      !roam.onStrip(pet) &&
      !hunt &&
      !game &&
      // кино смотрят вместе: на сеансе не мстит
      !filming() &&
      now >= eatUntil &&
      !isHungry(belly) &&
      !mealPending &&
      (mood === 'awake' || mood === 'angry' || mood === 'groggy')
    );
  }

  /** Можно ли мстить сейчас: «Шалости» (или трей dev-сборки), «не мешать» нет, созвона нет. */
  const gate = (): revenge.Gate => ({ mode: revengeNow ? 'pranks' : mode, quiet: quietNow(), call: senses?.call });
  /** Мешать человеку можно вообще: лужа и начатая месть живут, только пока так. */
  const unbothered = (): boolean => revenge.allowed({ mode: 'pranks', quiet: quietNow(), call: senses?.call });
  /** Почему не мешать: спрятанная от босса кошка тоже не мешает. */
  const quietNow = (): string | undefined => (bossed ? 'boss' : senses?.quiet);

  /** Пустить мышь: кошка стоит без дела — не голодна, не умывается, не идёт спать в лежак. */
  function readyToHunt(now: number): boolean {
    return canHunt(now) && idle(now);
  }

  /** Вынести клубок: так же без дела, и мыши нет — у них одно окно. */
  function readyToYarn(now: number): boolean {
    return canYarn(now) && idle(now) && !hunt;
  }

  /** Стоит без дела: не голодна, не умывается, не идёт спать в лежак, не гладят. */
  function idle(now: number): boolean {
    return (
      !summoned &&
      pet!.move === 'still' &&
      !pet!.hunt &&
      !roam.onStrip(pet!) &&
      !isHungry(belly) &&
      !mealPending &&
      !bedBound &&
      now >= groomUntil &&
      now >= pettedUntil &&
      now >= poseUntil &&
      now >= crunchUntil &&
      now >= cakeUntil
    );
  }

  const huntGap = () => HUNT_MIN + Math.random() * (HUNT_MAX - HUNT_MIN);
  const yarnGap = () => YARN_MIN + Math.random() * (YARN_MAX - YARN_MIN);

  /** Мышь или клубок в окно "mouse": где и что делает; null — спрятать. Шлём только перемены. */
  function tellMouse() {
    const v = mouse.view(hunt) ?? yarn.view(game, world);
    const frame = v && 'frame' in v ? v.frame : undefined;
    const at = v && { x: Math.round(v.x), bottom: Math.round(v.y), anim: v.anim, facing: v.facing, frame };
    const key = at ? `${at.x} ${at.bottom} ${at.anim} ${at.facing} ${frame}` : '';
    if (key === lastMouse) return;
    lastMouse = key;
    emitTo('mouse', 'mouse', at).catch(console.error);
  }

  /** Лужа в окно "puddle": середина, низ и кадр; null — пусто. Шлём только перемены. */
  function tellPuddle(now: number) {
    const v = revenge.view(puddle, now);
    const key = v ? `${v.x} ${v.bottom} ${v.frame}` : '';
    if (key === lastPuddle) return;
    lastPuddle = key;
    emitTo('puddle', 'puddle', v).catch(console.error);
  }

  /** Поза на сейчас; null — кошки на экране нет. */
  function choose(now: number): AnimName | null {
    if (carried) return 'carried';
    if (summoned && pet) return summon.pose(summoned, pet);
    if (pet?.hunt) {
      if (now < bonkUntil || pet.hunt.mode === 'bonk') return 'bonk';
      if (pet.hunt.mode === 'skid') return 'skid';
      if (roam.isRunning(pet)) return 'run';
      if (pet.hunt.mode === 'crouch' && pet.move === 'still') return 'crouch';
      // прыжок на точку, падение с карниза — те же позы, что в пути; стоит в мёртвой зоне — следит
      return pet.move === 'still' ? 'stand' : pet.move === 'out' ? null : pet.move;
    }
    // месть: шипит, идёт, присаживается над лужей, довольна, уходит вразвалку
    if (pet && payback && revenge.owns(payback)) return revenge.pose(payback, pet);
    // за мышью за край — бегом, обратно — шагом; за краем её не видно
    if (pet && hunt && mouse.owns(hunt)) {
      if (pet.move === 'out') return null;
      if (pet.move === 'still') return 'stand';
      return hunt.phase === 'follow' && pet.move === 'walk' ? 'run' : pet.move;
    }
    // с клубком: припадает перед ударом, за укатившимся — бегом
    if (pet && game && yarn.owns(game)) {
      if (pet.move === 'out') return null;
      if (pet.move === 'still') return yarn.pose(game);
      return yarn.running(game) && pet.move === 'walk' ? 'run' : pet.move;
    }
    // в пути — только ходьба, прыжок или падение, чем бы ни была занята голова
    if (pet && pet.move !== 'still' && pet.move !== 'out') return pet.move;
    if (belly.gone || belly.away > 0) return null;
    // на созвоне за краем не видно ничего, даже «з-з-з»
    if (onCall()) return null;
    const mood = sleepy.mood(nap);
    // «з-з-з» — только из-за края; пока не дошла, идёт
    if (mood === 'away') return pet && pet.move !== 'out' ? 'walk' : 'zzz';
    if (now < pettedUntil) return 'petted';
    if (now < poseUntil) return 'pose';
    if (now < crunchUntil) return 'crunch';
    if (now < cakeUntil) return 'cake';
    if (now < lickUntil) return 'lick';
    if (now < eatUntil) return 'eat';
    if (mood === 'angry' || mood === 'groggy') return mood;
    if (mood === 'asleep') {
      if (bedOn && pet && world && roam.atBed(pet, world, bedPlace)) return 'bed';
      return pet && roam.onStrip(pet) ? 'sleep' : (sleepPose ??= pick(SLEEPS));
    }
    // проснулась голодной — сначала к миске, умыться успеет потом; не дошла — сидит и ждёт пути
    if (isHungry(belly) || mealPending) return atBowl() ? 'hungry' : 'sit';
    if (now < groomUntil) return 'groom';
    if (now >= restUntil) {
      rest = pick(RESTS);
      restUntil = now + REST_MIN_MS + Math.random() * (REST_MAX_MS - REST_MIN_MS);
      if (Math.random() < WANDER) wander('rest');
      if (pet?.move === 'walk') return 'walk';
    }
    return rest;
  }

  /**
   * Окно питомца — туда, где кошка: низ окна по линии, которой поза стоит на опоре.
   * «З-з-з» выглядывают из-за того края, за которым она спит, — на экране только буквы.
   */
  function place() {
    if (!pet || !world || carried) return;
    const m = roam.monitorOf(world, pet);
    if (!m) return;
    const half = roam.side(m) / 2;
    const cell = roam.side(m) / SIZE;
    let x = pet.x;
    // у миски окно кошки ложится так, чтобы миска в кадре совпала с окном миски: ест — наклоняется
    const bowl = roam.atBowl(pet, world, bowlPlace) ? bowlLeft(frame) : null;
    if (bowl !== null) x += (BOWL_X - bowl) * cell;
    if (anim === 'zzz') x = pet.exit < 0 ? m.work.left + half - Z_LEFT * cell : m.work.right + half - (Z_RIGHT + 1) * cell;
    const bottom = pet.y + (SIZE - 1 - (anim ? ground(anim) : SIZE - 1)) * cell;
    const at = { x: Math.round(x), bottom: Math.round(bottom) };
    const was = head;
    head = crown(at, cell);
    if (speakingUntil && head && (head.x !== was?.x || head.top !== was?.top)) invoke('bubble_at', head).catch(console.error);
    const key = `${at.x},${at.bottom}`;
    if (key === lastPlace) return;
    lastPlace = key;
    invoke('place_pet', at).catch(console.error);
  }

  /** Голову ищем в верхних строках силуэта: миска у лап в кадре середину не сдвинет. */
  const HEAD_ROWS = 8;

  /**
   * Макушка кошки в физ. px по окну с серединой `at.x` и низом `at.bottom`: над серединой
   * нарисованных клеток в верхних HEAD_ROWS строках. Пустой кадр — головы нет.
   */
  function crown(at: { x: number; bottom: number }, cell: number): { x: number; top: number } | null {
    const mask = hitMask(frame);
    const top = mask.findIndex((bits) => bits !== 0);
    if (top < 0) return null;
    let lo = SIZE;
    let hi = -1;
    for (const bits of mask.slice(top, top + HEAD_ROWS)) {
      for (let x = 0; x < SIZE; x++) {
        if (!(bits & (1 << x))) continue;
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
    return {
      x: Math.round(at.x - (SIZE * cell) / 2 + ((lo + hi + 1) / 2) * cell),
      top: Math.round(at.bottom - SIZE * cell + top * cell),
    };
  }

  /** Кошке есть когда поговорить: дома, бодрая, стоит, ни с кем не занята. */
  function free(): boolean {
    return (
      !summoned &&
      !!pet &&
      !!world &&
      !!anim &&
      !carried &&
      !holding &&
      !pet.hunt &&
      !mouse.owns(hunt) &&
      !yarn.owns(game) &&
      !revenge.owns(payback) &&
      pet.move === 'still' &&
      !away() &&
      sleepy.mood(nap) === 'awake'
    );
  }

  /** Облачко: убрать, когда пора или кошке стало не до него; сказать новое, когда chatter решит. */
  function chat(now: number) {
    if (speakingUntil) {
      if (now >= speakingUntil || (!free() && !forced)) hush();
      return;
    }
    if (frozen || !senses || !head || film.active) return;
    askWiki(now);
    askNews(now);
    const [next, line] = chatter.say(talk, moment(now, senses), chatterLevel, Math.random);
    talk = next;
    if (line) speak(line.text, now, held && line.text === held.text ? held : null);
  }

  function moment(now: number, s: Senses): chatter.Moment {
    return {
      now: new Date(now),
      pause: !s.idle && !s.typing && (s.quiet ?? 'no') === 'no',
      session: s.session_secs,
      today: s.active_today_secs,
      hungry: isHungry(belly) && !mealPending,
      free: free(),
      topics,
      name: petName,
      extra: held ? { ...wikiFacts, [held.topic]: [held.text, ...(wikiFacts[held.topic] ?? [])] } : wikiFacts,
    };
  }

  /**
   * Новость по темам: одна про запас. Сказали, тему сняли или новость устарела — берём следующую.
   * В рабочее время — только из рабочих тем: остальное chatter всё равно отложит до вечера.
   */
  function askNews(now: number) {
    const fresh = held && topics.includes(held.topic) && !talk.told.includes(held.text) && now / 1000 - held.date < NEWS_STALE_S;
    if (fresh) return;
    held = null;
    const work = chatter.isWork(new Date(now));
    const allowed = topics.filter((t) => !work || chatter.WORK_TOPICS.includes(t));
    if (!allowed.length || now < newsNext) return;
    newsNext = now + NEWS_RETRY_MS;
    news.pickNews(invoke, allowed, talk.weights).then((item) => {
      const topic = TOPICS.find((t) => t === item?.topic);
      if (item && topic) held = { topic, text: news.newsLine(item), date: item.date, source: item.source };
    });
  }

  /**
   * События дня из Википедии, раз в день (Rust кэширует ответ на диске). Тем не выбрано — в сеть
   * не ходим вовсе. Нет сети — молча живём на встроенном запасе и пробуем снова через час.
   */
  function askWiki(now: number) {
    const day = new Date(now).toDateString();
    if (!topics.length || day === wikiDay || now < wikiNext) return;
    wikiNext = now + WIKI_RETRY_MS;
    invoke<wiki.WikiEvent[]>('wiki_today')
      .then((events) => {
        wikiFacts = wiki.sort(events);
        wikiDay = day;
      })
      .catch((e) => console.warn(e));
  }

  /** Сказать `text`; `about` — это новость, под ней будут лайк/диз. */
  function speak(text: string, now: number, about: { topic: Topic; source: string } | null = null) {
    if (!head || bossed) return;
    speakingUntil = now + chatter.shownFor(text);
    voteFor = about && { topic: about.topic, source: about.source };
    invoke('say', { text, ...head, vote: !!about }).catch(console.error);
    stats.said++;
    persist(now);
  }

  /**
   * «Сказать что-нибудь» из трея dev-сборки: облачко сразу, мимо паузы, сроков, сна и молчуна.
   * Реплику выбирает тот же chatter.say — видно то, что кошка сказала бы сама.
   */
  function sayNow() {
    if (frozen || !senses || !head || away()) return;
    const now = Date.now();
    if (speakingUntil) hush();
    const m = { ...moment(now, senses), pause: true, free: true };
    const [next, line] = chatter.say({ ...talk, spoke: 0, next: 0 }, m, 'often', Math.random);
    if (!line) return;
    talk = next;
    forced = true;
    speak(line.text, now);
  }

  /**
   * «Новость» из трея dev-сборки: свежая по любой из тем, мимо сроков и рабочего времени.
   * Тем нет или ленты ещё не скачаны — так и говорит, чтобы было видно, что пункт сработал.
   */
  function newsNow() {
    if (frozen || !head || away()) return;
    const show = (text: string, about: { topic: Topic; source: string } | null = null) => {
      if (speakingUntil) hush();
      forced = true;
      speak(text, Date.now(), about);
    };
    if (!topics.length) return show(t('Тем не выбрано — новостей не будет.', 'No topics chosen, so no news.'));
    news.pickNews(invoke, topics, talk.weights).then((item) => {
      const topic = TOPICS.find((t) => t === item?.topic);
      if (!item || !topic) return show(t('Новостей пока нет: ленты ещё качаются.', 'No news yet: the feeds are still downloading.'));
      show(news.newsLine(item), { topic, source: item.source });
    });
  }

  function hush() {
    speakingUntil = 0;
    forced = false;
    voteFor = null;
    invoke('hush').catch(console.error);
  }

  /** Перечитать мониторы и окна. Пустой список (экран блокировки) — мира нет, кошка ждёт на месте. */
  async function survey() {
    if (surveying) return;
    surveying = true;
    lastWorld = Date.now();
    try {
      const w = await invoke<roam.World>('world');
      world = w.monitors.length ? w : null;
      // полки внутри окон нужны только мыши на весь экран
      if (hunt && hunterArea === 'screen' && lastWorld - lastShelves >= SHELVES_MS) {
        lastShelves = lastWorld;
        shelves = await invoke<roam.Ledge[]>('shelves').catch((e) => (console.error(e), shelves));
      }
      // миска и лежак на рамках едут за окнами тем же шагом, что и кошка на насесте
      resettle();
      tellBowl();
      tellBed();
    } catch (e) {
      console.error(e);
    } finally {
      surveying = false;
    }
  }

  /** Шаг по маршруту: идёт, прыгает, падает или едет на чужом окне — окно питомца следом. */
  function move() {
    const now = Date.now();
    const dt = now - lastMove;
    lastMove = now;
    if (!hunt && !game && pet && world && now >= nextHunt && (huntNow ? canHunt(now) && pet.move !== 'out' : readyToHunt(now))) {
      hunt = mouse.start(mouse.arena(world, hunterArea, shelves), now, Math.random);
      stats.mice++;
      huntNow = false;
      lastShelves = 0;
    }
    if (!game && !hunt && pet && world && now >= nextYarn && (yarnNow ? canYarn(now) && pet.move !== 'out' : readyToYarn(now))) {
      const started = yarn.start(world, pet, now);
      // внешних краёв нет — клубок выносить неоткуда, попробует в следующий раз
      if (started) {
        [game, pet] = started;
        stats.yarns++;
      } else nextYarn = now + yarnGap();
      yarnNow = false;
    }
    // месть: обижена, перезарядка прошла, человек в самой важной программе дня (или ждать надоело)
    if (!payback && pet && world && canRevenge(now) && revenge.ready(grudge, now, gate(), !!topApp && senses?.app === topApp)) {
      const started = revenge.start(world, pet, senses?.app, now);
      if (started) {
        [payback, pet] = started;
        stats.revenges++;
        grudge = revenge.begin(grudge, now);
        revengeNow = false;
        persist(now);
      }
    }
    const was = pet && `${pet.move} ${pet.hunt?.mode} ${summoned?.phase}`;
    // мышь бегает и пока кошку несут: погоню это прерывает, но мышь удирает своим ходом
    let ruled = false;
    let event: mouse.HuntEvent | null = null;
    if (summoned && pet && world) {
      if (!canSummon(now)) {
        summoned = null;
        pet = summon.halt(pet);
      } else {
        sampleSummonCursor(now);
        [summoned, pet, event] = summon.tick(summoned, world, pet, summonCursor, now, dt);
        ruled = true;
      }
    }
    if (hunt && pet && world) {
      const arena = mouse.arena(world, hunterArea, shelves);
      if (mouse.owns(hunt) && !canHunt(now)) {
        hunt = mouse.bolt(hunt, arena, pet, Math.random);
        pet = roam.endChase(pet);
      }
      ruled = mouse.owns(hunt);
      let e: mouse.HuntEvent | null;
      let p: roam.Pet;
      [hunt, p, e] = mouse.tick(hunt, arena, pet, now, dt, Math.random);
      // прерванная погоня кошку не трогает: ею дальше правит приложение
      if (ruled) [pet, event] = [p, e];
      if (e === 'lick') {
        lickUntil = now + LICK_MS;
        stats.caught++;
      }
      if (hunt.phase === 'done') {
        hunt = null;
        nextHunt = now + huntGap();
      }
    }
    // клубок так же: прервали — докатывается сам, кошкой дальше правит приложение
    if (game && pet && world) {
      if (yarn.owns(game) && !canYarn(now)) game = yarn.drop(game, now);
      const playing = yarn.owns(game);
      let e: roam.RoamEvent | null;
      let p: roam.Pet;
      [game, p, e] = yarn.tick(game, world, pet, now, dt, Math.random);
      if (playing) [pet, event, ruled] = [p, e, true];
      if (game.phase === 'done') {
        game = null;
        nextYarn = now + yarnGap();
      }
    }
    // месть так же: взяли на руки, лазер, ушла, «не мешать» или созвон — бросает, кошкой правит приложение
    if (payback && pet && world) {
      if (revenge.owns(payback) && (carried || dot !== null || away() || !unbothered())) payback = revenge.drop(payback);
      const acting = revenge.owns(payback);
      let e: roam.RoamEvent | null;
      let p: roam.Pet;
      let spilt: revenge.Puddle | null;
      [payback, p, e, spilt] = revenge.tick(payback, world, pet, now, dt, Math.random);
      if (acting) [pet, event, ruled] = [p, e, true];
      if (spilt) {
        puddle = spilt;
        stats.puddles++;
      }
      if (payback.phase === 'done') payback = null;
    }
    // лужа едет за своим окном и сохнет сама; «не мешать» или созвон — пропадает сразу
    if (puddle) {
      if (!unbothered()) puddle = null;
      else if (world) puddle = revenge.follow(puddle, world, now);
      if (puddle && revenge.gone(puddle, now)) puddle = null;
    }
    tellPuddle(now);
    tellMouse();
    if (pet && world && !carried) {
      if (ruled) {
        // кошку ведёт погоня
      } else if (dot && hunting(now)) {
        // отскочила от стены — дальше ошалело стоит со звёздочками, пока не придёт в себя
        if (now >= bonkUntil || pet.hunt?.mode === 'bonk') [pet, event] = roam.chase(pet, world, dot, dt);
        if (!hunted) stats.lasers++;
        hunted = true;
        if (event === 'bonk') bonkUntil = now + BONK_MS;
      } else {
        if (hunted) {
          hunted = false;
          bonkUntil = 0;
          pet = roam.endChase(pet);
        }
        [pet, event] = roam.step(pet, world, dt);
      }
      // занесло — всё под лапами отбрасывает по ходу (laser.rs, окно "push"), на экране по-настоящему ничего не двигается
      if (event === 'skid') invoke('skid', { x: pet.x, y: pet.y, dx: pet.facing, dy: 0 }).catch(console.error);
      if (event === 'arrived' && film.active && !mealPending) {
        const m = roam.monitorOf(world, pet);
        if (m) pet = { ...pet, facing: pet.x < (m.rect.left + m.rect.right) / 2 ? 1 : -1 };
        if (peekPending) {
          peekPending = false;
          speak(t('А? Что я пропустила?', 'Huh? What did I miss?'), now);
        }
      }
      if (event === 'arrived' && groomOnArrival) {
        groomOnArrival = false;
        groomUntil = now + GROOM_MS;
      }
      if (event === 'arrived' && roam.atBowl(pet, world, bowlPlace)) {
        pet = { ...pet, facing: -1 };
        if (mealPending) {
          mealPending = false;
          meal(now);
        }
      }
      // дошла, приземлилась или сорвалась — поза меняется сразу, не дожидаясь следующего кадра анимации
      // место — в хранилище на каждой остановке: перезапуск не должен уносить её в угол
      if (event === 'arrived' || event === 'gone') persist(now);
      if (`${pet.move} ${pet.hunt?.mode} ${summoned?.phase}` !== was) render();
      else place();
    }
    const perched = pet?.hwnd != null || bowlPlace?.hwnd != null || (bedOn && bedPlace?.hwnd != null);
    if (now - lastWorld >= (perched ? PERCH_WORLD_MS : WORLD_MS)) survey();
  }

  function render() {
    const now = Date.now();
    live(now);
    const next = choose(now);
    if (next !== anim) {
      anim = next;
      tick = 0;
    }
    // жирок по сегодняшней дате: если комп не выключали с октября, кошка всё равно потолстеет
    if (anim) {
      const { frames } = ANIMS[fatOn(new Date())][anim];
      // наряд по календарю: шапка, тыква — на любую позу с головой анфас
      const drawn = dress(frames[tick % frames.length], holidays.outfit(new Date()));
      // все позы нарисованы мордой вправо; «з-з-з» — буквы, их не зеркалят
      frame = pet?.facing === -1 && anim !== 'zzz' ? flip(drawn) : drawn;
      draw(canvas.getContext('2d')!, frame);
    } else {
      frame = [];
      canvas.getContext('2d')!.clearRect(0, 0, SIZE, SIZE);
    }
    // Rust пропускает клики сквозь всё, что не нарисовано, — сообщаем ему форму кадра, если она сменилась.
    // Кошку в пути не поймать: пока идёт, прыгает или падает, клики проходят насквозь.
    const mask = anim && (carried || !pet || pet.move === 'still') ? hitMask(frame) : NO_MASK;
    const key = mask.join(',');
    if (key !== lastMask) {
      lastMask = key;
      invoke('set_hit_mask', { rows: mask }).catch(console.error);
    }
    place();
    tellBowl();
    tellBed();
    if (speakingUntil && !free() && !forced) hush();
  }

  /** У каждой анимации свой темп, поэтому таймер заводится заново на каждый кадр. */
  function loop() {
    tick++;
    render();
    timer = setTimeout(loop, anim ? ANIMS[0][anim].ms : AWAY_TICK_MS);
  }

  /**
   * Клик по кошке гладит, по миске в её кадре — то же, что клик по окну миски.
   * Потянули с зажатой ЛКМ — берут за шкирку и несут; отпустили — падает на то, что под ней.
   * Пока ест, ЛКМ по ней ничего не делает.
   */
  async function poke(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * SIZE);
    const y = Math.floor(((e.clientY - r.top) / r.height) * SIZE);
    if (onBowl(frame, x, y)) return bowlClick(e.button, Date.now());
    if (e.button === 2) return void showMenu();
    if (e.button !== 0 || holding) return;
    // ест — не трогать: ни погладить, ни унести от миски недоевшей
    if (Date.now() < eatUntil) return;
    holding = true;
    // шкирка — в CSS px от угла окна: Rust подвинет окно так, чтобы она оказалась под курсором
    const cell = r.width / SIZE;
    const grab = [r.left + SCRUFF_AT[0] * cell, r.top + SCRUFF_AT[1] * cell];
    let drop: { x: number; bottom: number } | null = null;
    try {
      drop = await invoke<{ x: number; bottom: number } | null>('drag_window', { grab });
    } catch (err) {
      console.error(err);
    }
    holding = false;
    const now = Date.now();
    // drop без carried — drag-start обогнал ответ команды; окно всё равно уехало
    if (carried || drop) {
      carried = false;
      lastPlace = '';
      if (drop && pet && world) pet = roam.release(pet, world, drop.x, drop.bottom);
      // посреди фильма перенесли на другой монитор — значит, кино там
      if (film.active && pet && world) filmScreen = movie.petScreen(world, pet);
      lastMove = now;
      persist(now);
    } else if (!disturb(now)) {
      if (summoned) { summoned = null; if (pet) pet = summon.halt(pet); }
      pettedUntil = now + PETTED_MS;
      stats.petted++;
      // гладят без передышки — это уже тычки (revenge.PESTER_CLICKS)
      grudge = revenge.poked(grudge, now, Math.random, mode);
      talk = chatter.liked(talk, now);
    }
    render();
  }

  /** Rust сообщил, что кошку потянули: всё, чем была занята, бросает, спящая просыпается. */
  function pickUp() {
    if (!holding) return;
    carried = true;
    stats.carried++;
    eatUntil = groomUntil = pettedUntil = bonkUntil = 0;
    groomOnArrival = false;
    if (hunted && pet) pet = roam.endChase(pet);
    hunted = false;
    disturb(Date.now());
    render();
  }

  /** Настройки сменились здесь или в окне настроек — кошка и миска подстраиваются сразу. */
  function applySettings(s: Settings) {
    feederOn = s.feeder;
    bedOn = s.bed;
    // включили — первая мышь не сразу; выключили — мышь удерёт сама (move: canHunt)
    if (s.hunter && !hunterOn) nextHunt = Date.now() + huntGap();
    hunterOn = s.hunter;
    hunterArea = s.hunterArea;
    // клубок так же: включили — не сразу, выключили — укатится сам (move: canYarn)
    if (s.yarn && !yarnOn) nextYarn = Date.now() + yarnGap();
    yarnOn = s.yarn;
    mode = s.mode;
    topics = s.topics;
    // трей и его подсказка тоже зовут питомца по имени
    if (s.name !== petName) invoke('name_pet', { name: s.name }).catch(console.error);
    petName = s.name;
    reviewsOn = s.reviews;
    // ленты новых тем качаются сразу, а не когда кошка соберётся рассказать
    invoke('news_topics', { topics: [...topics] }).catch(console.error);
    if (s.chatter !== chatterLevel) {
      chatterLevel = s.chatter;
      talk = chatter.retime(talk, chatterLevel, Date.now(), Math.random);
    }
    invoke('set_capture_hidden', { hidden: s.hideFromCapture }).catch(console.error);
    tellBowl();
    tellBed();
  }

  /** Галочка в ПКМ-меню: сохранить, применить и показать открытому окну настроек. */
  function toggle(field: 'feeder' | 'bed' | 'hideFromCapture' | 'hunter' | 'hunterArea' | 'yarn') {
    if (frozen) return;
    const s = parse(store.get('settings'));
    if (field === 'hunterArea') s.hunterArea = s.hunterArea === 'screen' ? 'taskbar' : 'screen';
    else s[field] = !s[field];
    store.set('settings', serialize(s));
    applySettings(s);
    emitTo('settings', 'settings', s).catch(console.error);
  }

  function canSummon(now: number): boolean {
    return !frozen && !!pet && !!world && pet.move !== 'out' && !carried && !holding && !away() && !bossed &&
      !pet.hunt && !mouse.owns(hunt) && !yarn.owns(game) && !revenge.owns(payback) && dot === null &&
      sleepy.mood(nap) === 'awake' && now >= eatUntil && !isHungry(belly) && !mealPending;
  }

  /** Чтение курсора уже разрешено core:default. Только на время явного зова, без изменения курсора. */
  function sampleSummonCursor(now: number) {
    if (!summoned || summoned.phase === 'curious' || cursorReading || now - cursorReadAt < 200) return;
    cursorReading = true;
    cursorReadAt = now;
    const token = summoned.last;
    cursorPosition().then((position) => {
      if (summoned?.last === token) summonCursor = { x: position.x, y: position.y };
    }).catch(() => {
      // Без позиции курсора не выбираем выдуманную цель и не оставляем Пенни в ожидании.
      if (summoned?.last === token) { summoned = null; if (pet) pet = summon.halt(pet); render(); }
    }).finally(() => { cursorReading = false; });
  }

  function callPenny() {
    const now = Date.now();
    if (!canSummon(now) || summoned?.count === 3) return;
    summoned = summon.call(summoned, now);
    pet = summon.halt(pet!);
    summonCursor = null;
    cursorReadAt = 0;
    sampleSummonCursor(now);
    const hint = `${summoned.count}/3 · ${summoned.count === 1 ? t('услышала — позовите ещё', 'listening — call again') : t('повернулась — ещё раз', 'turned — once more')}`;
    emitTo('menu', 'penny-call-progress', { hint }).catch(console.error);
    if (summoned.count === 3) invoke('close_menu').catch(console.error);
    render();
  }

  /** ПКМ по кошке — своё меню (menu.rs): фокус у человека не забирает, выбор приходит событием menu-pick. */
  function showMenu() {
    const s = parse(store.get('settings'));
    const known = tally.days(stats.since, Date.now());
    const items = [
      // шапка с именем: назвали — ведёт в статистику, нет — в настройки, где имя и дают
      s.name
        ? { id: 'about', text: s.name, hint: t(`знакомы ${count(known, ['день', 'дня', 'дней'], ['day', 'days'])}`, `friends for ${count(known, ['день', 'дня', 'дней'], ['day', 'days'])}`) }
        : { id: 'about', text: t('Без имени', 'No name'), hint: t('назвать — в настройках', 'name her in settings') },
      { separator: true },
      { id: 'penny-call', text: t('Пенни!', 'Penny!'), hint: t('позовите три раза, затем укажите место курсором', 'call three times, then point with the cursor'), disabled: !canSummon(Date.now()) || summoned?.count === 3 },
      {
        id: 'feeder',
        text: t('Кормушка', 'Feeder'),
        checked: s.feeder,
        hint: s.feeder ? t('клик по миске — про запас', 'click the bowl to stock up') : t('клик по миске — покормить сейчас', 'click the bowl to feed now'),
      },
      { id: 'bed', text: t('Лежак', 'Bed'), checked: s.bed, hint: t('тащи мышью, как и миску', 'drag it like the bowl') },
      { id: 'hideFromCapture', text: t('Прятать от записи экрана', 'Hide from screen capture'), checked: s.hideFromCapture },
      { id: 'laser', text: t('Лазерная указка', 'Laser pointer'), checked: dot !== null, hint: t('или зажать Ctrl; Esc — выключить', 'or hold Ctrl; Esc turns it off') },
      ...(mouse.ENABLED ? [
        { id: 'hunter', text: t('Охотник', 'Hunter'), checked: s.hunter, hint: t('иногда пробегает мышь', 'a mouse runs by now and then') },
        { id: 'hunterArea', text: t('Мышь по всему экрану', 'Mouse on the whole screen'), checked: s.hunterArea === 'screen', hint: t('иначе — по панели задач', 'otherwise along the taskbar') },
      ] : []),
      { id: 'yarn', text: t('Клубок', 'Yarn'), checked: s.yarn, hint: t('раз в час-два катает по панели задач', 'rolls it along the taskbar every hour or two') },
      { separator: true },
      { id: 'stats', text: t('Статистика…', 'Stats…') },
      { id: 'settings', text: t('Настройки…', 'Settings…') },
    ];
    invoke('open_menu', { owner: 'pet', items }).catch(console.error);
  }

  function menuPick(id: string) {
    if (id === 'penny-call') callPenny();
    else if (id === 'feeder' || id === 'bed' || id === 'hideFromCapture' || id === 'hunter' || id === 'hunterArea' || id === 'yarn') toggle(id);
    else if (id === 'laser') invoke('set_laser', { on: dot === null }).catch(console.error);
    else if (id === 'settings') invoke('open_settings').catch(console.error);
    else if (id === 'stats') invoke('open_stats').catch(console.error);
    else if (id === 'about') invoke(petName ? 'open_stats' : 'open_settings').catch(console.error);
  }

  /** Разблокировали экран: спала, пока человека не было, — просыпается без обид и радуется. */
  function unlocked(now: number) {
    const long = now - lockedAt >= LOCK_JOY_MS;
    lockedAt = 0;
    graceUntil = now + UNLOCK_GRACE_MS;
    if (carried || sleepy.mood(nap) !== 'asleep') return;
    nap = sleepy.stir(nap);
    sleepPose = null;
    if (long) pettedUntil = now + JOY_MS;
    persist(now);
  }

  async function sense() {
    try {
      // До первого движения мыши трекер считает человека отошедшим, а сон липкий: без этого
      // кошка засыпала бы на NAP_MS прямо на старте. Скучать начинает, только увидев человека.
      senses = await invoke<Senses>('senses');
      seenHuman ||= !senses.idle;
      watch(Date.now(), senses);
      const locked = senses.quiet === 'away';
      if (locked && !lockedAt) lockedAt = Date.now();
      if (!locked && lockedAt) unlocked(Date.now());
      // заблокировал экран — точно отошёл, кошка засыпает сразу; за фильмом человек не трогает мышь — это не «отошёл»
      humanIdle = locked || (seenHuman && senses.idle && !film.active && Date.now() >= graceUntil);
      const hid = calls.onCall(hide);
      hide = calls.step(hide, senses.call ?? false, Date.now());
      if (calls.onCall(hide) && !hid) stats.calls++;
      // созвон начался — облачко убрать сразу, даже проверочное из трея
      if (onCall() && speakingUntil) hush();
      // важная программа дня нужна, только пока кошка в обиде
      if (revenge.holds(grudge, Date.now())) topApp = await invoke<string | null>('top_app');
    } catch (e) {
      console.error(e);
    }
    party(Date.now());
    chat(Date.now());
  }

  /** Тортик или годовщина: ждёт, пока кошка свободна, облачко пусто и человеку можно мешать. */
  function party(now: number) {
    if (bossed || speakingUntil || !free() || !unbothered()) return;
    const due = holidays.celebrate(stats, now);
    if (!due) return;
    [stats] = due;
    cakeUntil = now + CAKE_MS;
    speak(due[1], now);
    persist(now);
  }

  onMount(() => {
    let alive = true;
    let moving: ReturnType<typeof setInterval> | undefined;
    // Сначала память и мир, потом первый кадр: иначе кошка мелькнёт там, где окно поставил Rust, и перепрыгнет.
    // Ставим туда, где оставили; запустили, пока она в отлучке или в обиде, — она сразу за краем.
    // DeskRat starts with its own state; no DeskPartner legacy migration.
    Promise.all([open(tauriBackend(invoke)), survey()]).then(([opened]) => {
      if (!alive) return;
      store = opened;
      const settings = parse(store.get('settings'));
      feederOn = settings.feeder;
      bedOn = settings.bed;
      chatterLevel = settings.chatter;
      topics = settings.topics;
      reviewsOn = settings.reviews;
      hunterOn = settings.hunter;
      hunterArea = settings.hunterArea;
      nextHunt = Date.now() + huntGap();
      yarnOn = settings.yarn;
      nextYarn = Date.now() + yarnGap();
      mode = settings.mode;
      talk = chatter.load(store.get('talk'), Date.now(), chatterLevel, Math.random);
      bowlPlace = loadPlace('bowl');
      bedPlace = loadPlace('bed');
      // Rust создаёт окна спрятанными от записи экрана; выключил человек галочку — показываемся
      invoke('set_capture_hidden', { hidden: settings.hideFromCapture }).catch(console.error);
      belly = load(store.get('belly'));
      nap = sleepy.load(store.get('sleep'));
      stats = tally.load(store.get('stats'), Date.now());
      grudge = revenge.load(store.get('revenge'), Date.now());
      if (world) pet = roam.restore(world, loadSpot(), away());
      lastMove = Date.now();
      render();
      timer = setTimeout(loop, anim ? ANIMS[0][anim].ms : AWAY_TICK_MS);
      moving = setInterval(move, MOVE_MS);
    });
    sense();
    const id = setInterval(sense, SENSES_MS);
    // «Новый котик» в трее: только взамен сбежавшего, живую кошку не подменяет; статистика остаётся
    const unlisten = listen('adopt', () => {
      if (!belly.gone) return;
      belly = fresh();
      nap = sleepy.fresh();
      comeBack(Date.now());
      persist(Date.now());
      render();
    });
    // Rust заметил, что курсором трясут над кошкой: будит так же, как клик, но не гладит
    const unshake = listen('shake', () => {
      if (disturb(Date.now())) render();
    });
    const unclick = listen<{ button: number }>('bowl-click', (e) => bowlClick(e.payload.button, Date.now()));
    // окна миски и лежака открылись позже кошки — расскажем им всё ещё раз
    const unhello = listen('bowl-hello', () => {
      lastBowl = '';
      tellBowl();
    });
    const unbedHello = listen('bed-hello', () => {
      lastBed = '';
      tellBed();
    });
    const unbowlDrop = listen<{ x: number; bottom: number }>('bowl-drop', (e) => putDown('bowl', e.payload.x, e.payload.bottom));
    const unbedDrop = listen<{ x: number; bottom: number }>('bed-drop', (e) => putDown('bed', e.payload.x, e.payload.bottom));
    // лежак потащили из-под спящей кошки — будит, как клик
    const unbedGrab = listen('bed-grab', () => {
      if (pet && world && roam.atBed(pet, world, bedPlace) && disturb(Date.now())) render();
    });
    // «Позвать питомца» в трее. Досыпает за краем в обиде — прощает и приходит оттуда же
    // (вход сделает live()); ушедшую за едой и пропавшую зов не вернёт. Дома зов ничего не
    // делает: позвали дважды — не телепортируется; с отключённого монитора и так снимет roam.
    const uncall = listen('call', () => {
      if (sleepy.mood(nap) !== 'away') return;
      nap = sleepy.call(nap);
      sleepPose = null;
      persist(Date.now());
      render();
    });
    // пункт есть только в трее dev-сборки (lib.rs, debug_assertions)
    const unsay = listen('dev-say', sayNow);
    // «Проголодаться» оттуда же: к миске она пойдёт сама, как проголодавшаяся по часам, — спящая после пробуждения
    const unhungry = listen('dev-hungry', () => {
      belly = starve(belly);
      persist(Date.now());
      render();
    });
    // «Охотник» оттуда же: выключен — включает; мышь выбегает сразу, спящую кошку — дождётся
    const unhunter = listen('dev-hunter', () => {
      if (!mouse.ENABLED) return;
      if (!hunterOn) toggle('hunter');
      nextHunt = 0;
      huntNow = true;
    });
    // «Клубок» из трея dev-сборки: выключен — включает; выносит сразу, как кошка свободна
    const unyarn = listen('dev-yarn', () => {
      if (!yarnOn) toggle('yarn');
      nextYarn = 0;
      yarnNow = true;
    });
    const unnews = listen('dev-news', newsNow);
    // «Месть» оттуда же: обида сразу, мимо режима, шанса и перезарядки; «не мешать» и созвон — не мимо
    const unrevenge = listen('dev-revenge', () => {
      grudge = revenge.dare(grudge, Date.now());
      revengeNow = true;
    });
    // окно настроек уже сохранило файл; кеш обновляем, чтобы следующая галочка в меню не затёрла его старьём
    // Слушаем своим окном: глобальный listen поймал бы и наш же emitTo('settings', 'settings').
    const win = getCurrentWebviewWindow();
    const unsettings = win.listen<Settings>('settings', (e) => {
      if (frozen) return;
      const s = parse(serialize(e.payload));
      store.set('settings', serialize(s));
      applySettings(s);
    });
    // Перед переносом папки: дописать всё и замолчать. Удачный перенос перезапустит программу,
    // неудачный пришлёт thaw.
    const unfreeze = win.listen('freeze', async () => {
      persist(Date.now());
      frozen = true;
      await store.flush();
      emitTo('settings', 'frozen').catch(console.error);
    });
    const unthaw = win.listen('thaw', () => {
      frozen = false;
    });
    const unpick = win.listen<{ id: string }>('menu-pick', (e) => menuPick(e.payload.id));
    // окно «Статистика» спрашивает свежие цифры: в файле они догоняют только при сохранении
    const unstats = win.listen('stats-ask', () => emitTo('stats', 'stats', stats).catch(console.error));
    // своим окном: такое же событие Rust шлёт и окнам миски и лежака
    const undrag = win.listen('drag-start', pickUp);
    // лазер: Rust шлёт курсор, пока указка включена, — охоту ведёт move()
    const unlaser = win.listen<roam.Dot>('laser', (e) => {
      if (dot === null) dotSince = Date.now();
      dot = e.payload;
    });
    const unlaserOff = win.listen('laser-off', () => {
      dot = null;
    });
    // облачко смахнули кликом: окно уже спряталось само, кошка запоминает и болтает реже
    const unboss = win.listen<boolean>('boss', (e) => {
      bossed = e.payload;
      if (bossed && speakingUntil) hush();
    });
    // снимают экран: свободная кошка позирует; занятая своим делом не отвлекается
    const unshot = win.listen('shot', () => {
      if (!bossed && free()) poseUntil = Date.now() + POSE_MS;
    });
    // очистили корзину: свободная кошка хрумкает выброшенным
    const uncrunch = win.listen('crunch', () => {
      if (!bossed && free()) crunchUntil = Date.now() + CRUNCH_MS;
    });
    const unshoo = win.listen('bubble-shoo', () => {
      speakingUntil = 0;
      voteFor = null;
      // проверочное облачко смахнули — кошке не в укор
      if (forced) {
        forced = false;
        return;
      }
      talk = chatter.shoo(talk, chatterLevel, Math.random);
      persist(Date.now());
    });
    // лайк/диз под новостью: окно уже спряталось; тема и источник — чаще или реже, болтать реже не станет
    const unvote = win.listen<{ up: boolean }>('bubble-vote', (e) => {
      const about = voteFor;
      speakingUntil = 0;
      forced = false;
      voteFor = null;
      if (!about) return;
      talk = chatter.vote(talk, about.topic, e.payload.up);
      invoke('news_vote', { source: about.source, up: e.payload.up }).catch(console.error);
      persist(Date.now());
    });
    return () => {
      alive = false;
      persist(Date.now());
      clearTimeout(timer);
      clearInterval(moving);
      clearInterval(id);
      const offs = [unlisten, unshake, unclick, unhello, unbedHello, unbowlDrop, unbedDrop, unbedGrab, uncall, unsay, unhungry, unhunter, unyarn, unnews, unrevenge];
      for (const off of [...offs, unsettings, unfreeze, unthaw, unpick, unstats, undrag, unlaser, unlaserOff, unshoo, unvote, unboss, unshot, uncrunch]) off.then((f) => f());
    };
  });
</script>

<!-- Встроенное меню WebView2 («Назад», «Обновить», «Проверить») питомцу ни к чему; своё — в showMenu. -->
<svelte:window oncontextmenu={(e) => e.preventDefault()} />

<canvas bind:this={canvas} width={SIZE} height={SIZE} onpointerdown={poke}></canvas>

<style>
  /* Квадрат по центру окна: окно может оказаться шире спрайта (минимальная ширина окна в Windows),
     и тянуть кошку вслед за ним нельзя. Rust считает попадание курсора по той же геометрии. */
  canvas {
    position: absolute;
    inset: 0;
    margin: auto;
    width: min(100vw, 100vh);
    height: min(100vw, 100vh);
    image-rendering: pixelated;
  }
</style>
