export interface RecognitionSession { stop(): void; cancel(): void }
export interface RecognitionCallbacks {
  result(text: string): void;
  interim(text: string): void;
  error(message: string): void;
  end(): void;
}
interface BrowserResult { isFinal: boolean; 0: { transcript: string } }
export interface BrowserRecognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<BrowserResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
export function browserRecognitionConstructor(): (new () => BrowserRecognition) | undefined {
  const w = window as unknown as { SpeechRecognition?: new () => BrowserRecognition; webkitSpeechRecognition?: new () => BrowserRecognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}
export function startBrowserRecognition(language: string, callbacks: RecognitionCallbacks): RecognitionSession {
  const Constructor = browserRecognitionConstructor();
  if (!Constructor) throw new Error('Speech recognition is unavailable in this browser. Choose Local Whisper.');
  const recognition = new Constructor();
  let live = true;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  recognition.lang = language;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.onresult = (event) => {
    if (!live) return;
    const interim: string[] = [];
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) callbacks.result(result[0].transcript);
      else interim.push(result[0].transcript);
    }
    if (interim.length) callbacks.interim(interim.join(' '));
  };
  recognition.onerror = (event) => {
    if (!live) return;
    live = false; clearTimeout(deadline);
    callbacks.error(`Speech recognition: ${event.error}.`);
    callbacks.end();
    recognition.abort();
  };
  recognition.onend = () => { if (live) { live = false; clearTimeout(deadline); callbacks.end(); } };
  try { recognition.start(); }
  catch (error) { live = false; try { recognition.abort(); } catch { /* Already stopped. */ } throw error; }
  if (live) deadline = setTimeout(() => {
    if (!live) return;
    live = false;
    recognition.abort();
    callbacks.end();
  }, 60_000);
  return {
    stop: () => { if (live) recognition.stop(); },
    cancel: () => { live = false; clearTimeout(deadline); recognition.onresult = null; recognition.onerror = null; recognition.onend = null; recognition.abort(); },
  };
}
