<script lang="ts">
  // Окно настроек. Кнопки «Сохранить» нет: каждое изменение сразу пишется на диск и уходит питомцу.
  // Поля те же, что в мастере первого запуска (SettingsFields), плюс смена папки данных.
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo } from '@tauri-apps/api/event';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { open } from '@tauri-apps/plugin-dialog';
  import { onMount, tick } from 'svelte';
  import { LANG_PREFS, t, type LangPref } from './lib/i18n';
  import { defaults, parse, serialize, type Settings } from './lib/settings';
  import { dirHint, errorText, isDriveRoot, pickDir, samePath } from './lib/setup';
  import NewsFeeds from './NewsFeeds.svelte';
  import SettingsFields from './SettingsFields.svelte';
  import { Button, Dialog, Group, Hint, Radio, Section, TextInput } from './ui';

  /** Сколько ждать, пока питомец допишет файлы перед переносом. Не ответил — переносим всё равно. */
  const FREEZE_WAIT_MS = 3000;
  /** Ключ TMDB сохраняем, когда человек перестал печатать: change приходит только по уходу с поля. */
  const KEY_SAVE_MS = 600;
  /** Сколько окно ждёт последнего сохранения при закрытии. Диск завис — закрываемся всё равно. */
  const CLOSE_WAIT_MS = 2000;

  // Свой listen, а не глобальный: глобальный ловит событие с этим именем для любого окна,
  // то есть и наш собственный emitTo('pet', 'settings').
  const win = getCurrentWebviewWindow();

  let settings = $state(defaults());
  /** Пока настройки не прочитаны, поля выключены: иначе первое касание затёрло бы файл умолчаниями. */
  let loaded = $state(false);
  let saveError = $state('');
  let saved = $state(false);

  let current = $state('');
  let suggested = $state<string[]>([]);
  let dir = $state('');
  let rootPicked = $state<string | null>(null);
  let keepRoot = $state<string | null>(null);
  let moving = $state(false);
  let moveError = $state('');
  let dirInput = $state<HTMLInputElement>();

  /** Сохранения по очереди: две быстрые галочки не должны прийти на диск в обратном порядке. */
  let queue: Promise<void> = Promise.resolve();
  /** Питомец успел прислать свои настройки раньше, чем дочитался файл, — они свежее. */
  let fromPet = false;
  /** Ключ печатают, а сохранение ещё не ушло. */
  let keyTimer: ReturnType<typeof setTimeout> | undefined;
  /** Язык, с которым программа запущена: выбрали другой — после сохранения перезапуск. */
  let startLang: LangPref | null = null;
  let relaunching = $state(false);

  /** Названия языков — каждый на себе: заблудившийся в чужом языке найдёт свой. */
  const LANG_NAMES: Record<LangPref, string> = { auto: '', ru: 'Русский', en: 'English' };

  onMount(() => {
    load();
    const off = win.listen<Settings>('settings', (e) => {
      fromPet = true;
      // галочка в меню кошки; ключ, который человек сейчас печатает, не стираем
      const draft = document.activeElement?.id === 'tmdb' ? settings.tmdbKey : null;
      Object.assign(settings, parse(serialize(e.payload)));
      if (draft !== null) settings.tmdbKey = draft;
    });
    // Закрыли окно, пока фокус в поле ключа: change уже не придёт — дописываем сами
    const offClose = win.onCloseRequested(async () => {
      if (keyTimer !== undefined) save();
      await Promise.race([queue, new Promise((r) => setTimeout(r, CLOSE_WAIT_MS))]);
    });
    return () => {
      off.then((f) => f());
      offClose.then((f) => f());
    };
  });

  async function load() {
    try {
      const [raw, dataDir] = await Promise.all([
        invoke<string | null>('load_state', { key: 'settings' }),
        invoke<string | null>('data_dir'),
      ]);
      if (!fromPet) Object.assign(settings, parse(raw));
      startLang = settings.lang;
      current = dataDir ?? '';
      loaded = true;
    } catch (e) {
      saveError = `${t('Не удалось прочитать настройки', "Couldn't read the settings")}: ${errorText(e)}`;
    }
    try {
      suggested = await invoke<string[]>('suggest_dirs');
    } catch {
      // без подсказок папку всё равно можно вписать или выбрать
    }
  }

  /** Любое поле поменялось (change всплывает из SettingsFields). Ключ TMDB приходит сюда по уходу с поля. */
  function changed() {
    settings.tmdbKey = settings.tmdbKey.trim();
    save();
  }

  /** Ключ печатают: сохранить, когда пальцы остановятся. Само поле не трогаем — каретка не прыгнет. */
  function typed(e: Event) {
    if ((e.target as HTMLElement | null)?.id !== 'tmdb') return;
    clearTimeout(keyTimer);
    keyTimer = setTimeout(save, KEY_SAVE_MS);
  }

  function save() {
    clearTimeout(keyTimer);
    keyTimer = undefined;
    const s: Settings = { ...$state.snapshot(settings), tmdbKey: settings.tmdbKey.trim() };
    queue = queue.then(() => persist(s));
  }

  async function persist(s: Settings) {
    try {
      await invoke<void>('save_state', { key: 'settings', value: serialize(s) });
      await invoke<void>('set_capture_hidden', { hidden: s.hideFromCapture });
      await emitTo('pet', 'settings', s);
      saveError = '';
      saved = true;
    } catch (e) {
      saveError = `${t('Не удалось сохранить', "Couldn't save")}: ${errorText(e)}`;
      saved = false;
      return;
    }
    if (startLang !== null && s.lang !== startLang && !relaunching) {
      relaunching = true;
      await invoke<void>('relaunch').catch((e) => {
        relaunching = false;
        saveError = errorText(e);
      });
    }
  }

  function take(path: string) {
    ({ dir, root: rootPicked } = pickDir(path, keepRoot));
  }

  function useRoot() {
    if (rootPicked === null) return;
    keepRoot = rootPicked;
    dir = rootPicked;
    rootPicked = null;
  }

  async function browse() {
    moveError = '';
    try {
      const picked = await open({ directory: true, title: t('Новая папка для данных питомца', 'New folder for pet data'), defaultPath: dir || current || undefined });
      if (typeof picked === 'string') take(picked);
    } catch (e) {
      moveError = `${t('Не удалось открыть выбор папки', "Couldn't open the folder picker")}: ${errorText(e)}`;
    }
  }

  /** Попросить питомца дописать всё и замолчать; ждём ответа не дольше FREEZE_WAIT_MS. */
  async function freezePet() {
    let done = () => {};
    const frozen = new Promise<void>((r) => (done = r));
    let off: (() => void) | undefined;
    try {
      off = await win.listen('frozen', () => done());
      await emitTo('pet', 'freeze');
      await Promise.race([frozen, new Promise((r) => setTimeout(r, FREEZE_WAIT_MS))]);
    } catch (e) {
      console.error(e);
    } finally {
      off?.();
    }
  }

  async function refocus(el: HTMLElement | undefined) {
    await tick();
    el?.focus();
  }

  async function move() {
    if (moving) return;
    const path = dir.trim();
    moveError = '';
    if (!path) {
      moveError = t('Выбери новую папку.', 'Pick a new folder.');
      return refocus(dirInput);
    }
    // как в мастере: вписали корень руками — сначала показать подпапку, а не молча её создать
    if (isDriveRoot(path) && path !== keepRoot) return take(path);
    if (samePath(path, current)) {
      moveError = t('Данные уже лежат в этой папке.', 'The data is already in this folder.');
      return refocus(dirInput);
    }
    moving = true;
    // недопечатанный ключ — на диск до переезда, а не в старую папку посреди него
    if (keyTimer !== undefined) save();
    await queue;
    await freezePet();
    try {
      await invoke<void>('move_data_dir', { dir: path });
      // Успех: программа перезапускается сама, это окно закроется вместе с ней
    } catch (e) {
      emitTo('pet', 'thaw').catch(console.error);
      moveError = errorText(e);
      moving = false;
      await refocus(dirInput);
    }
  }
</script>

<Dialog title="DeskRat" busy={moving || relaunching}>
  {#snippet header()}
    <h1>{t('Настройки', 'Settings')}</h1>
  {/snippet}

  <!-- change всплывает от любого поля: так автосохранению не нужно знать, какие поля есть.
       input — только ради ключа TMDB, см. typed -->
  <div onchange={changed} oninput={typed}>
    <Section title={t('Язык · Language', 'Language · Язык')}>
      <Group legend={t('Язык интерфейса', 'Interface language')}>
        {#each LANG_PREFS as l}
          <Radio name="lang" value={l} bind:group={settings.lang} disabled={!loaded || moving || relaunching}>
            {LANG_NAMES[l] || t('Как в Windows', 'Same as Windows')}
          </Radio>
        {/each}
      </Group>
      <Hint>
        {relaunching
          ? t('Перезапускаемся…', 'Restarting…')
          : t('Питомец перезапустится на выбранном языке.', 'The pet restarts in the chosen language.')}
      </Hint>
    </Section>

    <Section title={t('Питомец и темы', 'Pet and topics')} rule>
      <SettingsFields bind:settings part="pet" disabled={!loaded || moving} />
    </Section>

    <Section title={t('Главные галочки', 'Main switches')} rule>
      <SettingsFields bind:settings part="toggles" disabled={!loaded || moving} />
    </Section>
  </div>

  {#if saveError}
    <Hint tone="error">{saveError}</Hint>
  {/if}

  <Section title={t('Новости', 'News')} rule>
    <NewsFeeds />
  </Section>

  <Section title={t('Папка данных', 'Data folder')} rule>
    <p>
      {t('Сейчас', 'Now')}: <span class="ui-mono">{current || t('не выбрана', 'not chosen')}</span>
    </p>

    {#if suggested.length}
      <Group legend={t('Предлагаем', 'Suggested')}>
        {#each suggested as s, i}
          <Radio
            name="dir"
            value={s}
            bind:group={dir}
            onchange={() => take(s)}
            disabled={moving}
            hint="{dirHint(i, suggested.length, s)}{samePath(s, current) ? t(' — сейчас здесь', ' (current)') : ''}"
          >
            <span class="ui-mono">{s}</span>
          </Radio>
        {/each}
      </Group>
    {/if}

    <TextInput
      id="dir"
      label={t('Новая папка', 'New folder')}
      bind:el={dirInput}
      bind:value={dir}
      onchange={() => take(dir)}
      mono
      spellcheck="false"
      autocomplete="off"
      placeholder={t('Например, E:\\DeskRat', 'For example, E:\\DeskRat')}
      aria-describedby="move-how"
      disabled={moving}
    >
      <Button onclick={browse} disabled={moving}>{t('Обзор…', 'Browse…')}</Button>
    </TextInput>

    {#if rootPicked}
      <Hint tone="note" role="status">
        <span
          >{t(`Это корень диска ${rootPicked} — сложим всё в отдельную папку`, `${rootPicked} is a drive root, so everything goes into its own folder`)}
          <span class="ui-mono">{dir}</span>.</span
        >
        <Button variant="link" onclick={useRoot}>{t('Нет, прямо в корень', 'No, right in the root')}</Button>
      </Hint>
    {/if}

    <Hint id="move-how">
      {t(
        'Данные переедут в новую папку, и питомец перезапустится. Если там уже лежат данные питомца, будут использованы они, а не нынешние.',
        "The data moves to the new folder and the pet restarts. If that folder already has pet data, that data is used instead of the current one.",
      )}
    </Hint>

    <Button variant="primary" onclick={move} disabled={moving} aria-describedby="move-how">
      {moving ? t('Переносим…', 'Moving…') : t('Перенести', 'Move')}
    </Button>

    {#if moveError}
      <Hint tone="error">{moveError}</Hint>
    {/if}
  </Section>

  {#snippet footer()}
    <span class="saved" role="status">
      {saved ? t('Сохранено.', 'Saved.') : t('Изменения сохраняются сразу.', 'Changes are saved right away.')}
    </span>
  {/snippet}
</Dialog>

<style>
  .saved {
    color: var(--ui-muted);
  }
</style>
