<p align="center">
  <img src="src-tauri/icons/128x128.png" width="128" height="128" alt="Penny, a white pixel rat with pink ears">
</p>

<h1 align="center">DeskRat</h1>

<p align="center">
  Penny, a white pixel rat for the Windows desktop. She lives on your screen edges and window frames and stays out of your way.
</p>

<p align="center">
  <a href="https://forecastych.github.io/DeskPartner/">Original project website</a> ·
  <a href="README.ru.md">По-русски</a>
</p>

DeskRat is a noncommercial fork of [Forecastych/DeskPartner](https://github.com/Forecastych/DeskPartner), made in memory of Penny. The original project and its author retain their attribution.

## What she does

- **Walks and naps** on the taskbar, screen edges and the frames of your windows. She never sits in the middle of the screen.
- **Eats** from a bowl you can drag anywhere, and gets hungry a couple of hours after a meal.
- **Sleeps** on her bed.
- **Sulks** if you annoy her, and remembers it.
- **Watches films** with you and hides during calls.
- **Follows** a laser pointer: hold `Ctrl` on its own for a moment and the cursor turns into a red dot.
- **Plays with yarn** now and then.
- **Talks rarely**: a speech bubble every 10 to 30 minutes, with a fact, a "this day in history" note or a headline on the topics you picked.

Clicks pass through everything except Penny herself, her bowl, bed and speech bubble. She never takes keyboard focus, and she disappears while a game or video runs in exclusive fullscreen.

She does not show up in screenshots or screen recordings (you can change that). The livelier extras are off by default and wait in Settings: a bed, an auto-feeder, chasing your cursor, news, film reviews.

## Install

1. Use the locally built `DeskRat_<version>_x64-setup.exe` from `src-tauri/target/release/bundle/nsis/`. The upstream DeskPartner release is a different application.
2. Run it. It installs into your user profile, no administrator rights needed.
3. On first launch, give her a name and choose a folder for her data.

Works on Windows 10 and 11.

> [!WARNING]
> **Windows SmartScreen will warn you about the installer.** The installer is not code-signed: a code signing certificate costs money every year, and this is a free hobby project. To install anyway, click **More info → Run anyway**. If you would rather not trust a binary, [build it from source](#build-from-source), it takes a few commands.

**Updates.** Automatic update checks and installation are disabled in DeskRat. Install a new local build manually.

To uninstall, use "Installed apps" in Windows Settings. Your data folder stays where you put it; delete it by hand if you want it gone.

## Controls

| What | How |
| --- | --- |
| Menu | Right-click Penny, or the tray icon |
| Laser pointer | Hold `Ctrl` alone, or pick it in the menu (`Esc` turns it off) |
| Click through Penny | Hold `Alt` while clicking |
| Hide / show | `Ctrl+Alt+Shift+H` |
| Call Penny over | Right-click → press “Penny!” three times in the same menu; she approaches after the third call if she is free |
| She wandered off | Tray → "Call your pet" |
| Settings and stats | Tray → "Settings…" / "Stats…" |

## Privacy

- **No analytics, no accounts, no telemetry.**
- **Window titles are not read.** The one exception is an opt-in checkbox for websites in your browser: the title is compared with your list and forgotten right away.
- **Microphone and camera are not recorded.** She only checks whether they are busy, to know you are on a call.
- **The screen is not saved.** For the laser she looks at a few pixels in memory, nothing is stored or sent.
- **What goes over the network, and only when the feature is on:**
  - "This day in history" from Wikipedia: today's date and the language;
  - news headlines: RSS feeds of the topics you picked (The Guardian, BBC and others);
  - film reviews: the film title goes to Wikidata and Wikipedia;
  - TMDB: only with your own API key.

Her state lives in the chosen folder as `deskrat-*.json` files; `%APPDATA%\DeskRat\location.json` stores its location. DeskPartner data is kept separate.

Mouse chasing is disabled, including its menu and settings controls. Yarn play and the laser pointer remain available. The three-click call does not wake Penny or interrupt eating and other activities.

## Build from source

You need [Node.js](https://nodejs.org/) (LTS), [Rust](https://rustup.rs/) and the [Tauri prerequisites for Windows](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run app
```

`npm run app` starts the app in development mode. `npm run release` builds the installer into `src-tauri/target/release/bundle/nsis/`.

Checks:

```bash
npm run check
npm test
cd src-tauri && cargo test
```

Built with [Tauri 2](https://tauri.app/), Rust and [Svelte 5](https://svelte.dev/). All pixel art is drawn in code.

## Upstream feedback

These links belong to the original DeskPartner project; they are not a DeskRat support channel.

- No GitHub account? Use the [form on the website](https://forecastych.github.io/DeskPartner/#reviews).
- Found a bug or have an idea? [Open an issue](https://github.com/Forecastych/DeskPartner/issues/new/choose). English or Russian, both are fine.

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Use it, change it, share it, but not for money. Selling or monetizing DeskPartner or its parts needs the author's permission.

© 2026 Forecastych
