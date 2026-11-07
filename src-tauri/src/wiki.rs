//! «В этот день» из Википедии на языке интерфейса — свежие факты к встроенному запасу.
//!
//! Запрос идёт отсюда, а не из окна: CSP окна наружу не пускает, и так проще проследить, что
//! уходит в сеть, — только месяц, день и язык в адресе и название программы в User-Agent
//! (его требуют правила Викимедии). Раз в день: ответ лежит в папке данных (`wiki.json`) и
//! до завтра читается оттуда; сменили язык — скачается заново. По темам события раскладывает фронтенд (src/lib/wiki.ts).
//! Нет сети или ответ странный — ошибка уходит фронтенду, а кошка молча обходится своим запасом.

use crate::i18n::{self, tr};
use crate::store;
use chrono::Datelike;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

const USER_AGENT: &str = concat!("DeskRat/", env!("CARGO_PKG_VERSION"));
/// Не отвечает столько — считаем, что сети нет; облачко подождёт до следующей попытки.
const TIMEOUT: Duration = Duration::from_secs(15);
/// Ключ кэша в папке данных. Его нет в store::KEYS: при смене папки не переезжает, скачается заново.
const CACHE: &str = "wiki";

/// Событие дня: год, текст и короткие описания связанных статей — по ним видна тема.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Event {
    pub year: i32,
    pub text: String,
    pub about: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct Cache {
    day: String,
    /// Язык раздела; в старых файлах его нет — такой кэш просто скачается заново.
    #[serde(default)]
    lang: String,
    events: Vec<Event>,
}

#[derive(Deserialize)]
struct Feed {
    #[serde(default)]
    events: Vec<RawEvent>,
}

#[derive(Deserialize)]
struct RawEvent {
    #[serde(default)]
    text: String,
    year: Option<i32>,
    #[serde(default)]
    pages: Vec<RawPage>,
}

#[derive(Deserialize)]
struct RawPage {
    description: Option<String>,
}

fn url(lang: &str, month: u32, day: u32) -> String {
    format!("https://{lang}.wikipedia.org/api/rest_v1/feed/onthisday/events/{month:02}/{day:02}")
}

/// Из ответа — только нужное: без года или текста событие не рассказать.
fn parse(json: &str) -> Result<Vec<Event>, String> {
    let feed: Feed = serde_json::from_str(json)
        .map_err(|e| format!("{}: {e}", tr("Википедия ответила непонятно", "Wikipedia sent an odd answer")))?;
    Ok(feed
        .events
        .into_iter()
        .filter_map(|e| {
            let text = e.text.trim().to_string();
            let about = e.pages.into_iter().filter_map(|p| p.description).map(|d| d.trim().to_string()).filter(|d| !d.is_empty());
            Some(Event { year: e.year?, about: about.collect(), text: (!text.is_empty()).then_some(text)? })
        })
        .collect())
}

/// Кэш, если он за этот день и на этом языке.
fn cached(dir: Option<&Path>, day: &str, lang: &str) -> Option<Vec<Event>> {
    let cache: Cache = serde_json::from_str(&store::load(dir, CACHE).ok()??).ok()?;
    (cache.day == day && cache.lang == lang).then_some(cache.events)
}

fn fetch(lang: &str, month: u32, day: u32) -> Result<Vec<Event>, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(TIMEOUT)).user_agent(USER_AGENT).build().into();
    let net = |e: ureq::Error| format!("{}: {e}", tr("Википедия недоступна", "Wikipedia is unreachable"));
    let body = agent.get(&url(lang, month, day)).call().map_err(net)?.body_mut().read_to_string().map_err(net)?;
    parse(&body)
}

fn today() -> Result<Vec<Event>, String> {
    let now = chrono::Local::now();
    let day = now.format("%Y-%m-%d").to_string();
    let lang = i18n::code();
    let dir = store::data_dir().map(PathBuf::from);
    if let Some(events) = cached(dir.as_deref(), &day, lang) {
        return Ok(events);
    }
    let events = fetch(lang, now.month(), now.day())?;
    // кэш не записался — не беда: в худшем случае ещё раз спросим сегодня же
    if let Ok(json) = serde_json::to_string(&Cache { day, lang: lang.into(), events: events.clone() }) {
        let _ = store::save(dir.as_deref(), CACHE, &json);
    }
    Ok(events)
}

/// События сегодняшнего дня. Сеть — в отдельном потоке: окно питомца в это время живёт дальше.
#[tauri::command]
pub async fn wiki_today() -> Result<Vec<Event>, String> {
    tauri::async_runtime::spawn_blocking(today).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_has_only_date_and_language() {
        assert_eq!(url("ru", 4, 12), "https://ru.wikipedia.org/api/rest_v1/feed/onthisday/events/04/12");
        assert_eq!(url("en", 11, 5), "https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/11/05");
    }

    #[test]
    fn parse_keeps_what_can_be_told() {
        let json = r#"{"events":[
            {"text":" Первый полёт человека в космос. ","year":1961,"pages":[
                {"title":"Гагарин","description":"советский космонавт"},{"title":"Восток-1"},{"description":"  "}]},
            {"text":"Без года","pages":[]},
            {"text":"","year":2000},
            {"text":"Без страниц","year":-44}
        ],"births":[]}"#;
        let events = parse(json).unwrap();
        assert_eq!(
            events,
            vec![
                Event { year: 1961, text: "Первый полёт человека в космос.".into(), about: vec!["советский космонавт".into()] },
                Event { year: -44, text: "Без страниц".into(), about: vec![] },
            ]
        );
    }

    #[test]
    fn parse_tolerates_odd_answers() {
        assert_eq!(parse("{}").unwrap(), vec![]);
        assert!(parse("<html>").is_err());
    }

    #[test]
    fn cache_is_for_one_day() {
        let dir = std::env::temp_dir().join(format!("deskrat-wiki-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let events = vec![Event { year: 1957, text: "Спутник".into(), about: vec![] }];
        let json = serde_json::to_string(&Cache { day: "2026-10-04".into(), lang: "ru".into(), events: events.clone() }).unwrap();
        store::save(Some(&dir), CACHE, &json).unwrap();
        assert_eq!(cached(Some(&dir), "2026-10-04", "ru"), Some(events));
        assert_eq!(cached(Some(&dir), "2026-10-04", "en"), None, "сменили язык — качаем заново");
        assert_eq!(cached(Some(&dir), "2026-10-05", "ru"), None);
        assert_eq!(cached(None, "2026-10-04", "ru"), None);
        store::save(Some(&dir), CACHE, r#"{"day":"2026-10-04","events":[]}"#).unwrap();
        assert_eq!(cached(Some(&dir), "2026-10-04", "ru"), None, "старый файл без языка");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
