//! Папка данных, которую человек выбрал при первом запуске, и файлы состояния в ней.
//!
//! Где лежит папка, помнит только `%APPDATA%\DeskRat\location.json` = `{"dir": "..."}` —
//! путь и больше ничего: всё остальное о питомце живёт там, куда указал человек.
//! Ядро — чистые функции с явными путями (их и тестируем), команды Tauri только подставляют
//! путь к location.json.
//!
//! Все файлы состояния и кэши имеют префикс `deskrat-`, в том числе при выборе папки
//! DeskPartner. Временные файлы создаются эксклюзивно, отдельно для каждой записи.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use crate::i18n::{en, tr};

/// Ключи состояния фронтенда: их файлы переезжают при смене папки.
pub const KEYS: [&str; 9] = ["belly", "sleep", "stats", "spot", "settings", "bowl", "bed", "talk", "revenge"];

/// Имя папки и в %APPDATA%, и в предложениях. Не identifier из tauri.conf.json:
/// app_config_dir() дал бы `%APPDATA%\io.github.konstantinushakov.deskrat`, а человек ищет «DeskRat».
const NAME: &str = "DeskRat";

#[derive(Serialize, Deserialize)]
struct Location {
    dir: String,
}

/// `%APPDATA%\DeskRat\location.json`; вне Windows — `~/.config/DeskRat/location.json`.
fn location_file() -> Result<PathBuf, String> {
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(not(windows))]
    let base = std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config"));
    base.map(|b| b.join(NAME).join("location.json")).ok_or_else(|| tr("не найдена папка профиля", "user profile folder not found").into())
}

/// Папка из location.json. Нет файла, он битый, путь относительный или папки уже нет —
/// значит, папки нет: фронтенд покажет первый запуск заново.
pub fn read_dir(location: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(location).ok()?;
    let loc: Location = serde_json::from_str(&text).ok()?;
    let dir = PathBuf::from(loc.dir);
    (dir.is_absolute() && dir.is_dir()).then_some(dir)
}

/// Запись через `.tmp` и переименование: оборвись она на середине — старый файл цел.
/// std::fs::rename на Windows заменяет существующий файл (MoveFileEx с REPLACE_EXISTING).
fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    reject_link(path)?;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    // Exclusive, unique temporary files: never truncate a pre-existing file or link.
    let (tmp, mut f) = loop {
        let mut tmp = path.as_os_str().to_owned();
        tmp.push(format!(".{}-{}.tmp", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        let tmp = PathBuf::from(tmp);
        match fs::OpenOptions::new().write(true).create_new(true).open(&tmp) {
            Ok(f) => break (tmp, f),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    };
    let result = (|| {
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    if result.is_err() { let _ = fs::remove_file(&tmp); }
    result
}

/// Проверка записью, а не по атрибутам: права, OneDrive и антивирус узнаются только так.
fn probe(dir: &Path) -> Result<(), String> {
    // Only create our own file; the upstream .probe may already contain user data.
    let file = dir.join(format!(".deskrat-probe-{}", std::process::id()));
    let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&file)
        .map_err(|e| e.to_string())?;
    let result = f.write_all(b"DeskRat").and_then(|_| f.sync_all());
    drop(f);
    let removed = fs::remove_file(&file);
    result.and(removed).map_err(|e| e.to_string())
}

/// Одна и та же папка, даже если путь записан по-разному (регистр, `..`, слэши).
fn same_dir(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn state_file(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("deskrat-{key}.json"))
}

// Do not follow state-file links into another app's data. Windows junctions and
// other reparse points are rejected too. This is not a sandbox against same-user races.
fn reject_link(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            #[cfg(windows)]
            let linked = {
                use std::os::windows::fs::MetadataExt;
                meta.file_attributes() & 0x400 != 0
            };
            #[cfg(not(windows))]
            let linked = meta.file_type().is_symlink();
            if linked { return Err(io::Error::other("linked state files are not supported")); }
            Ok(())
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Копирует файлы состояния из `from` в `to` и сверяет копии. Что в `to` уже есть, не трогаем:
/// там побеждает новая папка. Возвращает оригиналы, которые можно удалить.
/// При ошибке убирает уже сделанные копии, чтобы старая папка оставалась единственной правдой.
fn copy_states(from: &Path, to: &Path) -> Result<Vec<PathBuf>, String> {
    let mut copied: Vec<(PathBuf, PathBuf)> = Vec::new();
    for key in KEYS {
        let (src, dst) = (state_file(from, key), state_file(to, key));
        if let Err(e) = reject_link(&src).and_then(|_| reject_link(&dst)) {
            for (_, d) in &copied { let _ = fs::remove_file(d); }
            return Err(e.to_string());
        }
        if dst.exists() && !dst.is_file() {
            for (_, d) in &copied { let _ = fs::remove_file(d); }
            return Err(format!("not a state file: {}", dst.display()));
        }
        if dst.exists() || !src.is_file() {
            continue;
        }
        let done = fs::read(&src).and_then(|b| {
            write_atomic(&dst, &b)?;
            let same = fs::read(&dst)? == b;
            same.then_some(()).ok_or_else(|| io::Error::other("копия не совпала"))
        });
        if let Err(err) = done {
            let _ = fs::remove_file(&dst);
            for (_, d) in &copied {
                let _ = fs::remove_file(d);
            }
            return Err(if en() { format!("couldn't move {key}.json: {err}") } else { format!("не получилось перенести {key}.json: {err}") });
        }
        copied.push((src, dst));
    }
    Ok(copied.into_iter().map(|(s, _)| s).collect())
}

/// Выбрать папку данных: создать, проверить записью, перевезти состояние из прежней и
/// запомнить путь. Оригиналы удаляются только после записи location.json — до этого момента
/// прежняя папка остаётся рабочей, и сбой на любом шаге ничего не теряет.
pub fn set_dir(location: &Path, dir: &str) -> Result<(), String> {
    let dir = PathBuf::from(dir);
    if !dir.is_absolute() {
        return Err(tr("нужен полный путь к папке", "a full folder path is needed").into());
    }
    fs::create_dir_all(&dir).map_err(|e| if en() { format!("can't create the folder: {e}") } else { format!("не получается создать папку: {e}") })?;
    probe(&dir)?;
    let prev = read_dir(location).filter(|p| !same_dir(p, &dir));
    let moved = match &prev {
        Some(p) => copy_states(p, &dir)?,
        None => Vec::new(),
    };
    let parent = location.parent().ok_or(tr("не найдена папка профиля", "user profile folder not found"))?;
    let json = serde_json::to_string(&Location { dir: dir.to_string_lossy().into_owned() }).map_err(|e| e.to_string())?;
    let remembered = fs::create_dir_all(parent)
        .and_then(|_| write_atomic(location, json.as_bytes()))
        .map_err(|e| if en() { format!("can't remember the folder: {e}") } else { format!("не получается запомнить папку: {e}") });
    if let Err(e) = remembered {
        for src in &moved {
            if let Some(name) = src.file_name() { let _ = fs::remove_file(dir.join(name)); }
        }
        return Err(e);
    }
    for src in moved {
        // не удалился — останется лишняя копия в старой папке, но данные уже в новой
        let _ = fs::remove_file(src);
    }
    Ok(())
}

/// Only the known state and cache keys are accessible through IPC.
fn check_key(key: &str) -> Result<(), String> {
    let ok = KEYS.contains(&key) || ["wiki", "reviews", "news"].contains(&key);
    ok.then_some(()).ok_or_else(|| format!("недопустимый ключ: {key:?}"))
}

pub fn load(dir: Option<&Path>, key: &str) -> Result<Option<String>, String> {
    check_key(key)?;
    let Some(dir) = dir else { return Ok(None) };
    reject_link(&state_file(dir, key)).map_err(|e| e.to_string())?;
    match fs::read_to_string(state_file(dir, key)) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(if en() { format!("can't read {key}.json: {e}") } else { format!("не получается прочитать {key}.json: {e}") }),
    }
}

pub fn save(dir: Option<&Path>, key: &str, value: &str) -> Result<(), String> {
    check_key(key)?;
    let dir = dir.ok_or(tr("папка данных не выбрана", "no data folder chosen"))?;
    write_atomic(&state_file(dir, key), value.as_bytes())
        .map_err(|e| if en() { format!("can't save {key}.json: {e}") } else { format!("не получается сохранить {key}.json: {e}") })
}

/// Сначала несистемные локальные диски (`X:\DeskRat`), последним — папка пользователя.
/// Корня системного диска, Windows и Program Files тут не бывает по построению.
pub fn suggestions(fixed: &[char], system: char, home: Option<&Path>) -> Vec<String> {
    let drives = fixed
        .iter()
        .filter(|d| !d.eq_ignore_ascii_case(&system))
        .map(|d| format!("{}:\\{NAME}", d.to_ascii_uppercase()));
    drives.chain(home.map(|h| h.join(NAME).to_string_lossy().into_owned())).collect()
}

fn current() -> Option<PathBuf> {
    read_dir(&location_file().ok()?)
}

/// Выбрана ли папка — без неё finish_setup питомца не откроет.
pub fn has_dir() -> bool {
    current().is_some()
}

/// Первый запуск пройден до конца: папка выбрана и настройки в ней лежат. Папку запоминаем
/// уже на первом экране, поэтому одной её мало — закрыл мастер на темах, и при следующем
/// запуске его бы больше не спросили.
pub fn set_up() -> bool {
    location_file().is_ok_and(|l| finished(&l))
}

fn finished(location: &Path) -> bool {
    read_dir(location).is_some_and(|d| state_file(&d, "settings").is_file())
}

/// Текущая папка данных; `None` — первый запуск (или папку с тех пор удалили).
#[tauri::command]
pub fn data_dir() -> Option<String> {
    current().map(|d| d.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn suggest_dirs() -> Vec<String> {
    let home = std::env::var_os(sys::HOME).map(PathBuf::from);
    suggestions(&sys::fixed_drives(), sys::system_drive(), home.as_deref())
}

#[tauri::command]
pub fn set_data_dir(dir: String) -> Result<(), String> {
    set_dir(&location_file()?, &dir)
}

#[tauri::command]
pub fn load_state(key: String) -> Result<Option<String>, String> {
    load(current().as_deref(), &key)
}

#[tauri::command]
pub fn save_state(key: String, value: String) -> Result<(), String> {
    save(current().as_deref(), &key, &value)
}

#[cfg(windows)]
mod sys {
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    use windows_sys::Win32::System::WindowsProgramming::DRIVE_FIXED;

    pub const HOME: &str = "USERPROFILE";

    /// Буквы локальных несъёмных дисков: флешка или сетевой диск пропадут — пропадёт и питомец.
    pub fn fixed_drives() -> Vec<char> {
        // SAFETY: без аргументов, только читает маску букв
        let mask = unsafe { GetLogicalDrives() };
        (0..26u8)
            .filter(|i| mask >> i & 1 == 1)
            .map(|i| (b'A' + i) as char)
            .filter(|&d| {
                let root: Vec<u16> = format!("{d}:\\").encode_utf16().chain([0]).collect();
                // SAFETY: root — строка с нулём на конце, живёт до конца вызова
                unsafe { GetDriveTypeW(root.as_ptr()) == DRIVE_FIXED }
            })
            .collect()
    }

    /// Диск Windows: %SystemDrive%, иначе первая буква %SystemRoot%, иначе C.
    pub fn system_drive() -> char {
        ["SystemDrive", "SystemRoot"]
            .iter()
            .filter_map(|v| std::env::var(v).ok())
            .find_map(|s| s.chars().next().filter(char::is_ascii_alphabetic))
            .unwrap_or('C')
    }
}

/// Вне Windows дисков с буквами нет — остаётся только домашняя папка.
#[cfg(not(windows))]
mod sys {
    pub const HOME: &str = "HOME";

    pub fn fixed_drives() -> Vec<char> {
        Vec::new()
    }
    pub fn system_drive() -> char {
        '/'
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// Своя пустая папка на тест; с кириллицей и пробелом — такие пути у людей и бывают.
    struct Tmp(PathBuf);

    impl Tmp {
        fn new() -> Self {
            static N: AtomicU32 = AtomicU32::new(0);
            let n = N.fetch_add(1, Ordering::Relaxed);
            let p = std::env::temp_dir().join(format!("deskrat тест папка {}-{n}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
    }

    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn put(dir: &Path, key: &str, body: &str) {
        fs::write(state_file(dir, key), body).unwrap();
    }

    fn get(dir: &Path, key: &str) -> Option<String> {
        fs::read_to_string(state_file(dir, key)).ok()
    }

    #[test]
    fn first_launch_has_no_dir() {
        let t = Tmp::new();
        let loc = t.0.join("cfg").join("location.json");
        assert_eq!(read_dir(&loc), None);
        // битый файл и относительный путь — тоже первый запуск
        fs::create_dir_all(loc.parent().unwrap()).unwrap();
        fs::write(&loc, "{не json").unwrap();
        assert_eq!(read_dir(&loc), None);
        fs::write(&loc, r#"{"dir":"data"}"#).unwrap();
        assert_eq!(read_dir(&loc), None);
    }

    #[test]
    fn wizard_closed_after_folder_is_not_finished() {
        let t = Tmp::new();
        let loc = t.0.join("cfg").join("location.json");
        let data = t.0.join("данные");
        set_dir(&loc, data.to_str().unwrap()).unwrap();
        put(&data, "belly", "{}");
        assert!(!finished(&loc));
        put(&data, "settings", "{}");
        assert!(finished(&loc));
    }

    #[test]
    fn set_dir_with_cyrillic_and_spaces() {
        let t = Tmp::new();
        let loc = t.0.join("профиль").join("location.json");
        let dir = t.0.join("мои данные").join("Кот Барсик");
        set_dir(&loc, dir.to_str().unwrap()).unwrap();
        assert_eq!(read_dir(&loc), Some(dir.clone()));
        // в location.json только путь, и он читается обратно как есть
        let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(&loc).unwrap()).unwrap();
        assert_eq!(v, serde_json::json!({ "dir": dir.to_str().unwrap() }));
        // проба за собой убрала, временных файлов не осталось
        assert!(!dir.join(".probe").exists());
        assert!(fs::read_dir(loc.parent().unwrap()).unwrap().all(|e|
            !e.unwrap().file_name().to_string_lossy().ends_with(".tmp")));
        save(Some(&dir), "belly", r#"{"full":0.5}"#).unwrap();
        assert_eq!(load(Some(&dir), "belly").unwrap().as_deref(), Some(r#"{"full":0.5}"#));
    }

    #[test]
    fn set_dir_rejects_relative_path() {
        let t = Tmp::new();
        let loc = t.0.join("location.json");
        assert!(set_dir(&loc, "DeskRat").is_err());
        assert!(!loc.exists());
    }

    #[test]
    fn folder_vanished_means_first_launch() {
        let t = Tmp::new();
        let loc = t.0.join("location.json");
        let dir = t.0.join("данные");
        set_dir(&loc, dir.to_str().unwrap()).unwrap();
        fs::remove_dir_all(&dir).unwrap();
        assert_eq!(read_dir(&loc), None);
    }

    #[test]
    fn moving_carries_known_states_and_destination_wins() {
        let t = Tmp::new();
        let loc = t.0.join("location.json");
        let (old, new) = (t.0.join("старая папка"), t.0.join("новая папка"));
        set_dir(&loc, old.to_str().unwrap()).unwrap();
        put(&old, "belly", "old belly");
        put(&old, "sleep", "old sleep");
        put(&old, "notes", "чужой файл");
        fs::create_dir_all(&new).unwrap();
        put(&new, "sleep", "new sleep");
        set_dir(&loc, new.to_str().unwrap()).unwrap();
        assert_eq!(read_dir(&loc), Some(new.clone()));
        // перевезли и удалили оригинал
        assert_eq!(get(&new, "belly").as_deref(), Some("old belly"));
        assert_eq!(get(&old, "belly"), None);
        // в новой уже был — новый остаётся, старый не трогаем
        assert_eq!(get(&new, "sleep").as_deref(), Some("new sleep"));
        assert_eq!(get(&old, "sleep").as_deref(), Some("old sleep"));
        // незнакомые файлы не наши
        assert_eq!(get(&old, "notes").as_deref(), Some("чужой файл"));
        assert_eq!(get(&new, "notes"), None);
    }

    #[test]
    fn failed_move_keeps_old_dir_whole() {
        let t = Tmp::new();
        let loc = t.0.join("location.json");
        let (old, new) = (t.0.join("старая"), t.0.join("новая"));
        set_dir(&loc, old.to_str().unwrap()).unwrap();
        put(&old, "belly", "b");
        put(&old, "sleep", "s");
        // Некорректный destination не должен скрывать ошибку и удалять старые данные.
        fs::create_dir_all(state_file(&new, "sleep")).unwrap();
        assert!(set_dir(&loc, new.to_str().unwrap()).is_err());
        // остались в старой папке со всем, что было; полкопии в новой не висит
        assert_eq!(read_dir(&loc), Some(old.clone()));
        assert_eq!((get(&old, "belly").as_deref(), get(&old, "sleep").as_deref()), (Some("b"), Some("s")));
        assert_eq!(get(&new, "belly"), None);
    }

    #[test]
    fn same_dir_again_keeps_files() {
        let t = Tmp::new();
        let loc = t.0.join("location.json");
        let dir = t.0.join("данные");
        set_dir(&loc, dir.to_str().unwrap()).unwrap();
        put(&dir, "stats", "s");
        // тот же путь другой записью — переезжать некуда, ничего не удаляется
        let again = format!("{}{}..{}данные", dir.display(), std::path::MAIN_SEPARATOR, std::path::MAIN_SEPARATOR);
        set_dir(&loc, &again).unwrap();
        assert_eq!(get(&dir, "stats").as_deref(), Some("s"));
    }

    #[test]
    fn keys_are_checked() {
        let t = Tmp::new();
        for bad in ["", "Belly", "be-lly", "../x", "a/b", "белка", "abcdefghijklmnopq", "unknown"] {
            assert!(load(Some(&t.0), bad).is_err(), "{bad:?}");
            assert!(save(Some(&t.0), bad, "x").is_err(), "{bad:?}");
        }
        assert!(load(Some(&t.0), "wiki").is_ok());
        // ключ проверяется и без папки
        assert!(load(None, "../x").is_err());
    }

    #[test]
    fn load_and_save_without_dir() {
        assert_eq!(load(None, "belly"), Ok(None));
        assert_eq!(save(None, "belly", "x"), Err("папка данных не выбрана".into()));
    }

    #[test]
    fn save_replaces_atomically() {
        let t = Tmp::new();
        assert_eq!(load(Some(&t.0), "spot"), Ok(None));
        save(Some(&t.0), "spot", "один").unwrap();
        save(Some(&t.0), "spot", "два").unwrap();
        assert_eq!(load(Some(&t.0), "spot"), Ok(Some("два".into())));
        assert!(fs::read_dir(&t.0).unwrap().all(|e|
            !e.unwrap().file_name().to_string_lossy().ends_with(".tmp")));
    }

    #[test]
    fn shared_upstream_folder_is_never_imported_or_modified() {
        let t = Tmp::new();
        let loc = t.0.join("cfg").join("location.json");
        let shared = t.0.join("DeskPartner");
        fs::create_dir_all(&shared).unwrap();
        for key in KEYS.into_iter().chain(["wiki", "reviews", "news"]) {
            fs::write(shared.join(format!("{key}.json")), "upstream").unwrap();
        }
        fs::write(shared.join(".probe"), "user file").unwrap();
        fs::write(shared.join("deskrat-belly.json.tmp"), "existing temp").unwrap();
        set_dir(&loc, shared.to_str().unwrap()).unwrap();
        assert!(!finished(&loc));
        for key in ["belly", "settings", "wiki", "reviews", "news"] {
            assert_eq!(load(Some(&shared), key).unwrap(), None);
            save(Some(&shared), key, "DeskRat").unwrap();
        }
        let new = t.0.join("new");
        set_dir(&loc, new.to_str().unwrap()).unwrap();
        assert_eq!(get(&new, "belly").as_deref(), Some("DeskRat"));
        for key in KEYS.into_iter().chain(["wiki", "reviews", "news"]) {
            assert_eq!(fs::read_to_string(shared.join(format!("{key}.json"))).unwrap(), "upstream");
        }
        assert_eq!(fs::read_to_string(shared.join(".probe")).unwrap(), "user file");
        assert_eq!(fs::read_to_string(shared.join("deskrat-belly.json.tmp")).unwrap(), "existing temp");
    }

    #[cfg(windows)]
    #[test]
    fn failed_location_commit_rolls_back_copies() {
        let t = Tmp::new();
        let loc = t.0.join("cfg").join("location.json");
        let old = t.0.join("old");
        let new = t.0.join("new");
        set_dir(&loc, old.to_str().unwrap()).unwrap();
        put(&old, "belly", "old");
        let original = fs::metadata(&loc).unwrap().permissions();
        let mut readonly = original.clone();
        readonly.set_readonly(true);
        fs::set_permissions(&loc, readonly).unwrap();
        let result = set_dir(&loc, new.to_str().unwrap());
        fs::set_permissions(&loc, original).unwrap();
        assert!(result.is_err());
        assert_eq!(read_dir(&loc), Some(old.clone()));
        assert_eq!(get(&old, "belly").as_deref(), Some("old"));
        assert_eq!(get(&new, "belly"), None);
    }

    #[test]
    fn suggestions_skip_system_drive_and_end_with_home() {
        let home = Path::new(r"C:\Users\Влад");
        let got = suggestions(&['C', 'D', 'e'], 'c', Some(home));
        let want_home = home.join("DeskRat").to_string_lossy().into_owned();
        assert_eq!(got, vec![r"D:\DeskRat".to_string(), r"E:\DeskRat".into(), want_home]);
        // только системный диск — остаётся папка пользователя
        assert_eq!(suggestions(&['C'], 'C', Some(home)).len(), 1);
        assert!(suggestions(&['C'], 'C', None).is_empty());
    }
}
