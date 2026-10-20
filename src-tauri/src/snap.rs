use serde::Deserialize;
#[derive(Clone, Copy, Default, Deserialize)]
pub struct CaptionRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
#[cfg(windows)]
mod native {
    use super::*;
    use std::{
        collections::HashMap,
        sync::{Mutex, OnceLock},
    };
    use tauri::WebviewWindow;
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::{
            Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE},
            Gdi::*,
        },
        UI::{HiDpi::GetDpiForWindow, WindowsAndMessaging::*},
    };
    struct Hook {
        original: isize,
        parent: isize,
    }
    static HOOKS: OnceLock<Mutex<HashMap<isize, Hook>>> = OnceLock::new();
    static RECTS: OnceLock<Mutex<HashMap<isize, CaptionRect>>> = OnceLock::new();
    static BUTTONS: OnceLock<Mutex<HashMap<isize, isize>>> = OnceLock::new();
    unsafe extern "system" fn procedure(hwnd: HWND, message: u32, w: WPARAM, l: LPARAM) -> LRESULT {
        let (original, parent) = {
            let hooks = HOOKS.get().unwrap().lock().unwrap();
            let Some(h) = hooks.get(&(hwnd as isize)) else {
                return DefWindowProcW(hwnd, message, w, l);
            };
            (h.original, h.parent as HWND)
        };
        let is_button = BUTTONS.get().is_some_and(|b| {
            b.lock().unwrap().get(&(parent as isize)).copied() == Some(hwnd as isize)
        });
        // A same-thread native hit surface sits over WebView2's cross-process
        // input child. HTTRANSPARENT then reaches our parent, not the webview.
        if is_button && message == WM_ERASEBKGND {
            return 1;
        }
        if is_button && message == WM_PAINT {
            let mut paint: PAINTSTRUCT = std::mem::zeroed();
            let dc = BeginPaint(hwnd, &mut paint);
            let mut client: RECT = std::mem::zeroed();
            GetClientRect(hwnd, &mut client);
            let brush = CreateSolidBrush(0x060505);
            FillRect(dc, &client, brush);
            DeleteObject(brush);
            let scale = GetDpiForWindow(parent) as f64 / 96.0;
            let size = (9.0 * scale).round() as i32;
            let x = (client.right - size) / 2;
            let y = (client.bottom - size) / 2;
            let pen = CreatePen(PS_SOLID, 1, 0xa1959a);
            let old_pen = SelectObject(dc, pen);
            let old_brush = SelectObject(dc, GetStockObject(NULL_BRUSH));
            if IsZoomed(parent) != 0 {
                Rectangle(dc, x + 3, y - 2, x + size + 3, y + size - 2);
            }
            Rectangle(dc, x, y, x + size, y + size);
            SelectObject(dc, old_pen);
            SelectObject(dc, old_brush);
            DeleteObject(pen);
            EndPaint(hwnd, &paint);
            return 0;
        }
        if message == WM_NCCALCSIZE && hwnd == parent && w != 0 {
            return 0;
        }
        if message == WM_NCHITTEST {
            let mut point = POINT {
                x: (l as i16) as i32,
                y: ((l >> 16) as i16) as i32,
            };
            ScreenToClient(parent, &mut point);
            let scale = GetDpiForWindow(parent) as f64 / 96.0;
            let rect = RECTS
                .get()
                .and_then(|r| r.lock().ok()?.get(&(parent as isize)).copied())
                .unwrap_or_default();
            if (point.x as f64) >= rect.x * scale
                && (point.x as f64) < (rect.x + rect.width) * scale
                && (point.y as f64) >= rect.y * scale
                && (point.y as f64) < (rect.y + rect.height) * scale
            {
                return if hwnd == parent {
                    HTMAXBUTTON as isize
                } else {
                    HTTRANSPARENT as isize
                };
            }
            if IsZoomed(parent) == 0 {
                let mut client: RECT = std::mem::zeroed();
                GetClientRect(parent, &mut client);
                let edge = (6.0 * scale) as i32;
                let left = point.x < edge;
                let right = point.x >= client.right - edge;
                let top = point.y < edge;
                let bottom = point.y >= client.bottom - edge;
                let hit = match (left, right, top, bottom) {
                    (true, _, true, _) => HTTOPLEFT,
                    (_, true, true, _) => HTTOPRIGHT,
                    (true, _, _, true) => HTBOTTOMLEFT,
                    (_, true, _, true) => HTBOTTOMRIGHT,
                    (true, _, _, _) => HTLEFT,
                    (_, true, _, _) => HTRIGHT,
                    (_, _, true, _) => HTTOP,
                    (_, _, _, true) => HTBOTTOM,
                    _ => HTCLIENT,
                };
                if hit != HTCLIENT {
                    return if hwnd == parent {
                        hit as isize
                    } else {
                        HTTRANSPARENT as isize
                    };
                }
            }
        }
        if hwnd == parent && message == WM_NCLBUTTONDOWN && w == HTMAXBUTTON as usize {
            return 0;
        }
        if hwnd == parent && message == WM_NCLBUTTONUP && w == HTMAXBUTTON as usize {
            ShowWindow(
                parent,
                if IsZoomed(parent) != 0 {
                    SW_RESTORE
                } else {
                    SW_MAXIMIZE
                },
            );
            return 0;
        }
        let result = CallWindowProcW(
            Some(std::mem::transmute::<
                isize,
                unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT,
            >(original)),
            hwnd,
            message,
            w,
            l,
        );
        if message == WM_NCDESTROY {
            HOOKS
                .get()
                .unwrap()
                .lock()
                .unwrap()
                .remove(&(hwnd as isize));
            if hwnd == parent {
                if let Some(rects) = RECTS.get() {
                    rects.lock().unwrap().remove(&(hwnd as isize));
                }
                if let Some(buttons) = BUTTONS.get() {
                    buttons.lock().unwrap().remove(&(hwnd as isize));
                }
            }
        }
        result
    }
    unsafe fn hook(hwnd: HWND, parent: HWND) {
        let mut hooks = HOOKS.get_or_init(Default::default).lock().unwrap();
        if hooks.contains_key(&(hwnd as isize)) {
            return;
        }
        let original = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, procedure as *const () as isize);
        if original != 0 {
            hooks.insert(
                hwnd as isize,
                Hook {
                    original,
                    parent: parent as isize,
                },
            );
        }
    }
    unsafe extern "system" fn child(hwnd: HWND, parent: LPARAM) -> i32 {
        hook(hwnd, parent as HWND);
        1
    }
    pub fn install(window: &WebviewWindow) {
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        let hwnd = hwnd.0 as HWND;
        unsafe {
            hook(hwnd, hwnd);
            EnumChildWindows(hwnd, Some(child), hwnd as isize);
            let dark: i32 = 1;
            let border: u32 = 0xfffffffe;
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_USE_IMMERSIVE_DARK_MODE as u32,
                &dark as *const _ as _,
                4,
            );
            DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR as u32, &border as *const _ as _, 4);
        }
    }
    pub fn rect(window: &WebviewWindow, rect: CaptionRect) {
        if ![rect.x, rect.y, rect.width, rect.height]
            .iter()
            .all(|n| n.is_finite() && *n >= 0.0)
        {
            return;
        }
        if let Ok(hwnd) = window.hwnd() {
            let parent = hwnd.0 as isize;
            let target = window.clone();
            let _ = window.run_on_main_thread(move || unsafe {
                RECTS
                    .get_or_init(Default::default)
                    .lock()
                    .unwrap()
                    .insert(parent, rect);
                install(&target);
                let existing = BUTTONS
                    .get_or_init(Default::default)
                    .lock()
                    .unwrap()
                    .get(&parent)
                    .copied();
                let button = existing.unwrap_or_else(|| {
                    let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
                    let child = CreateWindowExW(
                        0,
                        class.as_ptr(),
                        std::ptr::null(),
                        WS_CHILD | WS_VISIBLE,
                        0,
                        0,
                        0,
                        0,
                        parent as HWND,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null(),
                    );
                    if !child.is_null() {
                        hook(child, parent as HWND);
                        BUTTONS
                            .get()
                            .unwrap()
                            .lock()
                            .unwrap()
                            .insert(parent, child as isize);
                    }
                    child as isize
                });
                if button == 0 {
                    return;
                }
                let scale = GetDpiForWindow(parent as HWND) as f64 / 96.0;
                SetWindowPos(
                    button as HWND,
                    HWND_TOP,
                    (rect.x * scale).round() as i32,
                    (rect.y * scale).round() as i32,
                    (rect.width * scale).round() as i32,
                    (rect.height * scale).round() as i32,
                    SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
                InvalidateRect(button as HWND, std::ptr::null(), 1);
            });
        }
    }
}
pub fn install(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    native::install(window);
}
#[tauri::command]
pub fn set_caption_rect(window: tauri::WebviewWindow, rect: CaptionRect) {
    #[cfg(windows)]
    native::rect(&window, rect);
}
