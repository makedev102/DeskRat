<script lang="ts">
  // Окно-диалог целиком: своя пиксельная полоса заголовка (окно без системной рамки), шапка,
  // прокручиваемое содержимое и кнопки внизу. Передан onsubmit — корнем станет <form>.
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n';
  import Icon from './Icon.svelte';

  interface Props {
    /** Текст в полосе заголовка; за неё окно и таскают. */
    title: string;
    onsubmit?: (e: SubmitEvent) => void;
    busy?: boolean;
    minimizable?: boolean;
    /** Над прокруткой: крупный заголовок, шаги мастера. */
    header?: Snippet;
    children: Snippet;
    /** Под прокруткой, всегда на виду: главные кнопки. */
    footer?: Snippet;
  }

  let { title, onsubmit, busy = false, minimizable = true, header, children, footer }: Props = $props();

  const win = getCurrentWindow();

  // Закрытие идёт обычным путём: onCloseRequested окна успевает дописать своё
  function close() {
    win.close().catch(console.error);
  }

  function minimize() {
    win.minimize().catch(console.error);
  }
</script>

{#snippet body()}
  <!-- Тащат за саму полосу: Tauri смотрит только на элемент под курсором, поэтому
       значок и текст пропускают мышь к ней (pointer-events: none) -->
  <div class="bar" data-tauri-drag-region>
    <span class="paw"><Icon name="rat" /></span>
    <span class="title">{title}</span>
    {#if minimizable}
      <button type="button" class="ctl" aria-label={t('Свернуть', 'Minimize')} title={t('Свернуть', 'Minimize')} onclick={minimize}>
        <Icon name="minimize" />
      </button>
    {/if}
    <button type="button" class="ctl close" aria-label={t('Закрыть', 'Close')} title={t('Закрыть', 'Close')} onclick={close}>
      <Icon name="close" />
    </button>
  </div>

  {#if header}
    <header>{@render header()}</header>
  {/if}

  <!-- Содержимое выше окна прокручивается здесь, а шапка и кнопки стоят на месте -->
  <main>{@render children()}</main>

  {#if footer}
    <footer>{@render footer()}</footer>
  {/if}
{/snippet}

{#if onsubmit}
  <form class="ui-dialog" {onsubmit} aria-busy={busy}>{@render body()}</form>
{:else}
  <div class="ui-dialog" aria-busy={busy}>{@render body()}</div>
{/if}

<style>
  .ui-dialog {
    color-scheme: light dark;
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    margin: 0;
    border: var(--ui-b) solid var(--ui-ink);
    background: var(--ui-bg);
    color: var(--ui-text);
    font: var(--ui-font);
  }

  .bar {
    display: flex;
    flex: none;
    gap: var(--ui-s2);
    align-items: center;
    height: 32px;
    padding: 0 var(--ui-s1) 0 var(--ui-s3);
    border-bottom: var(--ui-b) solid var(--ui-ink);
    /* светлая кромка сверху и тёмная снизу — объём в два пикселя, как у кнопок */
    background: linear-gradient(var(--ui-accent-hi) 0 var(--ui-b), var(--ui-accent) var(--ui-b));
    color: var(--ui-on-accent);
    user-select: none;
  }
  .paw,
  .title {
    pointer-events: none;
  }
  .title {
    flex: 1;
    overflow: hidden;
    font: 700 13px var(--ui-font-pixel);
    letter-spacing: 0.02em;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .ctl {
    display: grid;
    place-items: center;
    width: 26px;
    height: 24px;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .ctl:hover {
    background: var(--ui-accent-lo);
  }
  .close:hover {
    background: var(--ui-danger);
    color: #fff;
  }
  .ctl:focus-visible {
    outline: 2px solid var(--ui-on-accent);
    outline-offset: -4px;
  }

  header {
    padding: var(--ui-s4) 28px var(--ui-s2);
  }
  header :global(h1) {
    margin: 0;
    font: 700 21px/1.25 var(--ui-font-pixel);
    outline: none;
  }

  main {
    flex: 1;
    overflow-y: auto;
    padding: var(--ui-s1) 28px var(--ui-s4);
  }
  main > :global(p) {
    margin: var(--ui-s2) 0 14px;
  }
  /* Полоса прокрутки — тоже из клеток */
  main::-webkit-scrollbar {
    width: 12px;
  }
  main::-webkit-scrollbar-track {
    background: var(--ui-soft);
  }
  main::-webkit-scrollbar-thumb {
    border: var(--ui-b) solid var(--ui-soft);
    background: var(--ui-accent);
  }

  footer {
    display: flex;
    flex: none;
    gap: var(--ui-s3);
    align-items: center;
    padding: 14px 28px;
    border-top: var(--ui-b) solid var(--ui-line);
  }
</style>
