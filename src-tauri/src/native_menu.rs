//! The macOS menu bar, in the language the writer picked.
//!
//! The rest of OpenDraft's menus are drawn by the web app and translated there.
//! The macOS menu bar is the one thing the webview cannot reach: it is native,
//! it carries the standard App / Edit / Window items, and its titles are written
//! in Rust — so they are translated here. The frontend calls
//! `set_native_menu_language` whenever the interface language changes (see
//! frontend/src/i18n/index.ts), and once at start-up.
//!
//! English keeps the system's own default text for every standard item (passing
//! `None`), exactly as before this existed. Other languages use Apple's own
//! wording for the same items, so the bar reads like the rest of macOS.
//!
//! Windows and Linux show no native menu bar; mobile has none at all.

use std::sync::Mutex;

/// Id of the Window submenu, so it can be found again whatever it is called.
pub const WINDOW_MENU_ID: &str = "window-menu";

/// The words of the native menu bar in one language.
pub struct Labels {
    pub about: &'static str,
    pub services: &'static str,
    pub hide: &'static str,
    pub hide_others: &'static str,
    pub show_all: &'static str,
    pub quit: &'static str,
    pub edit: &'static str,
    pub undo: &'static str,
    pub redo: &'static str,
    pub cut: &'static str,
    pub copy: &'static str,
    pub paste: &'static str,
    pub select_all: &'static str,
    pub window: &'static str,
    pub minimize: &'static str,
    pub zoom: &'static str,
    pub close_window: &'static str,
}

/// English. Standard items use the system's default text (see `system_default`).
pub static EN: Labels = Labels {
    about: "About OpenDraft",
    services: "Services",
    hide: "Hide OpenDraft",
    hide_others: "Hide Others",
    show_all: "Show All",
    quit: "Quit OpenDraft",
    edit: "Edit",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    select_all: "Select All",
    window: "Window",
    minimize: "Minimize",
    zoom: "Zoom",
    close_window: "Close Window",
};

static ES: Labels = Labels {
    about: "Acerca de OpenDraft",
    services: "Servicios",
    hide: "Ocultar OpenDraft",
    hide_others: "Ocultar otros",
    show_all: "Mostrar todo",
    quit: "Salir de OpenDraft",
    edit: "Edición",
    undo: "Deshacer",
    redo: "Rehacer",
    cut: "Cortar",
    copy: "Copiar",
    paste: "Pegar",
    select_all: "Seleccionar todo",
    window: "Ventana",
    minimize: "Minimizar",
    zoom: "Zoom",
    close_window: "Cerrar ventana",
};

static FR: Labels = Labels {
    about: "À propos d’OpenDraft",
    services: "Services",
    hide: "Masquer OpenDraft",
    hide_others: "Masquer les autres",
    show_all: "Tout afficher",
    quit: "Quitter OpenDraft",
    edit: "Édition",
    undo: "Annuler",
    redo: "Rétablir",
    cut: "Couper",
    copy: "Copier",
    paste: "Coller",
    select_all: "Tout sélectionner",
    window: "Fenêtre",
    minimize: "Placer dans le Dock",
    zoom: "Zoom",
    close_window: "Fermer la fenêtre",
};

static PT: Labels = Labels {
    about: "Sobre o OpenDraft",
    services: "Serviços",
    hide: "Ocultar OpenDraft",
    hide_others: "Ocultar Outros",
    show_all: "Mostrar Tudo",
    quit: "Encerrar OpenDraft",
    edit: "Editar",
    undo: "Desfazer",
    redo: "Refazer",
    cut: "Recortar",
    copy: "Copiar",
    paste: "Colar",
    select_all: "Selecionar Tudo",
    window: "Janela",
    minimize: "Minimizar",
    zoom: "Zoom",
    close_window: "Fechar Janela",
};

static RU: Labels = Labels {
    about: "О программе OpenDraft",
    services: "Службы",
    hide: "Скрыть OpenDraft",
    hide_others: "Скрыть остальные",
    show_all: "Показать все",
    quit: "Завершить OpenDraft",
    edit: "Правка",
    undo: "Отменить",
    redo: "Повторить",
    cut: "Вырезать",
    copy: "Скопировать",
    paste: "Вставить",
    select_all: "Выбрать все",
    window: "Окно",
    minimize: "Свернуть",
    zoom: "Масштабировать",
    close_window: "Закрыть окно",
};

static TR: Labels = Labels {
    about: "OpenDraft Hakkında",
    services: "Servisler",
    hide: "OpenDraft’ı Gizle",
    hide_others: "Diğerlerini Gizle",
    show_all: "Tümünü Göster",
    quit: "OpenDraft’tan Çık",
    edit: "Düzen",
    undo: "Geri Al",
    redo: "Yinele",
    cut: "Kes",
    copy: "Kopyala",
    paste: "Yapıştır",
    select_all: "Tümünü Seç",
    window: "Pencere",
    minimize: "Dock’a Yerleştir",
    zoom: "Yakınlaştır",
    close_window: "Pencereyi Kapat",
};

static AR: Labels = Labels {
    about: "حول OpenDraft",
    services: "الخدمات",
    hide: "إخفاء OpenDraft",
    hide_others: "إخفاء الآخرين",
    show_all: "إظهار الكل",
    quit: "إنهاء OpenDraft",
    edit: "تحرير",
    undo: "تراجع",
    redo: "إعادة",
    cut: "قص",
    copy: "نسخ",
    paste: "لصق",
    select_all: "تحديد الكل",
    window: "نافذة",
    minimize: "تصغير",
    zoom: "تكبير/تصغير",
    close_window: "إغلاق النافذة",
};

static FA: Labels = Labels {
    about: "درباره OpenDraft",
    services: "سرویس‌ها",
    hide: "پنهان کردن OpenDraft",
    hide_others: "پنهان کردن بقیه",
    show_all: "نمایش همه",
    quit: "خروج از OpenDraft",
    edit: "ویرایش",
    undo: "واگرد",
    redo: "ازنو",
    cut: "برش",
    copy: "کپی",
    paste: "چسباندن",
    select_all: "انتخاب همه",
    window: "پنجره",
    minimize: "کوچک‌سازی",
    zoom: "بزرگ‌نمایی",
    close_window: "بستن پنجره",
};

/// The labels for a language code (`es`, `pt`, …). Unknown codes — and English —
/// get the English set.
pub fn labels_for(lang: &str) -> &'static Labels {
    match lang {
        "es" => &ES,
        "fr" => &FR,
        "pt" => &PT,
        "ru" => &RU,
        "tr" => &TR,
        "ar" => &AR,
        "fa" => &FA,
        _ => &EN,
    }
}

/// Whether `lang` has a translation here at all.
pub fn is_translated(lang: &str) -> bool {
    !std::ptr::eq(labels_for(lang), &EN)
}

static CURRENT: Mutex<String> = Mutex::new(String::new());

/// Remember the language the menu bar should be in. A poisoned lock is
/// recovered rather than panicking: a menu title is not worth taking the app down.
pub fn set_language(lang: &str) {
    let mut guard = CURRENT.lock().unwrap_or_else(|e| e.into_inner());
    *guard = lang.to_string();
}

pub fn current_language() -> String {
    CURRENT.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// The labels for the language currently set.
pub fn current() -> &'static Labels {
    labels_for(&current_language())
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use tauri::menu::{Menu, PredefinedMenuItem, Submenu};

    /// `None` keeps the system's own text for a standard item in English.
    fn text(lang: &str, label: &'static str) -> Option<&'static str> {
        if is_translated(lang) {
            Some(label)
        } else {
            None
        }
    }

    /// The standard items of the Window submenu (without the list of open windows).
    pub fn window_items(
        app: &tauri::AppHandle,
    ) -> tauri::Result<Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>>> {
        let lang = current_language();
        let l = labels_for(&lang);
        Ok(vec![
            Box::new(PredefinedMenuItem::minimize(app, text(&lang, l.minimize))?),
            Box::new(PredefinedMenuItem::maximize(app, text(&lang, l.zoom))?),
            Box::new(PredefinedMenuItem::separator(app)?),
            Box::new(PredefinedMenuItem::close_window(app, text(&lang, l.close_window))?),
        ])
    }

    /// The whole macOS menu bar: App, Edit and Window.
    pub fn build(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
        let lang = current_language();
        let l = labels_for(&lang);
        let t = |s: &'static str| text(&lang, s);

        let app_submenu = Submenu::with_items(
            app,
            "OpenDraft",
            true,
            &[
                // English always spelled this one out.
                &PredefinedMenuItem::about(app, Some(l.about), None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, t(l.services))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, t(l.hide))?,
                &PredefinedMenuItem::hide_others(app, t(l.hide_others))?,
                &PredefinedMenuItem::show_all(app, t(l.show_all))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, t(l.quit))?,
            ],
        )?;
        let edit_submenu = Submenu::with_items(
            app,
            l.edit,
            true,
            &[
                &PredefinedMenuItem::undo(app, t(l.undo))?,
                &PredefinedMenuItem::redo(app, t(l.redo))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, t(l.cut))?,
                &PredefinedMenuItem::copy(app, t(l.copy))?,
                &PredefinedMenuItem::paste(app, t(l.paste))?,
                &PredefinedMenuItem::select_all(app, t(l.select_all))?,
            ],
        )?;
        let items = window_items(app)?;
        let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = items.iter().map(|b| b.as_ref()).collect();
        let window_submenu = Submenu::with_id_and_items(app, WINDOW_MENU_ID, l.window, true, &refs)?;
        Menu::with_items(app, &[&app_submenu, &edit_submenu, &window_submenu])
    }
}

#[cfg(target_os = "macos")]
pub use mac::{build, window_items};

#[cfg(test)]
mod tests {
    use super::*;

    const SHIPPED: [&str; 7] = ["es", "fr", "pt", "ru", "tr", "ar", "fa"];

    fn all(l: &Labels) -> Vec<&'static str> {
        vec![
            l.about, l.services, l.hide, l.hide_others, l.show_all, l.quit, l.edit, l.undo, l.redo, l.cut,
            l.copy, l.paste, l.select_all, l.window, l.minimize, l.zoom, l.close_window,
        ]
    }

    #[test]
    fn every_shipped_language_is_translated_and_complete() {
        for code in SHIPPED {
            assert!(is_translated(code), "{code} has no native menu translation");
            for s in all(labels_for(code)) {
                assert!(!s.trim().is_empty(), "{code}: empty label");
            }
        }
    }

    #[test]
    fn no_translation_is_left_in_english() {
        let en = all(&EN);
        for code in SHIPPED {
            let same = all(labels_for(code)).iter().zip(en.iter()).filter(|(a, b)| a == b).count();
            // "Services" (fr) and "Zoom" are legitimately the same word.
            assert!(same <= 3, "{code}: {same} labels are still the English text");
        }
    }

    #[test]
    fn english_and_unknown_codes_use_english() {
        assert!(!is_translated("en"));
        assert!(!is_translated("de"));
        assert!(!is_translated(""));
        assert!(std::ptr::eq(labels_for("xx"), &EN));
    }

    #[test]
    fn language_can_be_set_and_read_back() {
        set_language("ru");
        assert_eq!(current_language(), "ru");
        assert_eq!(current().window, "Окно");
        set_language("en");
        assert_eq!(current().window, "Window");
    }
}
