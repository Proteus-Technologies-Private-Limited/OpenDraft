//! Platform text-to-speech for Table Read (issue #131).
//!
//! Most of the app's web views can speak on their own — WKWebView on macOS and
//! iOS, WebView2 on Windows — and the frontend uses `speechSynthesis` there.
//! Two cannot:
//!
//! - **Android's WebView** never implemented `speechSynthesis`. The app speaks
//!   through `android.speech.tts.TextToSpeech` instead, in MainActivity.kt,
//!   which also reports the word being spoken.
//! - **Linux's WebKitGTK** is usually built without it. The app speaks through
//!   whichever command-line synthesiser is installed: speech-dispatcher's
//!   `spd-say`, or eSpeak NG. Neither reports words, so the frontend times them.
//!
//! macOS's `say` is wired up too, as a fallback should its web view ever come
//! up without voices.
//!
//! The commands are shaped for polling: `tts_native_speak` starts a line and
//! returns, `tts_native_poll` drains what has happened since, and
//! `tts_native_stop` cuts it off. No IPC call is ever held open for the length
//! of a sentence, so Stop and Pause are always answered at once.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NativeVoice {
    pub id: String,
    pub name: String,
    pub lang: String,
    #[serde(default)]
    pub gender: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NativeEvent {
    pub id: u64,
    /// "start" | "word" | "done" | "error"
    pub kind: String,
    #[serde(default)]
    pub start: Option<usize>,
    #[serde(default)]
    pub end: Option<usize>,
    #[serde(default)]
    pub message: Option<String>,
}

/// The installed voices, or `None` while the engine is still starting (Android
/// binds its TTS service in the background on first use).
#[tauri::command]
pub fn tts_native_voices() -> Result<Option<Vec<NativeVoice>>, String> {
    platform::voices()
}

#[tauri::command]
pub fn tts_native_speak(id: u64, text: String, voice: Option<String>, rate: f32, pitch: f32) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("Nothing to say".to_string());
    }
    let rate = if rate.is_finite() { rate.clamp(0.25, 4.0) } else { 1.0 };
    let pitch = if pitch.is_finite() { pitch.clamp(0.25, 2.0) } else { 1.0 };
    platform::speak(id, &text, voice.as_deref().filter(|v| !v.is_empty()), rate, pitch)
}

#[tauri::command]
pub fn tts_native_poll() -> Vec<NativeEvent> {
    platform::poll()
}

#[tauri::command]
pub fn tts_native_stop() -> Result<(), String> {
    platform::stop()
}

// ── Desktop: a command-line synthesiser ──────────────────────────────────────

#[cfg(desktop)]
mod platform {
    use super::{NativeEvent, NativeVoice};
    use std::collections::VecDeque;
    use std::process::{Child, Command, Stdio};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    #[derive(Clone, Copy, PartialEq, Debug)]
    enum Backend {
        /// speech-dispatcher — the desktop's own speech service on most Linux distributions.
        SpdSay,
        /// eSpeak NG (or the older eSpeak) — small, everywhere, robotic.
        Espeak(&'static str),
        /// macOS.
        Say,
    }

    struct Running {
        id: u64,
        child: Arc<Mutex<Child>>,
        backend: Backend,
    }

    static EVENTS: Mutex<VecDeque<NativeEvent>> = Mutex::new(VecDeque::new());
    static CURRENT: Mutex<Option<Running>> = Mutex::new(None);

    fn push(ev: NativeEvent) {
        if let Ok(mut q) = EVENTS.lock() {
            // A frontend that stopped polling must not grow this forever.
            if q.len() > 500 {
                q.pop_front();
            }
            q.push_back(ev);
        }
    }

    fn event(id: u64, kind: &str, message: Option<String>) -> NativeEvent {
        NativeEvent { id, kind: kind.to_string(), start: None, end: None, message }
    }

    /// True when `name` is an executable somewhere on PATH.
    fn on_path(name: &str) -> bool {
        let Some(path) = std::env::var_os("PATH") else { return false };
        std::env::split_paths(&path).any(|dir| {
            let p = dir.join(name);
            std::fs::metadata(&p).map(|m| m.is_file()).unwrap_or(false)
        })
    }

    fn backend() -> Option<Backend> {
        if cfg!(target_os = "macos") {
            return Some(Backend::Say);
        }
        if cfg!(target_os = "windows") {
            // WebView2 speaks with the Windows voices; nothing to fall back to here.
            return None;
        }
        if on_path("spd-say") {
            Some(Backend::SpdSay)
        } else if on_path("espeak-ng") {
            Some(Backend::Espeak("espeak-ng"))
        } else if on_path("espeak") {
            Some(Backend::Espeak("espeak"))
        } else {
            None
        }
    }

    fn run_for_output(cmd: &str, args: &[&str]) -> Result<String, String> {
        let out = Command::new(cmd)
            .args(args)
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("Could not run {}: {}", cmd, e))?;
        if !out.status.success() {
            return Err(format!(
                "{} failed: {}",
                cmd,
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    /// `spd-say -L`:
    /// ```text
    ///      NAME                 LANGUAGE        VARIANT
    ///   Afrikaans                 af              none
    /// ```
    pub(super) fn parse_spd_voices(out: &str) -> Vec<NativeVoice> {
        let mut voices = Vec::new();
        for line in out.lines().skip(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 3 {
                continue;
            }
            let lang = parts[parts.len() - 2];
            let variant = parts[parts.len() - 1];
            let name = parts[..parts.len() - 2].join(" ");
            if name.is_empty() {
                continue;
            }
            voices.push(NativeVoice {
                id: name.clone(),
                name,
                lang: lang.to_string(),
                gender: None,
                detail: (variant != "none").then(|| variant.to_string()),
            });
        }
        voices
    }

    /// `espeak-ng --voices`:
    /// ```text
    /// Pty Language       Age/Gender VoiceName          File                 Other Languages
    ///  5  af              --/M      Afrikaans          gmw/af
    /// ```
    pub(super) fn parse_espeak_voices(out: &str) -> Vec<NativeVoice> {
        let mut voices = Vec::new();
        for line in out.lines().skip(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 4 {
                continue;
            }
            let lang = parts[1];
            let gender = match parts[2].rsplit('/').next() {
                Some("M") => Some("male".to_string()),
                Some("F") => Some("female".to_string()),
                _ => None,
            };
            let name = parts[3].replace('_', " ");
            voices.push(NativeVoice {
                id: parts[3].to_string(),
                name,
                lang: lang.to_string(),
                gender,
                detail: None,
            });
        }
        voices
    }

    /// `say -v '?'`:
    /// ```text
    /// Alex                en_US    # Most people recognize me by my voice.
    /// Eddy (English (US)) en_US    # Hello! My name is Eddy.
    /// ```
    pub(super) fn parse_say_voices(out: &str) -> Vec<NativeVoice> {
        let mut voices = Vec::new();
        for line in out.lines() {
            let left = line.split('#').next().unwrap_or("").trim_end();
            let Some(split) = left.rfind(char::is_whitespace) else { continue };
            let name = left[..split].trim();
            let lang = left[split..].trim();
            if name.is_empty() || lang.is_empty() {
                continue;
            }
            voices.push(NativeVoice {
                id: name.to_string(),
                name: name.to_string(),
                lang: lang.replace('_', "-"),
                gender: None,
                detail: None,
            });
        }
        voices
    }

    pub fn voices() -> Result<Option<Vec<NativeVoice>>, String> {
        let list = match backend() {
            Some(Backend::SpdSay) => parse_spd_voices(&run_for_output("spd-say", &["-L"])?),
            Some(Backend::Espeak(cmd)) => parse_espeak_voices(&run_for_output(cmd, &["--voices"])?),
            Some(Backend::Say) => parse_say_voices(&run_for_output("say", &["-v", "?"])?),
            None => {
                return Err(if cfg!(target_os = "linux") {
                    "No speech synthesiser was found. Install speech-dispatcher or espeak-ng.".to_string()
                } else {
                    "This platform's speech is provided by the web view.".to_string()
                })
            }
        };
        Ok(Some(list))
    }

    /// Text is passed as an argument; one starting with '-' would be read as an option.
    fn safe_text(text: &str) -> String {
        let t = text.replace(['\r', '\n'], " ");
        if t.starts_with('-') { format!(" {}", t) } else { t }
    }

    fn command_for(backend: Backend, text: &str, voice: Option<&str>, rate: f32, pitch: f32) -> Command {
        let text = safe_text(text);
        match backend {
            Backend::SpdSay => {
                let mut c = Command::new("spd-say");
                // -w: wait until spoken, so the process's exit is the end of the line.
                c.arg("-w");
                c.args(["-r", &(((rate - 1.0) * 100.0).round().clamp(-100.0, 100.0) as i32).to_string()]);
                c.args(["-p", &(((pitch - 1.0) * 100.0).round().clamp(-100.0, 100.0) as i32).to_string()]);
                if let Some(v) = voice {
                    c.args(["-y", v]);
                }
                c.arg(text);
                c
            }
            Backend::Espeak(cmd) => {
                let mut c = Command::new(cmd);
                c.args(["-s", &((175.0 * rate).round().clamp(80.0, 450.0) as i32).to_string()]);
                c.args(["-p", &((50.0 * pitch).round().clamp(0.0, 99.0) as i32).to_string()]);
                if let Some(v) = voice {
                    c.args(["-v", v]);
                }
                c.arg(text);
                c
            }
            Backend::Say => {
                let mut c = Command::new("say");
                c.args(["-r", &((185.0 * rate).round().clamp(90.0, 500.0) as i32).to_string()]);
                if let Some(v) = voice {
                    c.args(["-v", v]);
                }
                c.arg(text);
                c
            }
        }
    }

    pub fn speak(id: u64, text: &str, voice: Option<&str>, rate: f32, pitch: f32) -> Result<(), String> {
        let backend = backend().ok_or("No speech synthesiser is available on this system.")?;
        stop()?;
        let child = command_for(backend, text, voice, rate, pitch)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not start the speech synthesiser: {}", e))?;
        let child = Arc::new(Mutex::new(child));
        {
            let mut cur = CURRENT.lock().map_err(|_| "speech state poisoned")?;
            *cur = Some(Running { id, child: child.clone(), backend });
        }
        push(event(id, "start", None));

        // Watch for the end of the line without holding the lock while it plays.
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(40));
            let status = match child.lock() {
                Ok(mut c) => c.try_wait(),
                Err(_) => return,
            };
            match status {
                Ok(None) => continue,
                Ok(Some(status)) => {
                    let still_current = CURRENT
                        .lock()
                        .map(|c| c.as_ref().map(|r| r.id) == Some(id))
                        .unwrap_or(false);
                    if !still_current {
                        // Stopped, or replaced by the next line: nothing to report.
                        return;
                    }
                    if let Ok(mut c) = CURRENT.lock() {
                        *c = None;
                    }
                    if status.success() {
                        push(event(id, "done", None));
                    } else {
                        let mut stderr = String::new();
                        if let Ok(mut c) = child.lock() {
                            if let Some(mut err) = c.stderr.take() {
                                use std::io::Read;
                                let _ = err.read_to_string(&mut stderr);
                            }
                        }
                        eprintln!("[tts] synthesiser exited with {}: {}", status, stderr.trim());
                        push(event(
                            id,
                            "error",
                            Some(format!("The speech synthesiser failed ({}). {}", status, stderr.trim())),
                        ));
                    }
                    return;
                }
                Err(e) => {
                    push(event(id, "error", Some(format!("Lost track of the speech synthesiser: {}", e))));
                    return;
                }
            }
        });
        Ok(())
    }

    pub fn poll() -> Vec<NativeEvent> {
        EVENTS.lock().map(|mut q| q.drain(..).collect()).unwrap_or_default()
    }

    pub fn stop() -> Result<(), String> {
        let running = CURRENT.lock().map_err(|_| "speech state poisoned")?.take();
        if let Some(r) = running {
            if let Ok(mut c) = r.child.lock() {
                let _ = c.kill();
                let _ = c.wait();
            }
            if r.backend == Backend::SpdSay {
                // speech-dispatcher keeps speaking a message after its client
                // dies; cancel it at the service.
                let _ = Command::new("spd-say").arg("-C").stdin(Stdio::null()).status();
            }
        }
        Ok(())
    }
}

// ── Android: android.speech.tts.TextToSpeech, through MainActivity ──────────

#[cfg(target_os = "android")]
mod platform {
    use super::{NativeEvent, NativeVoice};

    pub fn voices() -> Result<Option<Vec<NativeVoice>>, String> {
        match crate::android_static_call("ttsVoices", &[])? {
            None => Ok(None),
            Some(json) => {
                // ttsVoices reports a failure as {"error": "..."}.
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
                    if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
                        return Err(err.to_string());
                    }
                }
                serde_json::from_str(&json)
                    .map(Some)
                    .map_err(|e| format!("Unreadable voice list: {}", e))
            }
        }
    }

    pub fn speak(id: u64, text: &str, voice: Option<&str>, rate: f32, pitch: f32) -> Result<(), String> {
        let id = id.to_string();
        let rate = rate.to_string();
        let pitch = pitch.to_string();
        match crate::android_static_call("ttsSpeak", &[&id, text, voice.unwrap_or(""), &rate, &pitch])? {
            Some(err) => Err(err),
            None => Ok(()),
        }
    }

    pub fn poll() -> Vec<NativeEvent> {
        match crate::android_static_call("ttsPoll", &[]) {
            Ok(Some(json)) => serde_json::from_str(&json).unwrap_or_else(|e| {
                eprintln!("[tts] unreadable events: {}", e);
                Vec::new()
            }),
            Ok(None) => Vec::new(),
            Err(e) => {
                eprintln!("[tts] poll failed: {}", e);
                Vec::new()
            }
        }
    }

    pub fn stop() -> Result<(), String> {
        match crate::android_static_call("ttsStop", &[])? {
            Some(err) => Err(err),
            None => Ok(()),
        }
    }
}

// ── iOS: WKWebView speaks; nothing native needed ────────────────────────────

#[cfg(target_os = "ios")]
mod platform {
    use super::{NativeEvent, NativeVoice};

    const MSG: &str = "On iOS, speech is provided by the web view.";

    pub fn voices() -> Result<Option<Vec<NativeVoice>>, String> {
        Err(MSG.to_string())
    }
    pub fn speak(_id: u64, _text: &str, _voice: Option<&str>, _rate: f32, _pitch: f32) -> Result<(), String> {
        Err(MSG.to_string())
    }
    pub fn poll() -> Vec<NativeEvent> {
        Vec::new()
    }
    pub fn stop() -> Result<(), String> {
        Ok(())
    }
}

#[cfg(all(test, desktop))]
mod tests {
    use super::platform::{parse_espeak_voices, parse_say_voices, parse_spd_voices};

    #[test]
    fn reads_spd_say_voice_list() {
        let out = "     NAME                 LANGUAGE        VARIANT\n  Afrikaans                 af              none\n English (America)  en-US  m3\n";
        let v = parse_spd_voices(out);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].name, "Afrikaans");
        assert_eq!(v[0].lang, "af");
        assert_eq!(v[0].detail, None);
        assert_eq!(v[1].name, "English (America)");
        assert_eq!(v[1].lang, "en-US");
        assert_eq!(v[1].detail.as_deref(), Some("m3"));
    }

    #[test]
    fn reads_espeak_voice_list() {
        let out = "Pty Language       Age/Gender VoiceName          File                 Other Languages\n 5  af              --/M      Afrikaans          gmw/af\n 2  en-gb           --/F      English_(Great_Britain) gmw/en\n";
        let v = parse_espeak_voices(out);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].id, "Afrikaans");
        assert_eq!(v[0].gender.as_deref(), Some("male"));
        assert_eq!(v[1].name, "English (Great Britain)");
        assert_eq!(v[1].gender.as_deref(), Some("female"));
    }

    #[test]
    fn reads_say_voice_list() {
        let out = "Alex                en_US    # Most people recognize me by my voice.\nEddy (English (US)) en_US    # Hello! My name is Eddy.\n";
        let v = parse_say_voices(out);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].name, "Alex");
        assert_eq!(v[0].lang, "en-US");
        assert_eq!(v[1].name, "Eddy (English (US))");
    }
}
