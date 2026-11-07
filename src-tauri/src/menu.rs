//! Своё ПКМ-меню питомца вместо системного: пиксельное, как остальные окна (src/ui),
//! и фокус у человека не отнимает.
//!
//! Системное меню без фокуса не живёт — оно забрало бы его у игры. Окно "menu" строится
//! заранее спрятанным и неактивируемым (focusable(false) — это WS_EX_NOACTIVATE), а показывается
//! вызовом SetWindowPos с SWP_NOACTIVATE: show() из Tauri у уже созданного окна зовёт
//! ShowWindow(SW_SHOW), а тот окно активирует.
//! Фокуса нет — значит, ни Esc, ни клик мимо до окна не дойдут. Пока меню открыто, поток
//! часто смотрит на кнопки мыши, Esc и активное окно (как hit.rs смотрит на курсор), а Esc
//! перехватывает esc.rs, чтобы он не ушёл ещё и активной программе.
//!
//! Показ в три шага: open_menu запоминает курсор и отдаёт пункты окну ("menu-items"), окно
//! меряет себя и присылает размер (menu_size), а Rust ставит его у курсора в пределах рабочей
//! области монитора и показывает. Выбрали пункт — menu_pick, владельцу уходит "menu-pick" { id };
//! закрыли иначе (клик мимо, Esc, другое окно, новое меню, close_menu) — "menu-close".
//! Меню трея — то же окно: системное выбивалось бы из пиксельного стиля.

use crate::world::Rect;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const LABEL: &str = "menu";

/// Владелец-трей: окна у него нет, выбранный пункт уходит в lib.rs (tray_pick), а не событием.
pub const TRAY: &str = "tray";

/// Как часто смотреть на мышь и клавиши, пока меню открыто: клик длится дольше 15 мс.
const POLL: Duration = Duration::from_millis(15);

/// Пункт меню так, как его присылает окно-владелец.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(untagged)]
pub enum Item {
    Entry {
        id: String,
        text: String,
        /// Есть — пункт-галочка; нет — обычный пункт.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        checked: Option<bool>,
        /// Мелкая приписка под текстом.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hint: Option<String>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        disabled: bool,
    },
    Separator {
        separator: bool,
    },
}

/// Что уходит окну меню: пункты и номер показа, который оно вернёт вместе с размером.
#[derive(Clone, Serialize)]
struct Show {
    gen: u64,
    items: Vec<Item>,
}

#[derive(Clone, Serialize)]
struct Pick {
    id: String,
}

#[derive(Default)]
struct Shown {
    /// Окно, которому отвечать; нет — меню закрыто.
    owner: Option<String>,
    /// Номер показа: размер от прошлого меню и поток прошлого показа по нему понимают, что устарели.
    gen: u64,
    /// Курсор в момент вызова, физические пиксели.
    anchor: (i32, i32),
    /// Где меню стоит на экране; нет — ещё меряется.
    rect: Option<Rect>,
}

#[derive(Default)]
pub struct MenuState(Mutex<Shown>);

/// Окно меню: прозрачное, поверх всех, без рамки и тени, без значка на панели задач, без фокуса.
/// Строится один раз при запуске (из синхронной команды окно на Windows не построить, wry#583).
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    app.manage(MenuState::default());
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("DeskRat")
        .inner_size(240.0, 160.0)
        .visible(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .focusable(false)
        .content_protected(true)
        .build()?;
    Ok(())
}

/// Открыть меню у курсора. Открытое прежде закрывается, его владелец получает "menu-close".
#[tauri::command]
pub async fn open_menu(app: AppHandle, owner: String, items: Vec<Item>) -> Result<(), String> {
    open(&app, owner, items)
}

/// То же для Rust: трей открывает меню отсюда, без окна-владельца.
pub fn open(app: &AppHandle, owner: String, items: Vec<Item>) -> Result<(), String> {
    let w = window(app)?;
    let hwnd = sys::hwnd(&w)?;
    let at = sys::cursor().unwrap_or_default();
    let state = app.state::<MenuState>();
    let (prev, gen) = {
        let mut s = state.0.lock().unwrap();
        let prev = s.owner.replace(owner);
        s.gen += 1;
        s.anchor = at;
        s.rect = None;
        // прежнее меню прячем сразу, пока новое меряется. Спрятанное окно заранее ставим
        // к курсору: на мониторе с другим масштабом WebView успеет пересчитать пиксели до замера
        sys::hide(hwnd);
        sys::move_to(hwnd, at);
        (prev, s.gen)
    };
    if let Some(prev) = prev {
        tell(app, &prev, "menu-close", ());
    }
    w.emit_to(LABEL, "menu-items", Show { gen, items }).map_err(|e| e.to_string())
}

/// Окно меню измерило себя: `width`×`height` — физические пиксели. Ставим и показываем.
/// Приходит и повторно, если у окна сменился масштаб, — тогда только переставляем.
#[tauri::command]
pub async fn menu_size(app: AppHandle, gen: u64, width: u32, height: u32) -> Result<(), String> {
    let hwnd = sys::hwnd(&window(&app)?)?;
    let state = app.state::<MenuState>();
    let first = {
        let mut s = state.0.lock().unwrap();
        if s.gen != gen || s.owner.is_none() {
            return Ok(());
        }
        let size = (width.max(1) as i32, height.max(1) as i32);
        let (left, top) = place(s.anchor, size, sys::work_area(s.anchor));
        let rect = Rect { left, top, right: left + size.0, bottom: top + size.1 };
        let first = s.rect.is_none();
        s.rect = Some(rect);
        sys::show(hwnd, rect);
        first
    };
    if first {
        watch(app.clone(), gen);
    }
    Ok(())
}

/// Выбрали пункт: владельцу — "menu-pick" { id }, меню прячется.
#[tauri::command]
pub async fn menu_pick(app: AppHandle, gen: u64, id: String) -> Result<(), String> {
    let hwnd = sys::hwnd(&window(&app)?)?;
    let owner = {
        let mut s = app.state::<MenuState>().inner().0.lock().unwrap();
        if s.gen != gen {
            return Ok(());
        }
        sys::hide(hwnd);
        s.rect = None;
        s.owner.take()
    };
    match owner.as_deref() {
        Some(TRAY) => crate::tray_pick(&app, &id),
        Some(owner) => tell(&app, owner, "menu-pick", Pick { id }),
        None => {}
    }
    Ok(())
}

/// Закрыть меню без выбора, например когда питомец убежал. Закрытое — ничего не делает.
#[tauri::command]
pub async fn close_menu(app: AppHandle) -> Result<(), String> {
    cancel(&app, None);
    Ok(())
}

fn window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(LABEL).ok_or_else(|| "меню ещё не построено".to_string())
}

fn tell<S: Serialize + Clone>(app: &AppHandle, owner: &str, event: &str, payload: S) {
    // у трея окна нет: его выбор уходит в tray_pick, а закрытие ему не интересно
    if owner == TRAY {
        return;
    }
    if let Err(err) = app.emit_to(owner, event, payload) {
        eprintln!("{event}: {err}");
    }
}

/// Спрятать меню и сказать владельцу "menu-close". `gen` — закрыть, только если это всё ещё тот показ.
fn cancel(app: &AppHandle, gen: Option<u64>) {
    let Ok(w) = window(app) else { return };
    let Ok(hwnd) = sys::hwnd(&w) else { return };
    let owner = {
        let mut s = app.state::<MenuState>().inner().0.lock().unwrap();
        if gen.is_some_and(|g| g != s.gen) {
            return;
        }
        sys::hide(hwnd);
        s.rect = None;
        s.owner.take()
    };
    if let Some(owner) = owner {
        tell(app, &owner, "menu-close", ());
    }
}

/// Пока показ `gen` открыт: новое нажатие кнопки мыши мимо меню, Esc или смена активного
/// окна (Alt+Tab, Win) закрывают его. Нажатия, начатые до показа, не считаются: правая кнопка,
/// которой меню открыли, ещё может быть зажата. Активным может стать и само меню (WebView
/// внутри него на клик берёт фокус) — это не повод закрываться, выбор ещё впереди.
fn watch(app: AppHandle, gen: u64) {
    let Ok(me) = window(&app).and_then(|w| sys::hwnd(&w)) else { return };
    let spawned = thread::Builder::new().name("menu-watch".into()).spawn(move || {
        // пока меню открыто, Esc закрывает его, а не что-то в активной программе
        let mut trap = crate::esc::Trap::new();
        let mut was = sys::pressed();
        let fg = sys::foreground();
        loop {
            thread::sleep(POLL);
            let rect = {
                let s = app.state::<MenuState>().inner().0.lock().unwrap();
                if s.gen != gen || s.owner.is_none() {
                    break;
                }
                s.rect
            };
            let now = sys::pressed();
            let fresh: [bool; 4] = std::array::from_fn(|k| now[k] && !was[k]);
            was = now;
            let outside = match (rect, sys::cursor()) {
                (Some(r), Some((x, y))) => !(r.left..r.right).contains(&x) || !(r.top..r.bottom).contains(&y),
                _ => true,
            };
            let click = fresh[..sys::ESC].contains(&true) && outside;
            let away = ![fg, me].contains(&sys::foreground());
            if click || trap.pressed() || fresh[sys::ESC] || away {
                cancel(&app, Some(gen));
                break;
            }
        }
    });
    if let Err(err) = spawned {
        eprintln!("menu-watch: {err}");
    }
}

/// Левый верхний угол меню размером `w`×`h` у точки `at` внутри рабочей области `work`:
/// не влезает вправо или вниз — открываем влево или вверх от курсора, а больше самой
/// области — прижимаем к её левому или верхнему краю.
fn place(at: (i32, i32), (w, h): (i32, i32), work: Rect) -> (i32, i32) {
    let axis = |p: i32, len: i32, lo: i32, hi: i32| {
        let p = if p + len > hi { p - len } else { p };
        p.min(hi - len).max(lo)
    };
    (axis(at.0, w, work.left, work.right), axis(at.1, h, work.top, work.bottom))
}

#[cfg(windows)]
pub(crate) mod sys {
    use super::Rect;
    use std::mem::size_of;
    use std::ptr::null_mut;
    use tauri::WebviewWindow;
    use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        ClientToScreen, GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetCursorPos, GetForegroundWindow, GetWindowRect, SetWindowPos, ShowWindowAsync,
        HWND_TOPMOST, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, SW_HIDE,
    };

    /// Номер Esc в [`pressed`]; до него — кнопки мыши.
    pub const ESC: usize = 3;

    /// HWND окна числом: так его можно держать и передавать между потоками.
    pub fn hwnd(w: &WebviewWindow) -> Result<isize, String> {
        w.hwnd().map(|h| h.0 as isize).map_err(|e| e.to_string())
    }

    /// Курсор в физических пикселях рабочего стола — в тех же, что и позиция окна.
    pub fn cursor() -> Option<(i32, i32)> {
        let mut p = POINT { x: 0, y: 0 };
        (unsafe { GetCursorPos(&mut p) } != 0).then_some((p.x, p.y))
    }

    /// Левая, правая, средняя кнопки мыши и Esc: зажаты ли сейчас.
    pub fn pressed() -> [bool; 4] {
        let down = |k: u16| unsafe { GetAsyncKeyState(k as i32) as u16 & 0x8000 != 0 };
        [down(VK_LBUTTON), down(VK_RBUTTON), down(VK_MBUTTON), down(VK_ESCAPE)]
    }

    pub fn foreground() -> isize {
        unsafe { GetForegroundWindow() as isize }
    }

    /// Рабочая область монитора под точкой: без панели задач.
    pub fn work_area((x, y): (i32, i32)) -> Rect {
        unsafe {
            let m = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST);
            let mut mi: MONITORINFO = std::mem::zeroed();
            mi.cbSize = size_of::<MONITORINFO>() as u32;
            if GetMonitorInfoW(m, &mut mi) == 0 {
                // без сведений о мониторе — хотя бы не дальше чем на экран от курсора
                return Rect { left: x - 4096, top: y - 4096, right: x + 4096, bottom: y + 4096 };
            }
            mi.rcWork.into()
        }
    }

    /// Насколько окно больше своей внутренней области с каждой стороны: Windows добавляет
    /// невидимые поля даже окну без рамки.
    unsafe fn insets(h: HWND) -> (i32, i32, i32, i32) {
        let (mut wr, mut cr): (RECT, RECT) = (std::mem::zeroed(), std::mem::zeroed());
        let mut o = POINT { x: 0, y: 0 };
        if GetWindowRect(h, &mut wr) == 0 || GetClientRect(h, &mut cr) == 0 || ClientToScreen(h, &mut o) == 0 {
            return (0, 0, 0, 0);
        }
        (o.x - wr.left, o.y - wr.top, wr.right - (o.x + cr.right), wr.bottom - (o.y + cr.bottom))
    }

    // Все вызовы асинхронные: окно живёт в главном потоке, а зовут отсюда из пула и из потока
    // слежения — ждать главный поток незачем, а под замком и опасно. Порядок в очереди окна сохраняется.

    /// Поставить внутреннюю область окна в `r` и показать, не активируя, поверх всех.
    pub fn show(h: isize, r: Rect) {
        unsafe {
            let h = h as HWND;
            let (l, t, rr, b) = insets(h);
            let (w, hh) = (r.right - r.left, r.bottom - r.top);
            SetWindowPos(
                h,
                HWND_TOPMOST,
                r.left - l,
                r.top - t,
                w + l + rr,
                hh + t + b,
                SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS,
            );
        }
    }

    /// Спрятанное окно — к точке, размер прежний.
    pub fn move_to(h: isize, (x, y): (i32, i32)) {
        unsafe {
            SetWindowPos(
                h as HWND,
                null_mut(),
                x,
                y,
                0,
                0,
                SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS,
            );
        }
    }

    pub fn hide(h: isize) {
        unsafe { ShowWindowAsync(h as HWND, SW_HIDE) };
    }
}

#[cfg(not(windows))]
pub(crate) mod sys {
    use super::Rect;
    use tauri::WebviewWindow;

    pub const ESC: usize = 3;

    pub fn hwnd(_: &WebviewWindow) -> Result<isize, String> {
        Err("своё меню есть только в Windows".into())
    }
    pub fn cursor() -> Option<(i32, i32)> {
        None
    }
    pub fn pressed() -> [bool; 4] {
        [false; 4]
    }
    pub fn foreground() -> isize {
        0
    }
    pub fn work_area(_: (i32, i32)) -> Rect {
        Rect::default()
    }
    pub fn show(_: isize, _: Rect) {}
    pub fn move_to(_: isize, _: (i32, i32)) {}
    pub fn hide(_: isize) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: Rect = Rect { left: 0, top: 0, right: 1920, bottom: 1040 };

    #[test]
    fn opens_right_and_down_from_cursor() {
        assert_eq!(place((100, 200), (180, 120), WORK), (100, 200));
    }

    #[test]
    fn flips_left_and_up_at_the_far_edges() {
        assert_eq!(place((1900, 1000), (180, 120), WORK), (1720, 880));
    }

    #[test]
    fn stays_inside_when_neither_side_fits() {
        // курсор у правого края второго монитора, меню шире всего, что слева
        let work = Rect { left: 1920, top: 0, right: 2100, bottom: 1040 };
        assert_eq!(place((2000, 10), (200, 120), work), (1920, 10));
    }

    #[test]
    fn cursor_on_taskbar_opens_above_it() {
        assert_eq!(place((500, 1060), (180, 120), WORK), (500, 920));
    }

    #[test]
    fn items_parse_from_the_pet_contract() {
        let items: Vec<Item> = serde_json::from_str(
            r#"[{"id":"feeder","text":"Кормушка","checked":true,"hint":"ест сама"},{"separator":true},{"id":"settings","text":"Настройки…","disabled":false}]"#,
        )
        .unwrap();
        assert_eq!(
            items,
            vec![
                Item::Entry {
                    id: "feeder".into(),
                    text: "Кормушка".into(),
                    checked: Some(true),
                    hint: Some("ест сама".into()),
                    disabled: false,
                },
                Item::Separator { separator: true },
                Item::Entry { id: "settings".into(), text: "Настройки…".into(), checked: None, hint: None, disabled: false },
            ]
        );
    }
}
