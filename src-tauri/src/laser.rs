//! Лазерная указка: держишь Ctrl — курсор становится красной точкой, кошка за ней охотится.
//!
//! Включается двумя путями. Ctrl, зажатый в одиночку на [`HOLD`], светит, пока его держат;
//! любое другое нажатие при зажатом Ctrl (клавиша, кнопка мыши, колесо) гасит попытку до
//! отпускания — так Ctrl+C, Ctrl+клик и Ctrl+колесо указку не зовут. Alt не годится: он уже
//! значит «клик сквозь питомца» (hit.rs). Второй путь — `set_laser(true)` из меню: светит,
//! пока не нажмут Esc, не позовут `set_laser(false)` или не начнётся «не мешать» (win::quiet):
//! в играх Ctrl — это присесть, поэтому в полноэкранном указки нет вовсе.
//!
//! Окну питомца уходят "laser" {x, y} — горячая точка курсора в физических пикселях рабочего
//! стола, не чаще 60 раз в секунду и только когда курсор сдвинулся, первое сразу при включении, —
//! и один раз "laser-off" при выключении. Системный курсор не трогаем.
//!
//! Два своих окна, оба прозрачные, сквозь них кликают, фокус они не берут никогда и всегда
//! спрятаны от записи экрана: "laser" — сама точка, её водит за курсором этот поток;
//! "push" — эффект заноса. Когда кошку на охоте заносит на развороте (roam.ts, режим 'skid'),
//! окно питомца зовёт [`skid`]: кусок экрана вокруг её лап снимается в память (BitBlt), окно
//! "push" ложится ровно поверх и рисует этот снимок с искажением: то, что было под лапами,
//! отбросило по ходу заноса, и оно пружинит обратно. На экране ничего не двигается по-настоящему. Снимок не пишется на диск и в лог,
//! уходит только окну "push" и выбрасывается сразу после эффекта (а невостребованный — через [`SHOT_TTL`]).

use crate::hit::SPRITE;
use crate::world::Rect;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Сколько держать Ctrl в одиночку, чтобы зажглась точка.
pub const HOLD: Duration = Duration::from_millis(400);
/// Опрос клавиш и курсора: 60 раз в секунду, столько же и событий "laser" самое большее.
const POLL: Duration = Duration::from_micros(16_667);
/// Как часто спрашивать win::quiet и поднимать точку наверх: 60 раз в секунду незачем.
const SLOW: Duration = Duration::from_millis(500);
/// Сторона окна точки, логические пиксели. Сама точка — около 10 px, остальное — свечение.
const DOT: f64 = 32.0;
/// Сторона снимаемого вокруг лап квадрата, логические пиксели.
const AREA: f64 = 160.0;
/// Невостребованный снимок дольше не держим: окно "push" забирает его за миллисекунды.
const SHOT_TTL: Duration = Duration::from_secs(1);

/// Ctrl в одиночку. Только логика: что зажато, решает поток опроса.
#[derive(Default)]
pub struct Trigger {
    /// С какого опроса держат Ctrl; `None` — отпущен.
    since: Option<Instant>,
    /// Пока Ctrl держат, было что-то ещё — до отпускания не зажигаемся.
    disarmed: bool,
}

impl Trigger {
    /// `ctrl` — зажат ли Ctrl, `other` — зажато или нажато ли с прошлого опроса что-то ещё.
    /// Возвращает, светить ли точке.
    pub fn feed(&mut self, ctrl: bool, other: bool, at: Instant) -> bool {
        if !ctrl {
            *self = Self::default();
            return false;
        }
        let since = *self.since.get_or_insert(at);
        self.disarmed |= other;
        !self.disarmed && at.duration_since(since) >= HOLD
    }

    /// Погасить и не зажигаться, пока Ctrl не отпустят.
    pub fn disarm(&mut self) {
        self.disarmed = self.since.is_some();
    }
}

/// Занос кошки.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Turn {
    /// Где её лапы, физ. пиксели рабочего стола.
    pub x: f64,
    pub y: f64,
    /// Куда её несёт, единичный вектор: туда и отбрасывает то, что было под лапами.
    pub dx: f64,
    pub dy: f64,
}

/// Квадрат `side` вокруг точки, обрезанный монитором.
pub fn area(x: i32, y: i32, side: i32, monitor: Rect) -> Rect {
    let (left, top) = (x - side / 2, y - side / 2);
    Rect {
        left: left.max(monitor.left),
        top: top.max(monitor.top),
        right: (left + side).min(monitor.right),
        bottom: (top + side).min(monitor.bottom),
    }
}

/// Спрайт на экране: левый верхний угол квадрата и сторона клетки арта, физ. пиксели.
#[derive(Clone, Copy, Debug)]
pub struct Sprite {
    pub left: f64,
    pub top: f64,
    pub cell: f64,
}

/// Сделать прозрачными пиксели снимка `px` (RGBA, прямоугольник `shot`), которые задевает
/// хоть одна нарисованная клетка спрайта, — маска `rows` как в hit.rs. Окно "push" лежит под
/// кошкой и миской, и без этого их копия на снимке съезжала бы из-под настоящих: зверь двоится.
/// Сквозь дыру видно сам экран, а настоящий спрайт и так лежит сверху.
pub fn cut(px: &mut [u8], shot: Rect, s: Sprite, rows: &[u32]) {
    let n = SPRITE as i64;
    let width = (shot.right - shot.left) as usize;
    let side = s.cell * SPRITE as f64;
    // клетки, которые задевает отрезок экрана [p, p + 1)
    let cells = |p: i32, origin: f64| {
        let a = ((p as f64 - origin) / s.cell).floor() as i64;
        let b = ((p as f64 + 1.0 - origin) / s.cell).ceil() as i64 - 1;
        a.max(0)..=b.min(n - 1)
    };
    let y0 = (s.top.floor() as i32).max(shot.top);
    let y1 = ((s.top + side).ceil() as i32).min(shot.bottom);
    let x0 = (s.left.floor() as i32).max(shot.left);
    let x1 = ((s.left + side).ceil() as i32).min(shot.right);
    for y in y0..y1 {
        let row = cells(y, s.top).fold(0u32, |acc, r| acc | rows.get(r as usize).copied().unwrap_or(0));
        if row == 0 {
            continue;
        }
        for x in x0..x1 {
            if cells(x, s.left).any(|c| row >> c & 1 == 1) {
                let i = ((y - shot.top) as usize * width + (x - shot.left) as usize) * 4;
                px[i + 3] = 0;
            }
        }
    }
}

/// Что окно "push" узнаёт о снимке до того, как забрать пиксели.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ShotMeta {
    id: u32,
    /// Размер снимка, физ. пиксели; пикселей придёт `width * height * 4` байт RGBA.
    width: u32,
    height: u32,
    /// Точка разворота внутри снимка, физ. пиксели.
    x: f64,
    y: f64,
    /// Куда заносило, единичный вектор.
    dx: f64,
    dy: f64,
    /// DPI / 96 монитора, где разворот.
    scale: f64,
    /// Стороны (левая, верхняя, правая, нижняя), за которыми нет экрана: у них смещение
    /// не обязано гаснуть, шва там не видно. У остальных оно сходит к нулю ровно на краю.
    open: [bool; 4],
}

/// Последний снимок. Новый вытесняет старый вместе с пикселями.
struct Shot {
    id: u32,
    rect: Rect,
    pixels: Option<Vec<u8>>,
    at: Option<Instant>,
}

static SHOT: Mutex<Shot> = Mutex::new(Shot { id: 0, rect: Rect { left: 0, top: 0, right: 0, bottom: 0 }, pixels: None, at: None });

/// Включили из меню: светит до Esc, `set_laser(false)` или «не мешать».
static STICKY: AtomicBool = AtomicBool::new(false);
/// Попросили погасить: поток гасит и ждёт, пока отпустят Ctrl.
static OFF: AtomicBool = AtomicBool::new(false);

/// Окно размером `side` логических пикселей: прозрачное, поверх всех, спрятанное, мышь насквозь.
/// Фокус не берёт: показывает и двигает его этот модуль через WinAPI без активации.
fn build_window(app: &AppHandle, label: &str, side: f64) -> tauri::Result<WebviewWindow> {
    let w = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("DeskRat")
        .inner_size(side, side)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .focused(false)
        .focusable(false)
        .content_protected(true)
        .build()?;
    w.set_ignore_cursor_events(true)?;
    Ok(w)
}

/// Строит окна точки и эффекта и запускает поток опроса. Зовётся один раз при старте:
/// окно из синхронной команды на Windows строить нельзя (wry#583), поэтому заранее.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let dot = build_window(app, "laser", DOT)?;
    let push = build_window(app, "push", AREA)?;
    #[cfg(windows)]
    sys::start(app.clone(), &dot, &push)?;
    #[cfg(not(windows))]
    let _ = (dot, push);
    Ok(())
}

/// Включить указку до Esc (`true`) или погасить её, как бы её ни включили (`false`).
#[tauri::command]
pub fn set_laser(on: bool) {
    STICKY.store(on, Ordering::Relaxed);
    if !on {
        OFF.store(true, Ordering::Relaxed);
    }
}

/// Кошку занесло: лапы в (x, y) физ. px, несёт в сторону (dx, dy). Снимок — в своём потоке,
/// команда возвращается сразу. Без лазера тоже: на погоне за мышью (mouse.ts).
#[tauri::command]
pub fn skid(app: AppHandle, x: f64, y: f64, dx: f64, dy: f64) {
    let l = dx.hypot(dy);
    if !(l > 0.0 && x.is_finite() && y.is_finite()) {
        return;
    }
    #[cfg(windows)]
    sys::skid_soon(app, Turn { x, y, dx: dx / l, dy: dy / l });
    #[cfg(not(windows))]
    let _ = app;
}

/// Пиксели снимка `id`, RGBA построчно сверху вниз. Отдаются один раз: в памяти Rust
/// после этого их нет. Устаревший или чужой `id` — ошибка, окно просто ждёт следующего.
#[tauri::command]
pub fn push_pixels(id: u32) -> Result<tauri::ipc::Response, String> {
    let mut shot = SHOT.lock().unwrap();
    if shot.id != id {
        return Err("снимок уже заменён".into());
    }
    shot.pixels.take().map(tauri::ipc::Response::new).ok_or_else(|| "снимок уже отдан".into())
}

/// Окно "push" готово рисовать снимок `id`: положить его ровно поверх снятого места и показать.
#[tauri::command]
pub fn push_show(id: u32) -> Result<(), String> {
    let shot = SHOT.lock().unwrap();
    if shot.id != id {
        return Err("снимок уже заменён".into());
    }
    #[cfg(windows)]
    sys::show_push(shot.rect);
    Ok(())
}

/// Эффект `id` доиграл: спрятать окно, если за это время не начался новый.
#[tauri::command]
pub fn push_done(id: u32) {
    let mut shot = SHOT.lock().unwrap();
    if shot.id == id {
        shot.pixels = None;
        #[cfg(windows)]
        sys::hide_push();
    }
}

#[cfg(windows)]
mod sys {
    use super::*;
    use crate::win::{self, Quiet};
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use std::ptr::null_mut;
    use std::sync::OnceLock;
    use tauri::Emitter;
    use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, ClientToScreen, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, GetDC, GetMonitorInfoW,
        MonitorFromPoint, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, MONITORINFO,
        MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTONULL, SRCCOPY,
    };
    use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_ESCAPE, VK_LCONTROL, VK_RCONTROL};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetCursorPos, GetWindowDisplayAffinity, GetWindowRect, IsWindowVisible, SetWindowDisplayAffinity,
        SetWindowPos, ShowWindowAsync, HWND_TOPMOST, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
        SWP_SHOWWINDOW, SW_HIDE, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };

    /// Окна как числа: HWND — сырой указатель, между потоками его так не передать.
    struct Hwnds {
        dot: isize,
        push: isize,
        /// Под кем лежит "push": под миской, а она под кошкой. Кошка спрятана от записи и в
        /// снимок не попадает — лёг бы снимок сверху, кошка пропала бы на полсекунды.
        /// Не спрятана — её вырезает [`cut_visible`], иначе копия на снимке съезжала бы из-под неё.
        under: isize,
        /// Спрятать "push" от захвата не вышло (Windows старше 10 2004): снимок увидел бы
        /// сам себя, поэтому эффекта нет совсем. Точку это не трогает.
        push_ok: bool,
    }

    static HWNDS: OnceLock<Hwnds> = OnceLock::new();

    fn hwnd(w: &WebviewWindow) -> tauri::Result<isize> {
        Ok(w.hwnd()?.0 as isize)
    }

    /// Спрятать от записи экрана и скриншотов: снимок под эффект не должен видеть ни точку, ни сам эффект.
    fn exclude(h: isize) -> bool {
        // SAFETY: только меняет атрибут окна.
        unsafe { SetWindowDisplayAffinity(h as HWND, WDA_EXCLUDEFROMCAPTURE) != 0 }
    }

    pub fn start(app: AppHandle, dot: &WebviewWindow, push: &WebviewWindow) -> tauri::Result<()> {
        let (d, p) = (hwnd(dot)?, hwnd(push)?);
        let under = ["bowl", "pet"]
            .iter()
            .find_map(|l| tauri::Manager::get_webview_window(&app, l))
            .and_then(|w| hwnd(&w).ok())
            .unwrap_or(HWND_TOPMOST as isize);
        if !exclude(d) {
            eprintln!("laser: точку не удалось спрятать от записи экрана");
        }
        let push_ok = exclude(p);
        if !push_ok {
            eprintln!("laser: окно эффекта не прячется от захвата — эффект заноса выключен");
        }
        let _ = HWNDS.set(Hwnds { dot: d, push: p, under, push_ok });
        std::thread::Builder::new().name("laser".into()).spawn(move || run(app)).map_err(tauri::Error::Io)?;
        Ok(())
    }

    fn down(vk: u16) -> bool {
        // SAFETY: только читает состояние клавиши.
        unsafe { GetAsyncKeyState(vk as i32) as u16 & 0x8000 != 0 }
    }

    /// Зажато ли сейчас что-то кроме Ctrl: клавиши и кнопки мыши (у них тоже есть коды).
    fn other_down() -> bool {
        (1u16..=254).filter(|vk| ![VK_CONTROL, VK_LCONTROL, VK_RCONTROL].contains(vk)).any(down)
    }

    /// Нажат ли Esc: зажат или успел нажаться и отпуститься с прошлого опроса.
    fn esc() -> bool {
        // SAFETY: только читает состояние клавиши.
        unsafe { GetAsyncKeyState(VK_ESCAPE as i32) != 0 }
    }

    fn cursor() -> Option<(i32, i32)> {
        let mut p = POINT { x: 0, y: 0 };
        // SAFETY: функция только пишет в переданную точку.
        (unsafe { GetCursorPos(&mut p) } != 0).then_some((p.x, p.y))
    }

    /// Монитор под точкой: его прямоугольник и DPI / 96.
    fn monitor(x: i32, y: i32) -> (Rect, f64) {
        // SAFETY: MonitorFromPoint с DEFAULTTONEAREST всегда что-то возвращает, остальное пишет в свои структуры.
        unsafe {
            let m = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST);
            let mut mi: MONITORINFO = zeroed();
            mi.cbSize = size_of::<MONITORINFO>() as u32;
            GetMonitorInfoW(m, &mut mi);
            let (mut dx, mut dy) = (0u32, 0u32);
            let ok = GetDpiForMonitor(m, MDT_EFFECTIVE_DPI, &mut dx, &mut dy) >= 0 && dx > 0;
            let r = mi.rcMonitor;
            (Rect { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, if ok { dx as f64 / 96.0 } else { 1.0 })
        }
    }

    fn on_screen(x: i32, y: i32) -> bool {
        // SAFETY: только спрашивает, есть ли монитор в точке.
        !unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONULL) }.is_null()
    }

    /// Где поставить внешний угол окна и какого размера оно должно быть, чтобы его внутренняя
    /// область встала ровно на `left, top` размером `w × h`: Windows добавляет невидимые поля
    /// даже окну без рамки (см. world::place_pet).
    fn frame(h: isize, left: i32, top: i32, w: i32, hgt: i32) -> (i32, i32, i32, i32) {
        // SAFETY: читают геометрию нашего окна в свои структуры.
        unsafe {
            let (mut wr, mut cr): (RECT, RECT) = (zeroed(), zeroed());
            let mut origin = POINT { x: 0, y: 0 };
            if GetWindowRect(h as HWND, &mut wr) == 0
                || GetClientRect(h as HWND, &mut cr) == 0
                || ClientToScreen(h as HWND, &mut origin) == 0
            {
                return (left, top, w, hgt);
            }
            let (ox, oy) = (origin.x - wr.left, origin.y - wr.top);
            let extra_w = (wr.right - wr.left) - (cr.right - cr.left);
            let extra_h = (wr.bottom - wr.top) - (cr.bottom - cr.top);
            (left - ox, top - oy, w + extra_w, hgt + extra_h)
        }
    }

    /// Поставить точку центром внутренней области на курсор. `raise` — заодно поднять её
    /// над всеми окнами поверх всех и показать; без него z-order не трогаем.
    fn move_dot(h: isize, x: i32, y: i32, raise: bool) {
        // SAFETY: читают размер нашего окна; SetWindowPos асинхронный и без активации.
        unsafe {
            let mut cr: RECT = zeroed();
            if GetClientRect(h as HWND, &mut cr) == 0 {
                return;
            }
            // окно бывает шире заказанного (SM_CXMINTRACK, см. hit.rs): точка нарисована по центру настоящего
            let (left, top, _, _) = frame(h, x - cr.right / 2, y - cr.bottom / 2, cr.right, cr.bottom);
            let mut flags = SWP_NOSIZE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS;
            flags |= if raise { SWP_SHOWWINDOW } else { SWP_NOZORDER };
            SetWindowPos(h as HWND, HWND_TOPMOST, left, top, 0, 0, flags);
        }
    }

    fn hide(h: isize) {
        // SAFETY: асинхронно прячет наше окно, не дожидаясь его потока.
        unsafe { ShowWindowAsync(h as HWND, SW_HIDE) };
    }

    /// Зовётся из команды push_show (главный поток, хозяин окна), поэтому синхронно.
    pub fn show_push(r: Rect) {
        let Some(h) = HWNDS.get() else { return };
        let (w, hgt) = (r.right - r.left, r.bottom - r.top);
        // два раза: переезд на монитор с другим DPI заставит окно поменять размер (WM_DPICHANGED),
        // второй вызов уже без переезда возвращает нужный
        for flags in [SWP_NOACTIVATE, SWP_NOACTIVATE | SWP_SHOWWINDOW] {
            let (left, top, fw, fh) = frame(h.push, r.left, r.top, w, hgt);
            // SAFETY: двигает и показывает наше окно без активации.
            unsafe { SetWindowPos(h.push as HWND, h.under as HWND, left, top, fw, fh, flags) };
        }
    }

    pub fn hide_push() {
        if let Some(h) = HWNDS.get() {
            hide(h.push);
        }
    }

    /// Снять экран в прямоугольнике `r` в память: RGBA, построчно сверху вниз. Окна точки и
    /// эффекта спрятаны от захвата, поэтому в снимок не попадают.
    fn grab(r: Rect) -> Option<Vec<u8>> {
        let (w, h) = (r.right - r.left, r.bottom - r.top);
        if w <= 0 || h <= 0 {
            return None;
        }
        // SAFETY: всё созданное здесь же и освобождается; биты DIB читаются после GdiFlush,
        // пока секция жива, и ровно в её размере w × h × 4.
        unsafe {
            let screen = GetDC(null_mut());
            if screen.is_null() {
                return None;
            }
            let mem = CreateCompatibleDC(screen);
            let mut bmi: BITMAPINFO = zeroed();
            bmi.bmiHeader = BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                // отрицательная высота — строки сверху вниз, как в ImageData
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..zeroed()
            };
            let mut bits: *mut c_void = null_mut();
            let dib = CreateDIBSection(mem, &bmi, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
            let mut out = None;
            if !mem.is_null() && !dib.is_null() && !bits.is_null() {
                let old = SelectObject(mem, dib);
                // CAPTUREBLT — вместе со слоистыми окнами, иначе прозрачные окна пропали бы со снимка
                if BitBlt(mem, 0, 0, w, h, screen, r.left, r.top, SRCCOPY | CAPTUREBLT) != 0 {
                    GdiFlush();
                    let src = std::slice::from_raw_parts(bits as *const u8, (w * h * 4) as usize);
                    let mut px = Vec::with_capacity(src.len());
                    // BGRx → RGBA, непрозрачный: эффект закрывает экран целиком
                    for c in src.chunks_exact(4) {
                        px.extend_from_slice(&[c[2], c[1], c[0], 255]);
                    }
                    out = Some(px);
                }
                SelectObject(mem, old);
            }
            if !dib.is_null() {
                DeleteObject(dib);
            }
            if !mem.is_null() {
                DeleteDC(mem);
            }
            ReleaseDC(null_mut(), screen);
            out
        }
    }

    /// Вырезать из снимка кошку и миску, если они на него попали: «прятать от записи» выключено.
    /// Лежак не трогаем — он под окном "push", тот его просто накрывает.
    fn cut_visible(app: &AppHandle, px: &mut [u8], shot: Rect) {
        let masks = tauri::Manager::state::<std::sync::Arc<crate::hit::Masks>>(app);
        for label in ["bowl", "pet"] {
            let Some(w) = tauri::Manager::get_webview_window(app, label) else { continue };
            let Ok(h) = hwnd(&w) else { continue };
            let Some(rows) = masks.rows(label) else { continue };
            // SAFETY: только читают атрибуты и геометрию нашего окна в свои переменные.
            let sprite = unsafe {
                let mut affinity = 0u32;
                if IsWindowVisible(h as HWND) == 0
                    || GetWindowDisplayAffinity(h as HWND, &mut affinity) == 0
                    || affinity != WDA_NONE
                {
                    continue;
                }
                let mut cr: RECT = zeroed();
                let mut o = POINT { x: 0, y: 0 };
                if GetClientRect(h as HWND, &mut cr) == 0 || ClientToScreen(h as HWND, &mut o) == 0 {
                    continue;
                }
                // спрайт — квадрат по центру окна, как в hit.rs: окно бывает шире заказанного
                let side = cr.right.min(cr.bottom) as f64;
                Sprite {
                    left: o.x as f64 + (cr.right as f64 - side) / 2.0,
                    top: o.y as f64 + (cr.bottom as f64 - side) / 2.0,
                    cell: side / SPRITE as f64,
                }
            };
            if sprite.cell > 0.0 {
                cut(px, shot, sprite, &rows);
            }
        }
    }

    /// Снять место заноса и позвать окно "push" — в своём потоке: BitBlt с экрана занимает до
    /// десятков миллисекунд, ни окно питомца, ни точка за курсором за это время не должны замирать.
    pub fn skid_soon(app: AppHandle, turn: Turn) {
        if HWNDS.get().is_some_and(|h| h.push_ok) {
            let _ = std::thread::Builder::new().name("laser-skid".into()).spawn(move || skid(app, turn));
        }
    }

    fn skid(app: AppHandle, turn: Turn) {
        let (tx, ty) = (turn.x.round() as i32, turn.y.round() as i32);
        let (mon, scale) = monitor(tx, ty);
        let r = area(tx, ty, (AREA * scale).round() as i32, mon);
        let Some(mut pixels) = grab(r) else { return };
        cut_visible(&app, &mut pixels, r);
        let open = [
            r.left == mon.left && !on_screen(r.left - 1, ty),
            r.top == mon.top && !on_screen(tx, r.top - 1),
            r.right == mon.right && !on_screen(r.right, ty),
            r.bottom == mon.bottom && !on_screen(tx, r.bottom),
        ];
        let meta = {
            let mut shot = SHOT.lock().unwrap();
            shot.id = shot.id.wrapping_add(1);
            shot.rect = r;
            shot.pixels = Some(pixels);
            shot.at = Some(Instant::now());
            ShotMeta {
                id: shot.id,
                width: (r.right - r.left) as u32,
                height: (r.bottom - r.top) as u32,
                x: turn.x - r.left as f64,
                y: turn.y - r.top as f64,
                dx: turn.dx,
                dy: turn.dy,
                scale,
                open,
            }
        };
        if let Err(err) = app.emit_to("push", "push", meta) {
            eprintln!("push: {err}");
        }
    }

    #[derive(Clone, serde::Serialize)]
    struct Dot {
        x: i32,
        y: i32,
    }

    fn run(app: AppHandle) {
        let Some(h) = HWNDS.get() else { return };
        let mut trigger = Trigger::default();
        let mut on = false;
        let mut quiet = false;
        let mut was_sticky = false;
        // пока указка включена из меню, Esc гасит её, а не что-то в активной программе
        let mut trap: Option<crate::esc::Trap> = None;
        // счётчик нажатий raw input на прошлом опросе: сдвинулся при зажатом Ctrl — было что-то ещё
        let mut presses = win::presses();
        let mut last: Option<(i32, i32)> = None;
        let mut slow = Instant::now() - SLOW;
        let mut next = Instant::now();
        loop {
            next += POLL;
            let now = Instant::now();
            if next > now {
                std::thread::sleep(next - now);
            } else {
                // проспали (сон, перегрузка) — не догоняем пачкой опросов
                next = now;
            }
            let at = Instant::now();
            {
                let mut shot = SHOT.lock().unwrap();
                if shot.at.is_some_and(|t| at.duration_since(t) > SHOT_TTL) {
                    shot.pixels = None;
                    shot.at = None;
                }
            }
            let slow_tick = at.duration_since(slow) >= SLOW;
            if slow_tick {
                slow = at;
                quiet = win::quiet() != Quiet::No || win::bossed();
            }

            let ctrl = down(VK_CONTROL);
            let count = win::presses();
            let other = ctrl && (count != presses || other_down());
            presses = count;
            let mut held = trigger.feed(ctrl, other, at);
            if OFF.swap(false, Ordering::Relaxed) {
                trigger.disarm();
                held = false;
            }
            let sticky = STICKY.load(Ordering::Relaxed);
            if sticky && !was_sticky {
                // только что включили из меню: сбросить у Esc «нажат с прошлого раза»,
                // иначе давнее нажатие погасило бы указку сразу
                let _ = esc();
                trap = Some(crate::esc::Trap::new());
            } else if sticky && (trap.as_mut().is_some_and(|t| t.pressed()) || esc()) {
                STICKY.store(false, Ordering::Relaxed);
            }
            let mut want = held || STICKY.load(Ordering::Relaxed);
            // зажечься можно и между медленными тиками — тогда «не мешать» спросим прямо сейчас
            if want && !on && !slow_tick {
                quiet = win::quiet() != Quiet::No || win::bossed();
            }
            if quiet {
                STICKY.store(false, Ordering::Relaxed);
                trigger.disarm();
                want = false;
            }
            was_sticky = STICKY.load(Ordering::Relaxed);
            if !was_sticky {
                trap = None;
            }

            if want != on {
                on = want;
                last = None;
                if !on {
                    hide(h.dot);
                    if let Err(err) = app.emit_to("pet", "laser-off", ()) {
                        eprintln!("laser-off: {err}");
                    }
                }
            }
            if !on {
                continue;
            }
            let Some((x, y)) = cursor() else { continue };
            if last != Some((x, y)) || slow_tick {
                // при включении и раз в SLOW — показать и поднять над окнами, что встали поверх
                move_dot(h.dot, x, y, last.is_none() || slow_tick);
            }
            if last != Some((x, y)) {
                last = Some((x, y));
                if let Err(err) = app.emit_to("pet", "laser", Dot { x, y }) {
                    eprintln!("laser: {err}");
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(t0: Instant, n: u64) -> Instant {
        t0 + Duration::from_millis(n)
    }

    /// Какие пиксели снимка прозрачны, построчно: '#' — вырезан, '.' — остался.
    fn holes(px: &[u8], w: usize) -> Vec<String> {
        px.chunks_exact(4).map(|c| if c[3] == 0 { '#' } else { '.' }).collect::<Vec<_>>().chunks(w).map(|r| r.iter().collect()).collect()
    }

    #[test]
    fn cut_removes_drawn_cells_and_their_fringe() {
        // снимок 6×4 с углом в (100, 200); спрайт с клеткой 2.5 px начинается в (99, 201):
        // клетка (0, 0) — x 99..101.5, y 201..203.5; клетка (1, 1) — x 101.5..104, y 203.5..206
        let shot = Rect { left: 100, top: 200, right: 106, bottom: 204 };
        let mut px = vec![255u8; 6 * 4 * 4];
        let mut rows = vec![0u32; SPRITE as usize];
        rows[0] = 0b01;
        rows[1] = 0b10;
        cut(&mut px, shot, Sprite { left: 99.0, top: 201.0, cell: 2.5 }, &rows);
        assert_eq!(
            holes(&px, 6),
            [
                "......", // y 200 — выше спрайта
                "##....", // y 201, 202 — клетка (0, 0): x 100 и 101, задетый наполовину
                "##....",
                "####..", // y 203 задевает обе строки клеток: (0, 0) по x 100..102 и (1, 1) по x 101..104
            ]
        );
    }

    #[test]
    fn cut_outside_the_shot_changes_nothing() {
        let shot = Rect { left: 0, top: 0, right: 4, bottom: 4 };
        let mut px = vec![255u8; 4 * 4 * 4];
        cut(&mut px, shot, Sprite { left: 500.0, top: 500.0, cell: 4.0 }, &[u32::MAX; 32]);
        assert!(px.iter().all(|&b| b == 255));
    }

    #[test]
    fn ctrl_alone_lights_after_hold() {
        let t0 = Instant::now();
        let mut t = Trigger::default();
        assert!(!t.feed(true, false, t0));
        assert!(!t.feed(true, false, ms(t0, 399)));
        assert!(t.feed(true, false, ms(t0, 400)));
        assert!(t.feed(true, false, ms(t0, 2000)));
        assert!(!t.feed(false, false, ms(t0, 2017)));
    }

    #[test]
    fn other_key_disarms_until_release() {
        let t0 = Instant::now();
        let mut t = Trigger::default();
        t.feed(true, false, t0);
        // Ctrl+C: C нажата до порога — до отпускания Ctrl точки нет
        assert!(!t.feed(true, true, ms(t0, 100)));
        assert!(!t.feed(true, false, ms(t0, 600)));
        // и после порога тоже гасит
        t.feed(false, false, ms(t0, 700));
        t.feed(true, false, ms(t0, 800));
        assert!(t.feed(true, false, ms(t0, 1200)));
        assert!(!t.feed(true, true, ms(t0, 1300)));
        assert!(!t.feed(true, false, ms(t0, 1400)));
        // отпустили и зажали заново — снова можно
        t.feed(false, false, ms(t0, 1500));
        t.feed(true, false, ms(t0, 1600));
        assert!(t.feed(true, false, ms(t0, 2000)));
    }

    #[test]
    fn key_held_before_ctrl_disarms() {
        let t0 = Instant::now();
        let mut t = Trigger::default();
        // Shift зажат раньше Ctrl: уже на первом опросе «что-то ещё»
        assert!(!t.feed(true, true, t0));
        assert!(!t.feed(true, false, ms(t0, 1000)));
    }

    #[test]
    fn disarm_waits_for_release() {
        let t0 = Instant::now();
        let mut t = Trigger::default();
        t.feed(true, false, t0);
        assert!(t.feed(true, false, ms(t0, 500)));
        t.disarm();
        assert!(!t.feed(true, false, ms(t0, 600)));
        // отпущенный Ctrl погасить нечем: следующее нажатие работает как обычно
        t.feed(false, false, ms(t0, 700));
        t.disarm();
        t.feed(true, false, ms(t0, 800));
        assert!(t.feed(true, false, ms(t0, 1200)));
    }

    #[test]
    fn area_is_clipped_by_monitor() {
        let m = Rect { left: 0, top: 0, right: 1920, bottom: 1080 };
        assert_eq!(area(500, 500, 160, m), Rect { left: 420, top: 420, right: 580, bottom: 580 });
        assert_eq!(area(10, 1075, 160, m), Rect { left: 0, top: 995, right: 90, bottom: 1080 });
        let left = Rect { left: -1280, top: -200, right: 0, bottom: 824 };
        assert_eq!(area(-5, -190, 240, left), Rect { left: -125, top: -200, right: 0, bottom: -70 });
    }
}
