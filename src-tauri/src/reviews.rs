//! Отзывы о фильме без ключа: оценки из Wikidata и раздел об отзывах из Википедии.
//!
//! Запасной путь «подтягивать отзывы», пока у человека нет ключа TMDB. Наружу уходит только
//! название фильма (и язык в адресе), как и обещано в настройках. Оценки Wikidata — CC0; текст
//! Википедии в облачке не показываем, только ищем в нём «затянуто» и «скучно» — это делает
//! фронтенд (src/lib/reviews.ts). Ответ, в том числе «не нашли», лежит в папке данных
//! (`reviews.json`) месяц: оценки за это время почти не меняются, а сеть дёргать незачем.

use crate::i18n::{self, tr};
use crate::store;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;

const WIKIDATA: &str = "https://www.wikidata.org/w/api.php";
const USER_AGENT: &str = concat!("DeskRat/", env!("CARGO_PKG_VERSION"));
const TIMEOUT: Duration = Duration::from_secs(15);
/// Ключ кэша в папке данных; как и у wiki, его нет в store::KEYS — при смене папки скачается заново.
const CACHE: &str = "reviews";
const KEEP_SECS: i64 = 30 * 24 * 3600;
/// Больше фильмов не помним: кэш не должен расти годами.
const KEEP: usize = 50;
/// Раздел об отзывах бывает на десятки килобайт; для поиска «затянуто» хватит начала.
const MAX_RECEPTION: usize = 20_000;
/// Классы Wikidata, которые смотрят на экране: фильм, сериал, мини-сериал, телефильм, мультфильм,
/// короткометражка, мультсериал, аниме-сериал, аниме-фильм, полнометражный фильм.
const SCREEN: [&str; 10] =
    ["Q11424", "Q5398426", "Q1259759", "Q506240", "Q202866", "Q24862", "Q581714", "Q63952888", "Q20650540", "Q24869"];
/// Что отрезаем от имени файла: дальше в нём только качество и релиз-группа.
const JUNK: [&str; 12] = ["1080p", "720p", "2160p", "4k", "bdrip", "bluray", "webrip", "web-dl", "hdrip", "dvdrip", "x264", "x265"];
const VIDEO: [&str; 6] = [".mkv", ".mp4", ".avi", ".webm", ".mov", ".m4v"];

/// Что известно о фильме. Пустые оценки и раздел — значит, нашли, но сказать нечего.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Film {
    /// Название в Wikidata — по нему видно, тот ли фильм нашёлся.
    pub label: String,
    /// Оценки критиков и зрителей, приведённые к 0..1.
    pub scores: Vec<f64>,
    /// Язык раздела об отзывах: "ru", "en" или пусто, если раздела нет.
    pub lang: String,
    /// Вики-текст раздела об отзывах, без сносок.
    pub reception: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct Entry {
    key: String,
    at: i64,
    film: Option<Film>,
}

#[derive(Serialize, Deserialize, Default)]
struct Cache {
    films: Vec<Entry>,
}

/// Название из плеера → что искать и год, если он есть. Плееры часто отдают имя файла:
/// «Interstellar.2014.1080p.BluRay.mkv» → («Interstellar», 2014).
fn clean(title: &str) -> (String, Option<i32>) {
    let mut t = title.trim().to_string();
    let lower = t.to_lowercase();
    if let Some(ext) = VIDEO.iter().find(|e| lower.ends_with(*e)) {
        t.truncate(t.len() - ext.len());
        if !t.contains(' ') {
            t = t.replace(['.', '_'], " ");
        }
    }
    let mut words = Vec::new();
    let mut year = None;
    let mut bracket = false;
    for w in t.split_whitespace() {
        let closes = w.ends_with(')') || w.ends_with(']');
        if bracket {
            bracket = !closes;
            continue;
        }
        let bare = w.trim_matches(|c: char| "()[]{}".contains(c));
        let low = bare.to_lowercase();
        let as_year = (bare.len() == 4).then(|| bare.parse::<i32>().ok()).flatten().filter(|y| (1900..2100).contains(y));
        // год в начале — часть названия («1917»), дальше — уже подпись релиза
        if let (Some(y), false) = (as_year, words.is_empty()) {
            year = Some(y);
            break;
        }
        if JUNK.contains(&low.as_str()) {
            break;
        }
        if w.starts_with('[') || w.starts_with('(') {
            bracket = !closes;
            continue;
        }
        words.push(w);
    }
    (words.join(" ").trim_matches(|c: char| c == '-' || c == '—' || c.is_whitespace()).to_string(), year)
}

/// Оценка из Wikidata → 0..1: «73%», «7.1/10», «74/100», «7,1/10».
fn score(s: &str) -> Option<f64> {
    let num = |x: &str| x.trim().replace(',', ".").parse::<f64>().ok();
    let v = match s.split_once('/') {
        Some((a, b)) => num(a)? / num(b).filter(|b| *b > 0.0)?,
        None => num(s.trim().strip_suffix('%')?)? / 100.0,
    };
    (0.0..=1.0).contains(&v).then_some(v)
}

fn ids<'a>(claims: &'a Value, prop: &str) -> impl Iterator<Item = &'a Value> {
    claims[prop].as_array().into_iter().flatten().filter(|c| c["rank"] != "deprecated").map(|c| &c["mainsnak"]["datavalue"]["value"])
}

fn is_screen(entity: &Value) -> bool {
    ids(&entity["claims"], "P31").any(|v| v["id"].as_str().is_some_and(|id| SCREEN.contains(&id)))
}

/// Годы выхода (P577): «+2014-10-26T00:00:00Z» → 2014.
fn years(entity: &Value) -> Vec<i32> {
    ids(&entity["claims"], "P577").filter_map(|v| v["time"].as_str()?.get(1..5)?.parse().ok()).collect()
}

/// Первый из найденных, кого смотрят на экране; если знаем год — тот, что вышел в этот год.
fn pick<'a>(order: &[String], entities: &'a Value, year: Option<i32>) -> Option<&'a Value> {
    let screen: Vec<&Value> = order.iter().map(|id| &entities[id]).filter(|e| is_screen(e)).collect();
    year.and_then(|y| screen.iter().find(|e| years(e).contains(&y)).copied()).or_else(|| screen.first().copied())
}

fn scores(entity: &Value) -> Vec<f64> {
    ids(&entity["claims"], "P444").filter_map(|v| score(v.as_str()?)).collect()
}

/// Номер раздела об отзывах среди разделов статьи.
fn reception_section(sections: &Value, lang: &str) -> Option<String> {
    let stems: &[&str] = if lang == "ru" { &["отзыв", "критик", "восприят", "оценк", "реакци"] } else { &["reception", "critical", "review"] };
    sections.as_array()?.iter().find_map(|s| {
        let line = s["line"].as_str()?.to_lowercase();
        stems.iter().any(|st| line.contains(st)).then(|| s["index"].as_str().map(str::to_string)).flatten()
    })
}

/// Сноски — названия статей и газет, а не мнение критиков; выкидываем.
fn strip_refs(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find("<ref") {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let open = tail.find('>').map_or(tail.len(), |j| j + 1);
        rest = if tail[..open].ends_with("/>") {
            &tail[open..]
        } else {
            tail.find("</ref>").map_or("", |j| &tail[j + "</ref>".len()..])
        };
    }
    out.push_str(rest);
    out
}

fn cut(mut s: String, max: usize) -> String {
    if s.len() > max {
        let end = (0..=max).rev().find(|&i| s.is_char_boundary(i)).unwrap_or(0);
        s.truncate(end);
    }
    s
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder().timeout_global(Some(TIMEOUT)).user_agent(USER_AGENT).build().into()
}

/// Сначала язык интерфейса, потом другой: и название, и раздел об отзывах лучше на своём.
fn langs(en: bool) -> [&'static str; 2] {
    if en { ["en", "ru"] } else { ["ru", "en"] }
}

fn get(agent: &ureq::Agent, url: &str, query: &[(&str, &str)]) -> Result<Value, String> {
    let net = |e: ureq::Error| format!("{}: {e}", tr("Википедия недоступна", "Wikipedia is unreachable"));
    let mut req = agent.get(url);
    for (k, v) in query {
        req = req.query(*k, *v);
    }
    let body = req.call().map_err(net)?.body_mut().read_to_string().map_err(net)?;
    serde_json::from_str(&body).map_err(|e| format!("{}: {e}", tr("Википедия ответила непонятно", "Wikipedia sent an odd answer")))
}

/// Раздел об отзывах из статьи `title` в `lang`-Википедии, если он там есть.
fn reception(agent: &ureq::Agent, lang: &str, title: &str) -> Result<Option<String>, String> {
    let api = format!("https://{lang}.wikipedia.org/w/api.php");
    let base = [("action", "parse"), ("page", title), ("format", "json"), ("formatversion", "2")];
    let sections = get(agent, &api, &[&base[..], &[("prop", "sections")][..]].concat())?;
    let Some(index) = reception_section(&sections["parse"]["sections"], lang) else { return Ok(None) };
    let text = get(agent, &api, &[&base[..], &[("prop", "wikitext"), ("section", index.as_str())][..]].concat())?;
    Ok(text["parse"]["wikitext"].as_str().map(|t| cut(strip_refs(t), MAX_RECEPTION)))
}

/// Фильм с таким названием в подписях на `lang` — со всеми его свойствами.
fn search(agent: &ureq::Agent, name: &str, lang: &str, year: Option<i32>) -> Result<Option<Value>, String> {
    let q = [("format", "json"), ("action", "wbsearchentities"), ("type", "item"), ("limit", "7")];
    let found = get(agent, WIKIDATA, &[&q[..], &[("search", name), ("language", lang), ("uselang", lang)][..]].concat())?;
    let order: Vec<String> = found["search"].as_array().into_iter().flatten().filter_map(|s| s["id"].as_str().map(str::to_string)).collect();
    if order.is_empty() {
        return Ok(None);
    }
    let joined = order.join("|");
    let q = [("format", "json"), ("action", "wbgetentities"), ("props", "claims|sitelinks|labels"), ("sitefilter", "ruwiki|enwiki")];
    let got = get(agent, WIKIDATA, &[&q[..], &[("ids", joined.as_str()), ("languages", "ru|en")][..]].concat())?;
    Ok(pick(&order, &got["entities"], year).cloned())
}

fn fetch(title: &str) -> Result<Option<Film>, String> {
    let (name, year) = clean(title);
    if name.is_empty() {
        return Ok(None);
    }
    let agent = agent();
    let langs = langs(i18n::en());
    // плееры отдают и «Интерстеллар», и «Interstellar»: ищем по подписям на своём языке, потом на другом
    let mut found = None;
    for lang in langs {
        if let Some(hit) = search(&agent, &name, lang, year)? {
            found = Some(hit);
            break;
        }
    }
    let Some(entity) = found else { return Ok(None) };
    let entity = &entity;
    let label = langs.iter().find_map(|l| entity["labels"][*l]["value"].as_str()).unwrap_or(&name).to_string();
    let mut film = Film { label, scores: scores(entity), lang: String::new(), reception: String::new() };
    for lang in langs {
        let Some(page) = entity["sitelinks"][format!("{lang}wiki")]["title"].as_str() else { continue };
        if let Some(text) = reception(&agent, lang, page)? {
            film.lang = lang.into();
            film.reception = text;
            break;
        }
    }
    Ok(Some(film))
}

/// Язык в ключе: тот же фильм в другом интерфейсе нужен с другим названием и разделом.
fn key(lang: &str, title: &str) -> String {
    format!("{lang}:{}", title.trim().to_lowercase())
}

/// Ответ из кэша, если он не старше месяца. `Some(None)` — уже искали и не нашли.
fn cached(dir: Option<&Path>, key: &str, now: i64) -> Option<Option<Film>> {
    let cache: Cache = serde_json::from_str(&store::load(dir, CACHE).ok()??).ok()?;
    cache.films.into_iter().find(|e| e.key == key && now - e.at < KEEP_SECS).map(|e| e.film)
}

fn remember(dir: Option<&Path>, entry: Entry) {
    let mut cache: Cache = store::load(dir, CACHE).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    cache.films.retain(|e| e.key != entry.key && entry.at - e.at < KEEP_SECS);
    cache.films.insert(0, entry);
    cache.films.truncate(KEEP);
    // не записалось — не беда: в худшем случае спросим ещё раз
    if let Ok(json) = serde_json::to_string(&cache) {
        let _ = store::save(dir, CACHE, &json);
    }
}

fn lookup(title: String) -> Result<Option<Film>, String> {
    let dir = store::data_dir().map(PathBuf::from);
    let now = chrono::Local::now().timestamp();
    let key = key(i18n::code(), &title);
    if let Some(film) = cached(dir.as_deref(), &key, now) {
        return Ok(film);
    }
    let film = fetch(&title)?;
    remember(dir.as_deref(), Entry { key, at: now, film: film.clone() });
    Ok(film)
}

/// Что критики думают о фильме `title`; `None` — такого фильма Wikidata не знает.
/// Сеть — в отдельном потоке: окно питомца в это время живёт дальше.
#[tauri::command]
pub async fn film_reviews(title: String) -> Result<Option<Film>, String> {
    tauri::async_runtime::spawn_blocking(move || lookup(title)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn clean_cuts_release_noise() {
        assert_eq!(clean("Interstellar.2014.1080p.BluRay.x264.mkv"), ("Interstellar".into(), Some(2014)));
        assert_eq!(clean("Мастер и Маргарита (2024) [WEB-DL]"), ("Мастер и Маргарита".into(), Some(2024)));
        assert_eq!(clean("The_Matrix_1999.mp4"), ("The Matrix".into(), Some(1999)));
        assert_eq!(clean("  Интерстеллар  "), ("Интерстеллар".into(), None));
        assert_eq!(clean("Brother 720p"), ("Brother".into(), None));
        assert_eq!(clean("Солярис (режиссёрская версия) 1972"), ("Солярис".into(), Some(1972)));
    }

    #[test]
    fn clean_keeps_a_year_that_is_the_title() {
        assert_eq!(clean("1917"), ("1917".into(), None));
        assert_eq!(clean("1917 2019 1080p"), ("1917".into(), Some(2019)));
    }

    fn near(a: Option<f64>, b: f64) -> bool {
        a.is_some_and(|a| (a - b).abs() < 1e-9)
    }

    #[test]
    fn score_reads_every_scale() {
        assert!(near(score("73%"), 0.73));
        assert!(near(score("7.1/10"), 0.71));
        assert!(near(score("74/100"), 0.74));
        assert!(near(score("7,5/10"), 0.75));
        assert_eq!(score("Certified Fresh"), None);
        assert_eq!(score("11/10"), None);
        assert_eq!(score("5/0"), None);
    }

    fn entity(p31: &[&str], year: &str, scores: &[&str]) -> Value {
        let claim = |v: Value| json!({"rank": "normal", "mainsnak": {"datavalue": {"value": v}}});
        json!({"claims": {
            "P31": p31.iter().map(|id| claim(json!({"id": id}))).collect::<Vec<_>>(),
            "P577": [claim(json!({"time": format!("+{year}-01-25T00:00:00Z")}))],
            "P444": scores.iter().map(|s| claim(json!(s))).collect::<Vec<_>>(),
        }})
    }

    #[test]
    fn pick_skips_books_and_prefers_the_year() {
        let entities = json!({
            "Q1": entity(&["Q7725634"], "1967", &[]),
            "Q2": entity(&["Q5398426", "Q1259759"], "2005", &[]),
            "Q3": entity(&["Q11424"], "2024", &["81%"]),
        });
        let order: Vec<String> = ["Q1", "Q2", "Q3"].map(String::from).into();
        assert_eq!(pick(&order, &entities, None), Some(&entities["Q2"]));
        assert_eq!(pick(&order, &entities, Some(2024)), Some(&entities["Q3"]));
        assert_eq!(pick(&order, &entities, Some(1990)), Some(&entities["Q2"]));
        assert_eq!(pick(&order[..1], &entities, None), None);
    }

    #[test]
    fn scores_skip_deprecated_and_odd_values() {
        let mut e = entity(&["Q11424"], "2014", &["73%", "8.7/10", "Certified Fresh"]);
        e["claims"]["P444"][0]["rank"] = json!("deprecated");
        let got = scores(&e);
        assert_eq!(got.len(), 1);
        assert!(near(got.first().copied(), 0.87));
    }

    #[test]
    fn reception_section_by_heading() {
        let ru = json!([{"line": "Сюжет", "index": "1"}, {"line": "Отзывы и оценки", "index": "10"}]);
        assert_eq!(reception_section(&ru, "ru"), Some("10".into()));
        let en = json!([{"line": "Plot", "index": "1"}, {"line": "Critical response", "index": "7"}]);
        assert_eq!(reception_section(&en, "en"), Some("7".into()));
        assert_eq!(reception_section(&json!([{"line": "Сюжет", "index": "1"}]), "ru"), None);
    }

    #[test]
    fn strip_refs_drops_footnotes() {
        let text = r#"Затянуто.<ref name="a">{{cite|title=Boring}}</ref> Красиво.<ref name="b" /> Конец<ref>x</ref>"#;
        assert_eq!(strip_refs(text), "Затянуто. Красиво. Конец");
        assert_eq!(strip_refs("без сносок"), "без сносок");
        assert_eq!(strip_refs("оборвано<ref>навсегда"), "оборвано");
    }

    #[test]
    fn cut_keeps_whole_letters() {
        assert_eq!(cut("ёжик".into(), 3), "ё");
        assert_eq!(cut("abc".into(), 10), "abc");
    }

    /// Ходит в настоящую Википедию: `cargo test -- --ignored live`.
    #[test]
    #[ignore]
    fn live_interstellar() {
        let film = fetch("Interstellar.2014.1080p.BluRay.mkv").unwrap().unwrap();
        assert_eq!(film.label, "Интерстеллар");
        assert!(film.scores.len() >= 2, "{:?}", film.scores);
        assert_eq!(film.lang, "ru");
        assert!(!film.reception.is_empty() && !film.reception.contains("<ref"));
    }

    #[test]
    fn native_language_goes_first() {
        assert_eq!(langs(false), ["ru", "en"]);
        assert_eq!(langs(true), ["en", "ru"]);
        assert_eq!(key("en", "  Interstellar "), "en:interstellar");
        assert_ne!(key("ru", "Interstellar"), key("en", "Interstellar"));
    }

    #[test]
    fn cache_keeps_misses_for_a_month() {
        let dir = std::env::temp_dir().join(format!("deskrat-reviews-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let film = Film { label: "Интерстеллар".into(), scores: vec![0.73], lang: "ru".into(), reception: String::new() };
        remember(Some(&dir), Entry { key: "интерстеллар".into(), at: 1000, film: Some(film.clone()) });
        remember(Some(&dir), Entry { key: "нет такого".into(), at: 1000, film: None });
        assert_eq!(cached(Some(&dir), "интерстеллар", 2000), Some(Some(film)));
        assert_eq!(cached(Some(&dir), "нет такого", 2000), Some(None));
        assert_eq!(cached(Some(&dir), "интерстеллар", 1000 + KEEP_SECS), None);
        assert_eq!(cached(Some(&dir), "другой", 2000), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
