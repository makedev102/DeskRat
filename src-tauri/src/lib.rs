//! Окна приложения. "pet" и "bowl" — прозрачные спрайты поверх всего, клики сквозь них
//! проходят везде, кроме рисунка (hit.rs). "setup" — обычное окно первого запуска: пока
//! человек не выбрал папку данных и не сохранил настройки (store.rs), питомца нет, есть только оно.
//! "settings" — обычное окно настроек, открывается из трея и меню питомца.
//! "stats" — окно статистики, оттуда же; только показывает цифры, которые копит питомец.

mod bubble;
mod call;
mod esc;
mod hit;
mod i18n;
mod laser;
mod media;
mod menu;
mod news;
mod revenge;
mod reviews;
mod shake;
mod store;
mod tracker;
#[cfg(windows)]
mod win;
mod wiki;
mod world;

use hit::{Masks, SPRITE};
#[cfg(windows)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tracker::{Day, Now, Pace, Tracker};
use tauri::tray::{MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

/// Во сколько раз увеличиваем пиксель арта при масштабе Windows 100%.
/// 32 × 4 = 128: при любом шаге масштаба в 25% клетка остаётся целым числом экранных пикселей.
const ZOOM: f64 = 4.0;

/// Окна-спрайты на рабочем столе. Порядок — это порядок по глубине: построенное позже
/// ложится сверху, и кошка, что пришла есть, должна быть перед миской, а не под горкой корма,
/// а лежак — под всеми: кошка в нём, а не за ним. Мышь — под кошкой: та её догоняет и перекрывает.
const SPRITES: [&str; 4] = ["bed", "bowl", "mouse", "pet"];

/// Кого прячет галочка «Прятать от записи экрана». Точку лазера и её эффекты laser.rs прячет всегда сам.
const CAPTURED: [&str; 6] = ["bed", "bowl", "mouse", "pet", "menu", "bubble"];

/// Что питомец знает о человеке прямо сейчас.
struct Senses {
    tracker: Arc<Mutex<Tracker>>,
    /// Программа в активном окне на последнем тике.
    app: Mutex<Option<String>>,
    /// Идёт ли видео — пишет поток media.rs.
    media: Arc<Mutex<media::Media>>,
    /// Идёт созвон (call.rs). Реестр и процессы опрашивает senses-tick, команда senses только читает.
    #[cfg(windows)]
    call: AtomicBool,
}

#[derive(serde::Serialize)]
struct SensesNow {
    app: Option<String>,
    idle: bool,
    typing: bool,
    pace: Pace,
    session_secs: u64,
    active_today_secs: u64,
    #[cfg(windows)]
    quiet: win::Quiet,
    media: media::Media,
    /// Только да/нет: какие программы держат микрофон, фронтенду знать незачем.
    #[cfg(windows)]
    call: bool,
    /// Ноутбук от батареи: кошка спит чаще.
    #[cfg(windows)]
    battery: bool,
}

/// Маска текущего кадра того окна, которое её прислало.
#[tauri::command]
fn set_hit_mask(window: WebviewWindow, masks: State<'_, Arc<Masks>>, rows: Vec<u32>) {
    masks.set(window.label(), rows);
}

/// Прятать ли питомца и миску от записи экрана и скриншотов.
#[tauri::command]
fn set_capture_hidden(app: AppHandle, hidden: bool) -> Result<(), String> {
    for w in CAPTURED.iter().filter_map(|l| app.get_webview_window(l)) {
        w.set_content_protected(hidden).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn senses(s: State<'_, Arc<Senses>>) -> SensesNow {
    let at = Instant::now();
    let t = s.tracker.lock().unwrap();
    SensesNow {
        app: s.app.lock().unwrap().clone(),
        idle: t.idle(at),
        typing: t.typing(at),
        pace: t.pace(),
        session_secs: t.session_secs(at),
        active_today_secs: t.day.active_seconds,
        #[cfg(windows)]
        quiet: win::quiet(),
        media: s.media.lock().unwrap().clone(),
        #[cfg(windows)]
        call: s.call.load(Ordering::Relaxed),
        #[cfg(windows)]
        battery: win::on_battery(),
    }
}

/// Созвон проверяется раз в столько тиков senses-tick (тик — секунда).
#[cfg(windows)]
const CALL_TICKS: u64 = 2;

/// Корзина опрашивается раз в столько тиков: очистку замечаем не сразу, но без суеты.
#[cfg(windows)]
const BIN_TICKS: u64 = 5;

/// Сырой ввод и тик раз в секунду: чистое время, программы, сессии, созвон.
#[cfg(windows)]
fn start_senses(s: Arc<Senses>, pet: AppHandle) {
    win::start_input(s.tracker.clone());
    media::start(s.media.clone());
    std::thread::Builder::new()
        .name("senses-tick".into())
        .spawn(move || {
            let mut fg = win::Foreground::new();
            let mut bin = win::bin_items();
            for n in 0u64.. {
                std::thread::sleep(std::time::Duration::from_secs(1));
                let app = fg.current();
                // закончившийся день пока выбрасываем: хранилища ещё нет
                let _ = s.tracker.lock().unwrap().tick(&Now::local(), app.as_deref());
                *s.app.lock().unwrap() = app;
                // реестр и снимок процессов — через тик: фронтенд и сам спрашивает раз в 2 с
                if n % CALL_TICKS == 0 {
                    s.call.store(call::now(), Ordering::Relaxed);
                }
                // очистили корзину — кошка хрумкает выброшенным
                if n % BIN_TICKS == 0 {
                    let now = win::bin_items();
                    if win::bin_emptied(bin, now) {
                        if let Err(err) = pet.emit_to("pet", "crunch", ()) {
                            eprintln!("crunch: {err}");
                        }
                    }
                    bin = now;
                }
            }
        })
        .expect("senses tick thread");
}

/// Окно размером со спрайт: прозрачное, поверх всех, без рамки, без значка на панели задач.
/// Фокус не берёт ни при показе, ни по клику — иначе клик по зверю свернул бы игру.
/// От записи экрана спрятано сразу: так стоит настройка по умолчанию, а выбранную
/// фронтенд применит сам через set_capture_hidden.
fn build_sprite_window(app: &AppHandle, label: &str) -> tauri::Result<WebviewWindow> {
    let side = SPRITE as f64 * ZOOM;
    let mut b = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("DeskRat")
        .inner_size(side, side)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .focusable(false)
        .content_protected(true);
    // появляется в правом нижнем углу над панелью задач, дальше окно водит фронтенд (place_pet)
    if let Some(m) = app.primary_monitor()? {
        let sf = m.scale_factor();
        let wa = m.work_area();
        let x = (wa.position.x as f64 + wa.size.width as f64) / sf - side - 24.0;
        let y = (wa.position.y as f64 + wa.size.height as f64) / sf - side;
        b = b.position(x, y);
    }
    b.build()
}

/// Питомец, миска, лежак и мышь, у каждого свой поток прозрачности для кликов.
fn open_sprites(app: &AppHandle) -> tauri::Result<()> {
    let masks = app.state::<Arc<Masks>>().inner().clone();
    // лужа мести — до спрайтов: так она ложится под кошку
    revenge::build(app)?;
    for label in SPRITES {
        hit::spawn(build_sprite_window(app, label)?, masks.clone());
    }
    // меню, облачко и лазер строятся заранее и прячутся: по клику окно только показывают, без задержки
    menu::build(app)?;
    bubble::build(app)?;
    laser::build(app)?;
    Ok(())
}

/// Первый запуск: обычное окно, где выбирают папку данных.
/// Закрыли, не закончив, — питомцу негде хранить свою жизнь, выходим.
fn build_setup_window(app: &AppHandle) -> tauri::Result<()> {
    let w = WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("index.html".into()))
        .title(i18n::tr("DeskRat — первый запуск", "DeskRat — first launch"))
        // рамка своя, пиксельная (src/ui): +32 под её полосу заголовка; тень системная
        .inner_size(560.0, 712.0)
        .decorations(false)
        .shadow(true)
        .resizable(false)
        .center()
        .focused(true)
        .build()?;
    let app = app.clone();
    w.on_window_event(move |e| {
        // finish_setup открывает питомца раньше, чем закрывает это окно, — тогда не выходим
        if matches!(e, WindowEvent::Destroyed) && app.get_webview_window("pet").is_none() {
            app.exit(0);
        }
    });
    Ok(())
}

/// Папка выбрана: открыть питомца и миску, закрыть окно первого запуска.
/// async нарочно: синхронная команда выполняется в главном потоке, а создание WebView-окна
/// оттуда на Windows виснет — построитель ждёт событийный цикл, который сам же и занимает
/// (wry#583). Асинхронная идёт в пуле async-рантайма и только ставит окно в очередь цикла.
#[tauri::command]
async fn finish_setup(app: AppHandle) -> Result<(), String> {
    if !store::has_dir() {
        return Err(i18n::tr("папка данных не выбрана", "no data folder chosen").into());
    }
    // повторный вызов (двойной клик по кнопке) не должен строить окна с занятыми метками
    if app.get_webview_window("pet").is_none() {
        open_sprites(&app).map_err(|e| e.to_string())?;
    }
    if let Some(w) = app.get_webview_window("setup") {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Окно настроек: обычное, одно на всё приложение. Открыто — поднять его, а не строить второе.
/// Пока идёт первый запуск, настраивать нечего — поднимаем мастер.
/// Закрытие этого окна программу не закрывает: питомец и миска остаются.
fn show_settings(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("settings").or_else(|| app.get_webview_window("setup")) {
        w.unminimize()?;
        w.show()?;
        return w.set_focus();
    }
    WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("index.html".into()))
        .title(i18n::tr("DeskRat — настройки", "DeskRat — settings"))
        .inner_size(560.0, 752.0)
        .min_inner_size(460.0, 512.0)
        .decorations(false)
        .shadow(true)
        .center()
        .focused(true)
        .build()?;
    Ok(())
}

/// async по той же причине, что и finish_setup: окно из синхронной команды вешает Windows (wry#583).
#[tauri::command]
async fn open_settings(app: AppHandle) -> Result<(), String> {
    show_settings(&app).map_err(|e| e.to_string())
}

/// Окно статистики: тоже одно на всё приложение, открыто — поднять. Только показывает цифры,
/// поэтому меньше настроек и закрывается без последствий.
fn show_stats(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("stats") {
        w.unminimize()?;
        w.show()?;
        return w.set_focus();
    }
    WebviewWindowBuilder::new(app, "stats", WebviewUrl::App("index.html".into()))
        .title(i18n::tr("DeskRat — статистика", "DeskRat — stats"))
        .inner_size(560.0, 640.0)
        .min_inner_size(400.0, 360.0)
        .decorations(false)
        .shadow(true)
        .center()
        .focused(true)
        .build()?;
    Ok(())
}

/// async — как open_settings.
#[tauri::command]
async fn open_stats(app: AppHandle) -> Result<(), String> {
    show_stats(&app).map_err(|e| e.to_string())
}

/// Сменить папку данных и перезапуститься: в новой папке могли лежать свои файлы питомца,
/// они побеждают, а перечитать всё с нуля проще и надёжнее, чем подменять на ходу.
/// Синхронная, как и команды store.rs: идёт в главном потоке по очереди с save_state.
#[tauri::command]
fn move_data_dir(app: AppHandle, dir: String) -> Result<(), String> {
    store::set_data_dir(dir)?;
    restart_into_settings(&app);
    Ok(())
}

/// Сменили язык: перезапуститься, чтобы трей и все окна построились заново уже на нём.
/// Настройки с новым языком окно к этому времени уже сохранило.
#[tauri::command]
fn relaunch(app: AppHandle) {
    restart_into_settings(&app);
}

fn restart_into_settings(app: &AppHandle) {
    // новый процесс наследует окружение: по пометке он сразу откроет настройки, человек был в них
    std::env::set_var(REOPEN_SETTINGS, "1");
    // не restart(): тот из главного потока выходит сразу, не ответив окну. request_restart
    // выходит обычным путём, и single-instance успевает отпустить мьютекс до нового запуска
    app.request_restart();
}

/// Пометка «перезапустились из окна настроек — открыть его снова». Живёт в окружении
/// процесса: аргументы командной строки request_restart передаёт прежние, добавить нечего.
const REOPEN_SETTINGS: &str = "DESKRAT_REOPEN_SETTINGS";

/// Имя питомца для трея: его присылает окно кошки (name_pet), когда читает или меняет настройки.
static PET_NAME: Mutex<String> = Mutex::new(String::new());

/// Окно кошки сообщило имя из настроек: шапка меню трея и подсказка у значка.
#[tauri::command]
async fn name_pet(app: AppHandle, name: String) {
    let name: String = name.trim().chars().take(20).collect();
    let tip = if name.is_empty() { "DeskRat".to_string() } else { format!("DeskRat · {name}") };
    *PET_NAME.lock().unwrap() = name;
    if let Some(tray) = app.tray_by_id("main") {
        if let Err(err) = tray.set_tooltip(Some(tip)) {
            eprintln!("tray tooltip: {err}");
        }
    }
}

/// «Босс идёт»: спрятать питомца, миску, лежак, мышь и лужу или вернуть их. Облачко и меню
/// окно кошки убирает само, получив "boss"; на это время оно молчит.
#[cfg(windows)]
fn boss(app: &AppHandle) {
    let hidden = win::toggle_boss();
    for w in SPRITES.iter().chain(["puddle"].iter()).filter_map(|l| app.get_webview_window(l)) {
        let done = if hidden { w.hide() } else { w.show() };
        if let Err(err) = done {
            eprintln!("boss {}: {err}", w.label());
        }
    }
    if let Err(err) = app.emit_to("pet", "boss", hidden) {
        eprintln!("boss: {err}");
    }
}

/// Пункты меню трея: то же пиксельное меню, что у кошки по ПКМ (menu.rs).
fn tray_items() -> Vec<menu::Item> {
    use i18n::tr;
    let entry = |id: &str, text: &str, hint: Option<&str>| menu::Item::Entry {
        id: id.into(),
        text: text.into(),
        checked: None,
        hint: hint.map(Into::into),
        disabled: false,
    };
    let mut items = Vec::new();
    // проверить облачко, голод, мышь, клубок, новость и месть, не дожидаясь сроков; в релиз не попадает
    if cfg!(debug_assertions) {
        items.extend([
            entry("dev-say", "Say something (dev)", None),
            entry("dev-hungry", "Get hungry (dev)", None),
            // охотник или клубок выключен — включит
            entry("dev-hunter", "Hunter (dev)", None),
            entry("dev-yarn", "Yarn (dev)", None),
            entry("dev-news", "News (dev)", None),
            // обида без шанса и перезарядки; в «не мешать» и на созвоне всё равно нет
            entry("dev-revenge", "Revenge (dev)", None),
            menu::Item::Separator { separator: true },
        ]);
    }
    let name = PET_NAME.lock().unwrap().clone();
    if !name.is_empty() {
        // шапка с именем, как в меню кошки; ведёт в статистику
        items.extend([entry("stats", &name, None), menu::Item::Separator { separator: true }]);
    }
    items.extend([
        // кошка умеет уходить за край экрана — отсюда её зовут обратно
        entry("call", tr("Позвать питомца", "Call your pet"), Some(tr("если ушла за край экрана", "if she wandered off screen"))),
        // некормленый кот уходит навсегда — без этого пункта вернуть питомца было бы нечем
        entry("adopt", tr("Новый котик", "Adopt a new cat"), Some(tr("если прежний сбежал", "if the last one ran away"))),
    ]);
    #[cfg(windows)]
    items.push(if win::bossed() {
        entry("boss", tr("Показать питомца", "Show your pet"), Some("Ctrl+Alt+Shift+H"))
    } else {
        entry("boss", tr("Спрятать питомца", "Hide your pet"), Some(tr("Ctrl+Alt+Shift+H — и обратно", "Ctrl+Alt+Shift+H to bring back")))
    });
    items.extend([
        menu::Item::Separator { separator: true },
        entry("stats", tr("Статистика…", "Stats…"), None),
        entry("settings", tr("Настройки…", "Settings…"), None),
        menu::Item::Separator { separator: true },
        entry("quit", tr("Выход", "Quit"), None),
    ]);
    items
}

/// Выбрали пункт в меню трея (menu.rs зовёт сюда вместо события окну).
pub(crate) fn tray_pick(app: &AppHandle, id: &str) {
    match id {
        "call" | "adopt" | "dev-say" | "dev-hungry" | "dev-hunter" | "dev-yarn" | "dev-news" | "dev-revenge" => {
            if let Err(err) = app.emit_to("pet", id, ()) {
                eprintln!("{id}: {err}");
            }
        }
        // окна строим из пула, как в open_settings: из главного потока на Windows нельзя (wry#583)
        "settings" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = show_settings(&app) {
                    eprintln!("settings: {err}");
                }
            });
        }
        "stats" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = show_stats(&app) {
                    eprintln!("stats: {err}");
                }
            });
        }
        #[cfg(windows)]
        "boss" => boss(app),
        "quit" => app.exit(0),
        _ => {}
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    // системного меню у значка нет: по любой кнопке открываем своё, пиксельное
    let mut tray = TrayIconBuilder::with_id("main").tooltip("DeskRat").on_tray_icon_event(|tray, e| {
        if let TrayIconEvent::Click { button_state: MouseButtonState::Up, .. } = e {
            if let Err(err) = menu::open(tray.app_handle(), menu::TRAY.into(), tray_items()) {
                eprintln!("tray menu: {err}");
            }
        }
    });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let now = Now::local();
    let feel = Arc::new(Senses {
        tracker: Arc::new(Mutex::new(Tracker::new(Day::new(&now.date), &now))),
        app: Mutex::new(None),
        media: Arc::new(Mutex::new(media::Media::default())),
        #[cfg(windows)]
        call: AtomicBool::new(false),
    });
    tauri::Builder::default()
        // второй экземпляр просто закрывается: два одинаковых питомца — уже не питомец
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        // выбор папки данных в окне первого запуска
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(Masks::default()))
        .manage(feel.clone())
        .invoke_handler(tauri::generate_handler![
            set_hit_mask,
            set_capture_hidden,
            finish_setup,
            open_settings,
            open_stats,
            move_data_dir,
            relaunch,
            i18n::lang,
            name_pet,
            menu::open_menu,
            menu::menu_size,
            menu::menu_pick,
            menu::close_menu,
            bubble::say,
            bubble::bubble_size,
            bubble::bubble_at,
            bubble::hush,
            laser::set_laser,
            laser::push_pixels,
            laser::push_show,
            laser::push_done,
            laser::skid,
            senses,
            revenge::top_app,
            world::world,
            world::place_pet,
            world::shelves,
            hit::drag_window,
            store::data_dir,
            store::suggest_dirs,
            store::set_data_dir,
            store::load_state,
            store::save_state,
            wiki::wiki_today,
            reviews::film_reviews,
            news::news_pick,
            news::news_topics,
            news::news_vote,
            news::news_status,
            news::news_refresh,
        ])
        .setup(move |app| {
            // язык — до окон и трея: они строятся уже на нём
            i18n::init();
            #[cfg(windows)]
            {
                let h = app.handle().clone();
                win::on_hotkey(move |k| match k {
                    win::Hotkey::Boss => boss(&h),
                    win::Hotkey::Shot => {
                        if let Err(err) = h.emit_to("pet", "shot", ()) {
                            eprintln!("shot: {err}");
                        }
                    }
                });
                start_senses(feel, app.handle().clone());
            }
            news::start();
            // снимаем сразу: следующий перезапуск (или программа, которую питомец запустит) её не унаследует
            let reopen = std::env::var_os(REOPEN_SETTINGS).is_some();
            std::env::remove_var(REOPEN_SETTINGS);
            if store::set_up() {
                open_sprites(app.handle())?;
                if reopen {
                    show_settings(app.handle())?;
                }
            } else {
                build_setup_window(app.handle())?;
            }
            build_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("не удалось запустить DeskRat");
}
