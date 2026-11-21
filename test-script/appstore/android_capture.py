#!/usr/bin/env python3
"""Capture the Google Play phone screenshots from a running Android emulator.

    venv/bin/python test-script/appstore/android_capture.py [--serial emulator-5560]
    venv/bin/python test-script/appstore/compose.py play-phone

Writes test-script/output/appstore/raw/android-0N-*.png, which compose.py frames
and captions into images/playstore/phone/.

Needs a DEBUG build of the current code installed on the emulator (see
docs/RELEASE.md / "Local Android development"), and the emulator to be the only
OpenDraft install you care about: the app is force-stopped and its open script
replaced by "The Last Reel". Two things are set so the shots look right:

  - the system's dark theme. OpenDraft's bars are dark, and the activity picks
    its status-bar icon colour from the system theme when it starts, so in the
    system's light theme the clock and battery come out dark on dark.
  - the system demo mode, for a 9:41 clock and a full battery.

Table Read is captured idle: an emulator has no speech engine, so playing it
shows a spinner and highlights nothing.
"""
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "ios_smoke"))
import android_shot  # noqa: E402
from android_cdp import ADB, AndroidWebView, JavaScriptError, PACKAGE, adb  # noqa: E402

LIB = android_shot.LIB
RAW = android_shot.RAW


class Driver:
    def __init__(self, serial: str, port: int):
        self.serial = serial
        self.view = AndroidWebView(serial=serial, port=port)

    def js(self, expression: str) -> str:
        return self.view.evaluate(f"(() => {{\n{LIB}\nreturn {expression};\n}})()")

    def click(self, selector: str, label: str, *, required: bool = True) -> str:
        reply = self.js(f"od.click({selector!r}, {label!r})")
        if required and reply.startswith("NOT FOUND"):
            raise RuntimeError(f"could not click {label!r}: {reply}")
        return reply

    def shot(self, name: str) -> None:
        RAW.mkdir(parents=True, exist_ok=True)
        self.view.screenshot(str(RAW / f"{name}.png"))
        print(f"  captured {name}")

    def menu(self, *path: str) -> None:
        """File > Export, View > Panels > Outline… — top-level item first, then each dropdown row."""
        self.click(".menu-item", path[0])
        for label in path[1:]:
            time.sleep(0.8)
            self.click(".menu-dropdown-item", label)
        time.sleep(1.5)

    def close_menu(self) -> None:
        # The menu bar item toggles its dropdown, so a second tap on the open one closes it.
        self.js("(document.querySelector('.menu-item.active')?.dispatchEvent(new MouseEvent('click',{bubbles:true})), 'ok')")


def prepare(serial: str) -> None:
    for key in ("window_animation_scale", "transition_animation_scale", "animator_duration_scale"):
        adb("shell", "settings", "put", "global", key, "0", serial=serial)
    adb("shell", "cmd", "uimode", "night", "yes", serial=serial)
    adb("shell", "am", "force-stop", PACKAGE, serial=serial)
    adb("shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity", serial=serial)
    time.sleep(10)
    android_shot.demo_mode(serial, True)


def run(serial: str, port: int) -> None:
    prepare(serial)
    d = Driver(serial, port)
    d.view.connect(60)

    # The first launch asks how to start; a later one may offer to restore the last session.
    d.click("button.welcome-choice-btn", "📄 Blank Document", required=False)
    time.sleep(1.5)
    d.click("button", "Discard", required=False)
    time.sleep(1)
    print(d.js(android_shot.load_expression()))
    d.js("od.caretAt('Dust drifts', 'start')")
    time.sleep(1)

    print("1/6 editor")
    d.shot("android-01-editor")

    print("2/6 Table Read")
    d.menu("Tools", "Table Read")
    time.sleep(3)
    d.shot("android-02-tableread")
    d.js("([...document.querySelectorAll('.table-read-icon-btn')].pop()?.click(), 'closed')")
    time.sleep(1)

    print("3/6 index cards")
    d.menu("View", "Panels", "Index Cards")
    time.sleep(3)
    d.shot("android-03-cards")
    d.js("(document.querySelector('.ic-close-btn')?.click(), document.querySelector('.panel-close-btn')?.click(), 'closed')")
    time.sleep(1)

    print("4/6 outline")
    d.menu("View", "Panels", "Outline")
    time.sleep(3)
    d.shot("android-04-outline")
    d.menu("View", "Panels", "✓ Outline")  # the open panel is ticked; choosing it again closes it
    time.sleep(1)

    print("5/6 navigator")
    d.menu("View", "Panels", "Navigator")
    time.sleep(3)
    d.shot("android-05-navigator")
    d.js("(document.querySelector('.navigator-close')?.click(), 'closed')")
    time.sleep(1)

    print("6/6 export menu")
    d.menu("File", "Export")
    d.shot("android-06-export")
    d.close_menu()
    d.view.close()


def main(argv: list) -> int:
    serial, port = "emulator-5560", 9334
    while argv:
        flag = argv.pop(0)
        if flag == "--serial":
            serial = argv.pop(0)
        elif flag == "--port":
            port = int(argv.pop(0))
        else:
            print(__doc__)
            return 2
    try:
        run(serial, port)
    except (RuntimeError, JavaScriptError, OSError, ConnectionError, subprocess.SubprocessError) as error:
        print(f"capture failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
