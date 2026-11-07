//! Облачко с репликой над питомцем. Что и когда сказать, решает окно питомца (src/lib/chatter.ts),
//! здесь — только где облачко встанет и как показаться, не отняв фокус.
//!
//! Устроено как меню (menu.rs): окно "bubble" строится заранее спрятанным и неактивируемым,
//! показывается через SetWindowPos с SWP_NOACTIVATE. Показ в три шага: say запоминает точку над
//! головой и отдаёт текст окну ("bubble-text"), окно меряет себя и присылает размер (bubble_size),
//! Rust ставит облачко над точкой в пределах рабочей области монитора и говорит окну, где у него
//! хвостик ("bubble-tail"). Кошка сдвинулась вместе с окном-насестом — bubble_at переставляет.
//! Окно целиком — само облачко, поэтому мышь оно ловит всем прямоугольником: клик — «отмахнулись».

use crate::menu::sys;
use crate::world::Rect;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const LABEL: &str = "bubble";

#[derive(Clone, Serialize)]
struct Text {
    gen: u64,
    text: String,
    /// Новость: под текстом кнопки «больше такого / меньше такого».
    vote: bool,
}

#[derive(Clone, Serialize)]
struct Tail {
    gen: u64,
    /// Где под облачком голова, физические пиксели от левого края окна.
    x: i32,
}

#[derive(Default)]
struct Said {
    /// Номер показа: размер от прошлой реплики по нему понимает, что устарел.
    gen: u64,
    /// Точка над головой питомца, физические пиксели.
    anchor: (i32, i32),
    /// Размер облачка; нет — ещё меряется или спрятано.
    size: Option<(i32, i32)>,
}

#[derive(Default)]
pub struct BubbleState(Mutex<Said>);

/// Окно облачка: прозрачное, поверх всех, без рамки и тени, без значка на панели задач, без фокуса.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    app.manage(BubbleState::default());
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("DeskRat")
        .inner_size(200.0, 60.0)
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

/// Сказать `text` над точкой (`x`, `top`) — серединой и макушкой питомца. Прежняя реплика пропадает.
/// `vote` — это новость, под ней кнопки лайк/диз.
#[tauri::command]
pub async fn say(app: AppHandle, text: String, x: i32, top: i32, vote: Option<bool>) -> Result<(), String> {
    let w = window(&app)?;
    let hwnd = sys::hwnd(&w)?;
    let gen = {
        let mut s = app.state::<BubbleState>().inner().0.lock().unwrap();
        s.gen += 1;
        s.anchor = (x, top);
        s.size = None;
        // спрятанное окно — заранее к точке: на мониторе с другим масштабом WebView пересчитает пиксели до замера
        sys::hide(hwnd);
        sys::move_to(hwnd, (x, top));
        s.gen
    };
    let vote = vote.unwrap_or(false);
    w.emit_to(LABEL, "bubble-text", Text { gen, text, vote }).map_err(|e| e.to_string())
}

/// Окно облачка измерило себя: `width`×`height` — физические пиксели. Ставим и показываем.
/// Приходит и повторно, если у окна сменился масштаб.
#[tauri::command]
pub async fn bubble_size(app: AppHandle, gen: u64, width: u32, height: u32) -> Result<(), String> {
    let w = window(&app)?;
    let mut s = app.state::<BubbleState>().inner().0.lock().unwrap();
    if s.gen != gen {
        return Ok(());
    }
    s.size = Some((width.max(1) as i32, height.max(1) as i32));
    show(&w, &s)
}

/// Питомец сдвинулся, пока говорит: облачко — за ним. Спрятанное не показывается.
#[tauri::command]
pub async fn bubble_at(app: AppHandle, x: i32, top: i32) -> Result<(), String> {
    let w = window(&app)?;
    let mut s = app.state::<BubbleState>().inner().0.lock().unwrap();
    if s.anchor == (x, top) {
        return Ok(());
    }
    s.anchor = (x, top);
    if s.size.is_none() {
        return Ok(());
    }
    show(&w, &s)
}

/// Спрятать облачко: время вышло, отмахнулись или питомцу стало не до разговоров.
#[tauri::command]
pub async fn hush(app: AppHandle) -> Result<(), String> {
    let hwnd = sys::hwnd(&window(&app)?)?;
    let mut s = app.state::<BubbleState>().inner().0.lock().unwrap();
    s.gen += 1;
    s.size = None;
    sys::hide(hwnd);
    Ok(())
}

fn window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(LABEL).ok_or_else(|| "облачко ещё не построено".to_string())
}

/// Под замком состояния: поставить окно над точкой и сказать ему, где хвостик.
fn show(w: &WebviewWindow, s: &Said) -> Result<(), String> {
    let Some(size) = s.size else { return Ok(()) };
    let (left, top) = place(s.anchor, size, sys::work_area(s.anchor));
    sys::show(sys::hwnd(w)?, Rect { left, top, right: left + size.0, bottom: top + size.1 });
    w.emit_to(LABEL, "bubble-tail", Tail { gen: s.gen, x: s.anchor.0 - left }).map_err(|e| e.to_string())
}

/// Левый верхний угол облачка размером `w`×`h` над точкой `at`: серединой над ней, но целиком
/// в рабочей области — у края экрана облачко сдвигается внутрь, а хвостик остаётся над головой.
/// Над головой нет места (питомец под самым верхом) — прижимается к верхнему краю.
fn place(at: (i32, i32), (w, h): (i32, i32), work: Rect) -> (i32, i32) {
    let left = (at.0 - w / 2).min(work.right - w).max(work.left);
    let top = (at.1 - h).max(work.top);
    (left, top)
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: Rect = Rect { left: 0, top: 0, right: 1920, bottom: 1040 };

    #[test]
    fn centred_above_the_head() {
        assert_eq!(place((1000, 900), (200, 60), WORK), (900, 840));
    }

    #[test]
    fn shifts_inside_at_the_screen_edges() {
        assert_eq!(place((1900, 900), (200, 60), WORK), (1720, 840));
        assert_eq!(place((20, 900), (200, 60), WORK), (0, 840));
        assert_eq!(place((1000, 30), (200, 60), WORK), (900, 0));
    }
}
