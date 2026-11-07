<script lang="ts">
  // Поля настроек — одни и те же в мастере первого запуска (по шагу на part) и в окне настроек.
  // Вид — из src/ui; здесь только раскладка.
  import { t } from './lib/i18n';
  import { CHATTER, HUNTER_AREAS, MODES, NAME_MAX, TOPICS, suggestName, topicName, type Chatter, type HunterArea, type Mode, type Settings, type Topic } from './lib/settings';
  import { Button, Check, Group, Hint, Radio, TextInput } from './ui';

  interface Props {
    settings: Settings;
    /** 'pet' — питомец и темы, 'toggles' — галочки, режим и разговорчивость. */
    part: 'pet' | 'toggles';
    disabled?: boolean;
    /** Мастер: приписки «потом можно поменять в настройках» — в самих настройках они лишние. */
    wizard?: boolean;
  }

  let { settings = $bindable(), part, disabled = false, wizard = false }: Props = $props();

  const MODE_TEXT: Record<Mode, [string, string]> = {
    calm: [t('Спокойный', 'Calm'), t('живёт рядом и не мешает', 'stays close and never gets in the way')],
    pranks: [
      t('Шалости', 'Pranks'),
      t(
        'иногда тянет курсор, только когда мышь стоит; разозлишь — оставит лужу',
        'sometimes drags the cursor, only while the mouse is still; make her angry and she leaves a puddle',
      ),
    ],
  };
  const AREA_TEXT: Record<HunterArea, [string, string]> = {
    taskbar: [t('Нижняя панель', 'Taskbar'), t('мышь бегает по панели задач', 'the mouse runs along the taskbar')],
    screen: [t('Весь экран', 'Whole screen'), t('мышь забегает на окна и прячется в них', 'the mouse runs onto windows and hides in them')],
  };
  const CHATTER_TEXT: Record<Chatter, [string, string]> = {
    quiet: [t('Молчун', 'Quiet'), t('сам не заговаривает', 'never starts talking')],
    sometimes: [t('Иногда', 'Sometimes'), t('облачко раз в 10–30 минут', 'a bubble every 10–30 minutes')],
    often: [t('Часто', 'Often'), t('заговаривает чаще', 'talks more often')],
  };
  // Собака и дракон видны заранее, чтобы было понятно: кошка не единственная навсегда
  const PETS = [
    { id: 'cat', name: t('Кошка', 'Cat'), ready: true },
    { id: 'dog', name: t('Собака', 'Dog'), ready: false },
    { id: 'dragon', name: t('Дракон', 'Dragon'), ready: false },
  ];

  /** Темы держим в порядке списка, как раньше делал bind:group. */
  function setTopic(topic: Topic, on: boolean) {
    settings.topics = TOPICS.filter((x) => (x === topic ? on : settings.topics.includes(x)));
  }
</script>

{#if part === 'pet'}
  <Group legend={t('Питомец', 'Pet')}>
    <div class="pets">
      {#each PETS as p}
        <Radio
          variant="card"
          name="pet"
          value={p.id as Settings['pet']}
          bind:group={settings.pet}
          disabled={!p.ready || disabled}
          hint={p.ready ? undefined : t('скоро', 'soon')}
        >
          {p.name}
        </Radio>
      {/each}
    </div>
  </Group>

  <TextInput id="name" label={t('Как зовут', 'Name')} bind:value={settings.name} maxlength={NAME_MAX} spellcheck="false" autocomplete="off" {disabled}>
    <Button onclick={() => (settings.name = suggestName(Math.random, settings.name))} {disabled}>{t('Другое', 'Another')}</Button>
  </TextInput>
  {#if !settings.name.trim()}
    <Hint>
      {t(
        'Без имени питомец обойдётся, но с ним веселее: имя будет в меню и в облачках.',
        "Your pet can live without a name, but it's more fun with one: it shows up in the menu and speech bubbles.",
      )}
    </Hint>
  {/if}

  <Group legend={t('О чём рассказывать факты', 'Topics for fun facts')}>
    <Hint>
      {wizard
        ? t('Можно выбрать несколько; список потом меняется в настройках.', 'Pick as many as you like; you can change them later in settings.')
        : t('Можно выбрать несколько.', 'Pick as many as you like.')}
    </Hint>
    <div class="chips">
      {#each TOPICS as topic}
        <Check variant="chip" value={topic} bind:checked={() => settings.topics.includes(topic), (on) => setTopic(topic, on)} {disabled}>
          {topicName(topic)}
        </Check>
      {/each}
    </div>
  </Group>
{:else}
  <div class="toggles">
    <Check
      bind:checked={settings.gameWindow}
      hint={t(
        'Играешь в Hearthstone или другие неспешные игры? Включи — питомец посидит с тобой.',
        'Playing Hearthstone or another slow-paced game? Turn this on and your pet keeps you company.',
      )}
      {disabled}
    >
      {t('Заходить в окно игры', 'Visit game windows')}
    </Check>

    <Check
      bind:checked={settings.sites}
      hint={t(
        'Точнее угадывает интересы: заголовок окна сверяется со списком и не сохраняется.',
        'Guesses your interests better: the window title is checked against a list and never stored.',
      )}
      {disabled}
    >
      {t('Узнавать сайты в браузере', 'Recognize sites in the browser')}
    </Check>

    <Check
      bind:checked={settings.reviews}
      hint={t(
        'Оценки берём из Википедии и Wikidata — наружу уходит только название фильма.',
        'Ratings come from Wikipedia and Wikidata; only the movie title leaves your computer.',
      )}
      {disabled}
    >
      {t('Подтягивать отзывы о фильмах', 'Fetch movie reviews')}
    </Check>

    {#if settings.reviews}
      <div class="sub">
        <!-- id="tmdb" читают окна: настройки по нему узнают, что человек сейчас печатает ключ -->
        <TextInput
          id="tmdb"
          label={t('Ключ TMDB (API Key, по желанию)', 'TMDB key (API Key, optional)')}
          bind:value={settings.tmdbKey}
          mono
          spellcheck="false"
          autocomplete="off"
          aria-describedby="tmdb-how"
          {disabled}
        />
        <ol id="tmdb-how" class="guide">
          <li>{t('Зарегистрируйся на', 'Sign up at')} <span class="ui-mono">themoviedb.org</span>{t(' — это бесплатно.', ', it\'s free.')}</li>
          <li>{t('В профиле открой Settings → API и создай ключ для личного использования.', 'In your profile, open Settings → API and create a key for personal use.')}</li>
          <li>{t('Скопируй строку «API Key» и вставь сюда.', 'Copy the "API Key" line and paste it here.')}</li>
        </ol>
        {#if !settings.tmdbKey.trim()}
          <Hint>
            {t('Ключ не обязателен: без него хватит Википедии.', "The key is optional: Wikipedia is enough without it.")}{wizard
              ? t(' Его можно вставить и позже, в настройках.', ' You can also add it later in settings.')
              : ''}
          </Hint>
        {/if}
      </div>
    {/if}

    <Check bind:checked={settings.feeder} hint={t('Насыпал порций — кошка ест сама, когда проголодается.', 'Fill it up and the cat eats on her own when she gets hungry.')} {disabled}>
      {t('Кормушка', 'Feeder')}
    </Check>

    <Check
      bind:checked={settings.bed}
      hint={t(
        'Лежак на полу — кошка чаще спит в нём. Его, как и миску, можно перетащить мышью.',
        'A bed on the floor: the cat sleeps in it more often. You can drag it with the mouse, like the bowl.',
      )}
      {disabled}
    >
      {t('Лежак', 'Bed')}
    </Check>

    <Check bind:checked={settings.hideFromCapture} hint={t('Питомца не видно на скриншотах и стримах.', "Your pet won't show up in screenshots or streams.")} {disabled}>
      {t('Прятать от записи экрана', 'Hide from screen capture')}
    </Check>

    <Check
      bind:checked={settings.hunter}
      hint={t(
        'Иногда по экрану пробегает мышь, кошка гонится за ней 2–4 минуты; на резких разворотах её заносит. Мышь всегда убегает.',
        'Now and then a mouse runs across the screen and the cat chases it for 2–4 minutes, skidding on sharp turns. The mouse always gets away.',
      )}
      {disabled}
    >
      {t('Охотник', 'Hunter')}
    </Check>

    {#if settings.hunter}
      <div class="sub">
        {#each HUNTER_AREAS as a}
          <Radio name="hunterArea" value={a} bind:group={settings.hunterArea} hint={AREA_TEXT[a][1]} {disabled}>
            {AREA_TEXT[a][0]}
          </Radio>
        {/each}
      </div>
    {/if}

    <Check
      bind:checked={settings.yarn}
      hint={t(
        'Раз в час-два кошка выносит из-за края экрана клубок и пару минут катает его по панели задач, а потом укатывает обратно.',
        'Every hour or two the cat brings a ball of yarn from off screen, rolls it along the taskbar for a couple of minutes, then rolls it back.',
      )}
      {disabled}
    >
      {t('Клубок', 'Yarn')}
    </Check>
  </div>

  <Group legend={t('Режим', 'Mode')}>
    {#each MODES as m}
      <Radio name="mode" value={m} bind:group={settings.mode} hint={MODE_TEXT[m][1]} {disabled}>
        {MODE_TEXT[m][0]}
      </Radio>
    {/each}
  </Group>

  <Group legend={t('Разговорчивость', 'Chattiness')}>
    {#each CHATTER as c}
      <Radio name="chatter" value={c} bind:group={settings.chatter} hint={CHATTER_TEXT[c][1]} {disabled}>
        {CHATTER_TEXT[c][0]}
      </Radio>
    {/each}
  </Group>
{/if}

<style>
  .pets {
    display: flex;
    gap: 14px;
    padding: var(--ui-b) calc(var(--ui-b) * 2 + var(--ui-lift)) calc(var(--ui-b) * 2 + var(--ui-lift)) var(--ui-b);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding: var(--ui-b);
  }

  .toggles {
    margin-bottom: var(--ui-s3);
  }
  /* строки галочек разделены чертой, как страницы блокнота */
  .toggles > :global(label),
  .sub {
    border-bottom: 2px solid var(--ui-line);
  }
  .sub {
    padding: 10px 0 10px 33px;
  }
  .guide {
    margin: 0;
    padding-left: 20px;
    color: var(--ui-muted);
    user-select: text;
  }
  .sub :global(.muted) {
    margin: 6px 0 0;
  }
</style>
