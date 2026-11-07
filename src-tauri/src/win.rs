//! Всё, что завязано на Windows API. Взято из pc_wrapped.
//!
//! Ввод читаем через Raw Input, а не через глобальные хуки: хук встаёт в цепочку обработки
//! каждого нажатия и может добавить задержку в играх, а Raw Input просто присылает копию
//! событий в наше невидимое окно. Поэтому питомец не влияет на отзывчивость ввода.
//!
//! Заголовки окон здесь не читаются нигде: про активное окно узнаём только, чей это exe.

use crate::tracker::Tracker;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};
use windows_sys::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER, RIDEV_INPUTSINK, RID_INPUT,
    RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetForegroundWindow, GetMessageW, GetWindowThreadProcessId, RegisterClassW,
    HWND_MESSAGE, MSG, WM_INPUT, WNDCLASSW,
};

static SINK: OnceLock<Arc<Mutex<Tracker>>> = OnceLock::new();

const RI_KEY_BREAK: u16 = 1;
const MOUSE_MOVE_ABSOLUTE: u16 = 1;
/// Нажатия кнопок мыши (левая, правая, средняя, две боковые) и прокрутка колесом в обе стороны.
const MOUSE_PRESSES: u16 = 0x0001 | 0x0004 | 0x0010 | 0x0040 | 0x0100 | 0x0400 | 0x0800;
/// Ctrl, левый и правый: его держат для лазерной указки, сам он «другим нажатием» не считается.
const CTRL_KEYS: [u16; 3] = [0x11, 0xA2, 0xA3];

/// Сколько всего было нажатий, кроме Ctrl: клавиши, кнопки мыши, колесо. Лазер (laser.rs)
/// смотрит, сдвинулся ли счётчик, пока держат Ctrl: так видны Ctrl+колесо и короткий Ctrl+C,
/// которые опрос GetAsyncKeyState пропустил бы.
static PRESSES: AtomicU32 = AtomicU32::new(0);

pub fn presses() -> u32 {
    PRESSES.load(Ordering::Relaxed)
}

/// Сочетания, которые питомец слышит. Raw Input присылает копию нажатий, поэтому у других
/// программ они не отбираются: кому ещё нужны, тот их тоже получит.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hotkey {
    /// Ctrl+Alt+Shift+H — «босс идёт»: спрятать питомца со всем хозяйством, повторно — вернуть.
    Boss,
    /// PrintScreen или Win+Shift+S: снимают экран — кошка позирует.
    Shot,
}

const VK_SHIFT: u16 = 0x10;
const VK_CONTROL: u16 = 0x11;
const VK_MENU: u16 = 0x12;
const VK_SNAPSHOT: u16 = 0x2C;
const VK_H: u16 = 0x48;
const VK_S: u16 = 0x53;
const VK_LWIN: u16 = 0x5B;
const VK_RWIN: u16 = 0x5C;

/// Какие модификаторы зажаты в момент нажатия.
#[derive(Clone, Copy, Debug, Default)]
pub struct Mods {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub win: bool,
}

/// Сочетание по клавише. PrintScreen — по отпусканию: нажатие этой клавиши приходит не со всех
/// клавиатур, а отпускание — со всех. Остальное — по нажатию, без автоповтора (`repeat`).
pub fn hotkey(vkey: u16, down: bool, repeat: bool, m: Mods) -> Option<Hotkey> {
    if vkey == VK_SNAPSHOT && !down {
        return Some(Hotkey::Shot);
    }
    if !down || repeat {
        return None;
    }
    match vkey {
        VK_S if m.win && m.shift && !m.ctrl && !m.alt => Some(Hotkey::Shot),
        VK_H if m.ctrl && m.alt && m.shift && !m.win => Some(Hotkey::Boss),
        _ => None,
    }
}

fn mods() -> Mods {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    // SAFETY: только читает состояние клавиши.
    let held = |vk: u16| unsafe { GetAsyncKeyState(vk as i32) } < 0;
    Mods { ctrl: held(VK_CONTROL), alt: held(VK_MENU), shift: held(VK_SHIFT), win: held(VK_LWIN) || held(VK_RWIN) }
}

type HotkeyFn = Box<dyn Fn(Hotkey) + Send + Sync>;
static ON_HOTKEY: OnceLock<HotkeyFn> = OnceLock::new();
/// Последняя зажатая клавиша: её повторные нажатия — автоповтор, а не новое сочетание.
static LAST_DOWN: AtomicU16 = AtomicU16::new(0);

/// Кого звать, когда нажали сочетание. Зовётся из потока ввода — пусть отдаёт работу дальше.
pub fn on_hotkey(f: impl Fn(Hotkey) + Send + Sync + 'static) {
    let _ = ON_HOTKEY.set(Box::new(f));
}

/// «Босс идёт»: питомец спрятан. Лазер в это время тоже не зажигается.
static BOSS: AtomicBool = AtomicBool::new(false);

pub fn bossed() -> bool {
    BOSS.load(Ordering::Relaxed)
}

/// Переключить «босса»; возвращает, спрятан ли питомец теперь.
pub fn toggle_boss() -> bool {
    !BOSS.fetch_xor(true, Ordering::Relaxed)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Запускает поток с невидимым окном, которое получает Raw Input от всех мышей и клавиатур.
pub fn start_input(tracker: Arc<Mutex<Tracker>>) {
    if SINK.set(tracker).is_err() {
        return;
    }
    std::thread::Builder::new()
        .name("raw-input".into())
        .spawn(|| unsafe { input_thread() })
        .expect("raw input thread");
}

unsafe fn input_thread() {
    let class = wide("deskrat_raw_input");
    let hinst = GetModuleHandleW(std::ptr::null());
    let mut wc: WNDCLASSW = std::mem::zeroed();
    wc.lpfnWndProc = Some(wndproc);
    wc.hInstance = hinst;
    wc.lpszClassName = class.as_ptr();
    RegisterClassW(&wc);
    let hwnd = CreateWindowExW(
        0,
        class.as_ptr(),
        std::ptr::null(),
        0,
        0,
        0,
        0,
        0,
        HWND_MESSAGE,
        std::ptr::null_mut(),
        hinst,
        std::ptr::null(),
    );
    if hwnd.is_null() {
        return;
    }
    let devices = [
        // мышь: Generic Desktop / Mouse
        RAWINPUTDEVICE { usUsagePage: 0x01, usUsage: 0x02, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd },
        // клавиатура: Generic Desktop / Keyboard
        RAWINPUTDEVICE { usUsagePage: 0x01, usUsage: 0x06, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd },
    ];
    if RegisterRawInputDevices(devices.as_ptr(), devices.len() as u32, std::mem::size_of::<RAWINPUTDEVICE>() as u32) == 0 {
        return;
    }
    let mut msg: MSG = std::mem::zeroed();
    while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
        DispatchMessageW(&msg);
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_INPUT {
        handle_input(lparam as HRAWINPUT);
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

unsafe fn handle_input(h: HRAWINPUT) {
    // RAWINPUT для мыши и клавиатуры влезает в 64 байта; берём с запасом и с выравниванием.
    let mut buf = [0u64; 16];
    let mut size = std::mem::size_of_val(&buf) as u32;
    let got = GetRawInputData(h, RID_INPUT, buf.as_mut_ptr().cast(), &mut size, std::mem::size_of::<RAWINPUTHEADER>() as u32);
    if got == u32::MAX || got == 0 {
        return;
    }
    let raw = &*(buf.as_ptr() as *const RAWINPUT);
    let Some(sink) = SINK.get() else { return };
    let mut hot = None;
    let Ok(mut t) = sink.lock() else { return };
    match raw.header.dwType {
        RIM_TYPEKEYBOARD => {
            let kb = raw.data.keyboard;
            let down = kb.Flags & RI_KEY_BREAK == 0;
            if down && !CTRL_KEYS.contains(&kb.VKey) {
                PRESSES.fetch_add(1, Ordering::Relaxed);
            }
            t.on_key(kb.VKey, down);
            let repeat = if down {
                LAST_DOWN.swap(kb.VKey, Ordering::Relaxed) == kb.VKey
            } else {
                let _ = LAST_DOWN.compare_exchange(kb.VKey, 0, Ordering::Relaxed, Ordering::Relaxed);
                false
            };
            // модификаторы спрашиваем, только когда клавиша может быть частью сочетания
            if matches!(kb.VKey, VK_SNAPSHOT | VK_H | VK_S) {
                hot = hotkey(kb.VKey, down, repeat, mods());
            }
        }
        RIM_TYPEMOUSE => {
            let m = raw.data.mouse;
            // планшеты и удалённый рабочий стол присылают абсолютные координаты — их не считаем
            if m.usFlags & MOUSE_MOVE_ABSOLUTE == 0 {
                t.on_move(m.lLastX, m.lLastY);
            }
            let flags = m.Anonymous.Anonymous.usButtonFlags;
            if flags & MOUSE_PRESSES != 0 {
                PRESSES.fetch_add(1, Ordering::Relaxed);
            }
            if flags != 0 {
                t.on_buttons(flags);
            }
        }
        _ => {}
    }
    // трекер отпускаем до вызова: обработчик трогает окна и не должен держать ввод
    drop(t);
    if let (Some(h), Some(f)) = (hot, ON_HOTKEY.get()) {
        f(h);
    }
}

/// Название программы в активном окне: «Описание файла» из exe (Google Chrome, Battle.net),
/// а если его нет — имя exe без расширения.
pub struct Foreground {
    cache: HashMap<String, String>,
}

impl Foreground {
    pub fn new() -> Self {
        Foreground { cache: HashMap::new() }
    }

    pub fn current(&mut self) -> Option<String> {
        let path = unsafe { foreground_exe()? };
        if let Some(n) = self.cache.get(&path) {
            return Some(n.clone());
        }
        let name = unsafe { file_description(&path) }.unwrap_or_else(|| exe_stem(&path));
        if self.cache.len() > 500 {
            self.cache.clear();
        }
        self.cache.insert(path, name.clone());
        Some(name)
    }
}

pub fn exe_stem(path: &str) -> String {
    let file = path.rsplit(['\\', '/']).next().unwrap_or(path);
    file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file).to_string()
}

/// Полный путь к exe активного окна: по нему «Кино вместе» узнаёт плеер.
pub fn foreground_path() -> Option<String> {
    // SAFETY: только чтение пути процесса, хэндл закрывается внутри.
    unsafe { foreground_exe() }
}

/// Полный путь к exe окна `hwnd` (из [`crate::world::covering`]): только путь процесса, не заголовок.
pub fn window_path(hwnd: i64) -> Option<String> {
    // SAFETY: окно могли закрыть — тогда pid 0 и None; хэндл процесса закрывается внутри.
    unsafe { exe_of(hwnd as isize as _) }
}

unsafe fn foreground_exe() -> Option<String> {
    exe_of(GetForegroundWindow())
}

unsafe fn exe_of(hwnd: HWND) -> Option<String> {
    if hwnd.is_null() {
        return None;
    }
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if pid == 0 {
        return None;
    }
    let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if h.is_null() {
        return None;
    }
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len);
    CloseHandle(h);
    if ok == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..len as usize]))
}

unsafe fn file_description(path: &str) -> Option<String> {
    let wpath = wide(path);
    let size = GetFileVersionInfoSizeW(wpath.as_ptr(), std::ptr::null_mut());
    if size == 0 {
        return None;
    }
    let mut data = vec![0u8; size as usize];
    if GetFileVersionInfoW(wpath.as_ptr(), 0, size, data.as_mut_ptr().cast()) == 0 {
        return None;
    }
    // язык и кодовая страница первой записи
    let mut ptr: *mut core::ffi::c_void = std::ptr::null_mut();
    let mut len = 0u32;
    let tr = wide("\\VarFileInfo\\Translation");
    if VerQueryValueW(data.as_ptr().cast(), tr.as_ptr(), &mut ptr, &mut len) == 0 || len < 4 {
        return None;
    }
    let lang = *(ptr as *const u16);
    let cp = *(ptr as *const u16).add(1);
    let key = wide(&format!("\\StringFileInfo\\{lang:04x}{cp:04x}\\FileDescription"));
    if VerQueryValueW(data.as_ptr().cast(), key.as_ptr(), &mut ptr, &mut len) == 0 || len == 0 {
        return None;
    }
    let s = std::slice::from_raw_parts(ptr as *const u16, len as usize);
    let s = String::from_utf16_lossy(s);
    let s = s.trim_end_matches('\0').trim();
    if s.is_empty() || s.len() > 60 { None } else { Some(s.to_string()) }
}

/// Жёсткие диски, кроме системного: `["D:\\", "E:\\"]`. Флешки и сетевые не берём.
/// Для первого запуска: туда ложатся питомец, дневник и кэш.
#[allow(dead_code)] // экрана первого запуска ещё нет
pub fn data_drives() -> Vec<String> {
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    const DRIVE_FIXED: u32 = 3;
    let system = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).to_ascii_uppercase();
    let mask = unsafe { GetLogicalDrives() };
    (0..26u8)
        .filter(|i| mask & (1 << i) != 0)
        .map(|i| format!("{}:\\", (b'A' + i) as char))
        .filter(|d| !d.starts_with(&system))
        .filter(|d| {
            let w = wide(d);
            unsafe { GetDriveTypeW(w.as_ptr()) == DRIVE_FIXED }
        })
        .collect()
}

/// Почему сейчас лучше не мешать — та же проверка, по которой молчат уведомления самой Windows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Quiet {
    /// Можно.
    No,
    /// Что-то на весь экран: игра «без рамки», видео, браузер по F11.
    Fullscreen,
    /// Эксклюзивный полноэкранный Direct3D: поверх него окно не рисуется, а клик по питомцу
    /// свернёт игру. Питомца на этом мониторе нет вообще.
    ExclusiveFullscreen,
    /// Режим презентации.
    Presentation,
    /// Экран заблокирован или идёт переключение пользователя.
    Away,
}

/// QUNS_QUIET_TIME сюда не входит: это не «Не беспокоить», а первый час после создания учётки.
pub fn quiet() -> Quiet {
    use windows_sys::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_NOT_PRESENT, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    let mut state = 0;
    // SAFETY: функция только пишет состояние в переданную переменную.
    if unsafe { SHQueryUserNotificationState(&mut state) } < 0 {
        return Quiet::No;
    }
    match state {
        QUNS_BUSY => Quiet::Fullscreen,
        QUNS_RUNNING_D3D_FULL_SCREEN => Quiet::ExclusiveFullscreen,
        QUNS_PRESENTATION_MODE => Quiet::Presentation,
        QUNS_NOT_PRESENT => Quiet::Away,
        _ => Quiet::No,
    }
}

/// Ноутбук работает от батареи: кошка бережёт силы и спит чаще. Без батареи или непонятно — false.
pub fn on_battery() -> bool {
    use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    // SAFETY: структура из чисел, нули в ней допустимы.
    let mut s: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
    // SAFETY: функция только пишет состояние в переданную структуру.
    if unsafe { GetSystemPowerStatus(&mut s) } == 0 {
        return false;
    }
    // ACLineStatus: 0 — от батареи, 1 — от сети, 255 — не известно
    s.ACLineStatus == 0
}

/// Сколько всего лежит в корзине на всех дисках; None — Windows не ответила.
/// Имена файлов не смотрим, только число.
pub fn bin_items() -> Option<i64> {
    use windows_sys::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};
    // SAFETY: структура из чисел, нули в ней допустимы.
    let mut info: SHQUERYRBINFO = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHQUERYRBINFO>() as u32;
    // SAFETY: пустой путь — все диски; функция только пишет в переданную структуру.
    let hr = unsafe { SHQueryRecycleBinW(std::ptr::null(), &mut info) };
    (hr >= 0).then_some(info.i64NumItems)
}

/// Корзину очистили: было что-то, стало пусто. Неизвестное состояние ни с чем не сравниваем.
pub fn bin_emptied(before: Option<i64>, now: Option<i64>) -> bool {
    matches!((before, now), (Some(b), Some(0)) if b > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bin_emptied_only_on_drop_to_zero() {
        assert!(bin_emptied(Some(3), Some(0)));
        assert!(!bin_emptied(Some(0), Some(0)));
        assert!(!bin_emptied(Some(3), Some(1)));
        assert!(!bin_emptied(None, Some(0)));
        assert!(!bin_emptied(Some(3), None));
    }

    #[test]
    fn hotkeys() {
        let none = Mods::default();
        let ctrl_alt = Mods { ctrl: true, alt: true, shift: true, ..none };
        let win_shift = Mods { win: true, shift: true, ..none };
        assert_eq!(hotkey(VK_SNAPSHOT, false, false, none), Some(Hotkey::Shot));
        assert_eq!(hotkey(VK_SNAPSHOT, true, false, none), None);
        assert_eq!(hotkey(VK_S, true, false, win_shift), Some(Hotkey::Shot));
        assert_eq!(hotkey(VK_S, true, false, Mods { shift: true, ..none }), None);
        assert_eq!(hotkey(VK_H, true, false, ctrl_alt), Some(Hotkey::Boss));
        // автоповтор и отпускание не переключают «босса» туда-обратно
        assert_eq!(hotkey(VK_H, true, true, ctrl_alt), None);
        assert_eq!(hotkey(VK_H, false, false, ctrl_alt), None);
        assert_eq!(hotkey(VK_H, true, false, Mods { shift: false, ..ctrl_alt }), None);
        assert_eq!(hotkey(VK_H, true, false, none), None);
    }

    #[test]
    fn exe_stem_drops_dir_and_extension() {
        assert_eq!(exe_stem(r"C:\Program Files\Steam\steam.exe"), "steam");
        assert_eq!(exe_stem(r"D:\Games\CS2.EXE"), "CS2");
        assert_eq!(exe_stem("blender"), "blender");
    }
}
