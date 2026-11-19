"""Settings page: every pane opens, and every setting the browser build shows
is changed through the page, survives a reload, and does what it says.

Run against the dev server the user already has open:
    OPENDRAFT_TEST_URL=http://localhost:5173/ venv/bin/python test-script/settings/regressions.py [-k name]

The signed-in account checks fulfil the backend's /api/auth/* calls with a
synthetic user and devices; nothing reaches a real server. Backups, project
folders and the Add-ons pane's real add-ons exist only in the app builds and
are not covered here (Add-ons uses a synthetic opt-in plugin).
"""

import importlib.util
import json
import os
from pathlib import Path
import re
import unittest
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "menu_fixture", ROOT / "test-script/menu-keyboard/regressions.py"
)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

# Add-ons shows because the core ships opt-in add-ons (Dictation, AI Assistant).
PANES = ["general", "saving", "writing", "export", "account", "addons", "advanced"]

# Every label the tests look for, read from the app's own English strings so a
# copy change does not break the suite. [key, options] pairs.
LABELS = {
    "title": ["settings:page.title"],
    "search": ["settings:nav.search"],
    **{p: [f"settings:nav.{p}"] for p in PANES if p != "addons"},
    "addons": ["settings:addOns.title"],  # the pane reuses the section's own title
    "menuOnEnter": ["settings:editing.menuOnEnter"],
    "library": ["settings:saving.library"],
    "interval2m": ["settings:saving.intervalMinutes", {"count": 2}],
    "smartSave": ["settings:smartType.save"],
    "smartSaved": ["settings:smartType.saved"],
    "transitions": ["settings:smartType.fields.transitions.label"],
    "macroAdd": ["settings:macros.add"],
    "macroText": ["settings:macros.text"],
    "macroEmpty": ["settings:macros.empty"],
    "name": ["common:name"],
    "remove": ["common:remove"],
    "useAi": ["settings:voice.useAi"],
    "useSystem": ["settings:voice.useSystemComputer"],
    "viaPdf": ["settings:printing.viaPdf"],
    "exactHighlights": ["settings:wordExport.exactHighlights"],
    "expiry30m": ["settings:invite.expiryMinutes", {"count": 30}],
    "expiry7d": ["settings:invite.expiryDays", {"count": 7}],
    "signIn": ["settings:auth.signIn"],
    "createAccount": ["settings:auth.createAccount"],
    "accountTitle": ["settings:account.title"],
    "thisDevice": ["settings:account.devices.thisDevice"],
    "revoke": ["settings:account.devices.revoke"],
    "deleteOpen": ["settings:account.delete.open"],
    "deleteConfirm": ["settings:account.delete.confirm"],
    "cancel": ["common:cancel"],
    "on": ["common:on"],
    "off": ["common:off"],
    "twoFactorOn": ["settings:account.twoFactorOnToast"],
    "urlInvalid": ["settings:collabServer.urlInvalid"],
    "urlSaved": ["settings:collabServer.urlSaved"],
    "cloudInvalid": ["settings:cloud.urlInvalid"],
    "cloudSaved": ["settings:cloud.urlSaved"],
    "save": ["common:save"],
    "turnOn": ["settings:addOns.turnOn"],
    "settingsMenu": ["menu:tools.systemSettings"],
    "insertMacro": ["menu:edit.insertMacro"],
    "manageMacros": ["menu:edit.manageMacros"],
}

USER = {
    "id": "u-test",
    "email": "writer@example.test",
    "displayName": "Test Writer",
    "emailVerified": True,
    "twoFactorEnabled": False,
}


class SettingsPage(unittest.TestCase):
    setUp = fixture.MenuKeyboard.setUp
    start_page = fixture.MenuKeyboard.start_page
    tearDown = fixture.MenuKeyboard.tearDown
    open = fixture.MenuKeyboard.open
    row = fixture.MenuKeyboard.row
    press = fixture.MenuKeyboard.press

    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = fixture.launch_browser(cls.playwright)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    # ── helpers ──

    @property
    def L(self):
        if not hasattr(self, "_labels"):
            self._labels = self.page.evaluate(
                "labels => Object.fromEntries(Object.entries(labels)"
                ".map(([k, [key, opts]]) => [k, testI18n.t(key, opts)]))",
                LABELS,
            )
        return self._labels

    def settings(self, hash_=""):
        """Open Settings from the editor (a client-side navigation, as the menus do)."""
        self.L  # read the labels while the editor's test hooks exist
        self.page.evaluate(
            "h => { history.pushState({}, '', '/settings' + h);"
            " dispatchEvent(new PopStateEvent('popstate')); }",
            hash_,
        )
        expect(self.page.locator(".settings-page")).to_be_visible()

    def reload(self):
        self.page.reload()
        expect(self.page.locator(".settings-page")).to_be_visible()

    def nav(self, pane):
        return self.page.locator(".settings-nav").get_by_role(
            "button", name=self.L[pane], exact=True
        )

    def pane(self, pane):
        self.nav(pane).click()
        self.expect_pane(pane)

    def expect_pane(self, pane, fragment=True):
        expect(self.page.locator(".settings-pane-title")).to_have_text(self.L[pane])
        expect(self.nav(pane)).to_have_attribute("aria-current", "page")
        if fragment:
            self.assertEqual(urlparse(self.page.url).fragment, pane)

    def checkbox(self, label):
        return self.page.locator(".settings-content").get_by_label(label, exact=True)

    def stored(self, key):
        return self.page.evaluate("k => localStorage.getItem(k)", key)

    def setting(self, name):
        """A value as the settings store holds it, not as the page shows it."""
        return self.page.evaluate("""async name => {
            const url = performance.getEntriesByType('resource')
                .find(e => new URL(e.name).pathname === '/src/stores/settingsStore.ts').name;
            return (await import(url)).useSettingsStore.getState()[name];
        }""", name)

    def choose(self, combobox, option):
        """Pick an option from the app's own Select (role=combobox + listbox)."""
        combobox.click()
        self.page.get_by_role("option", name=option, exact=True).click()
        expect(combobox).to_contain_text(option)

    def toast(self, kind, text):
        expect(
            self.page.locator(f".toast-message--{kind}").filter(has_text=text).last
        ).to_be_visible()

    def section(self, title):
        return self.page.locator(".settings-section").filter(
            has=self.page.locator(".settings-section-title", has_text=title)
        )

    # ── navigation ──

    def test_menu_entry_every_pane_hash_links_and_back(self):
        start = self.page.url
        self.L
        self.open("Tools")
        self.row(self.L["settingsMenu"]).click()
        expect(self.page.locator(".settings-page")).to_be_visible()
        self.expect_pane("general", fragment=False)  # plain /settings
        expect(self.page.locator(".settings-page h1")).to_have_text(self.L["title"])
        depth = self.page.evaluate("history.length")
        for p in PANES:
            self.pane(p)
            # Each pane has content under its heading.
            self.assertGreater(
                self.page.locator(".settings-content .settings-section").count(), 0, p
            )
        # Switching panes replaces the entry, so Back leaves Settings in one step.
        self.assertEqual(self.page.evaluate("history.length"), depth)
        self.page.go_back()
        expect(self.page.locator(".editor-main")).to_be_visible()
        self.page.go_forward()
        expect(self.page.locator(".settings-page")).to_be_visible()
        # Each pane opens straight from its link, and survives a reload.
        for p in PANES:
            self.page.evaluate("h => { location.hash = h; }", p)
            self.expect_pane(p)
        self.reload()
        self.expect_pane("advanced")
        # Old links still land on the pane that now holds them.
        for old, new in [("macros", "writing"), ("smarttype", "writing"),
                         ("backups", "saving"), ("nonsense", "general")]:
            self.page.goto(f"{start.rstrip('/')}/settings#{old}")
            expect(self.page.locator(".settings-pane-title")).to_have_text(self.L[new])
            expect(self.nav(new)).to_have_attribute("aria-current", "page")

    def test_edit_menu_manage_macros_opens_writing_tools(self):
        self.L
        self.open("Edit")
        self.row(self.L["insertMacro"]).focus()
        self.press("ArrowRight")
        self.row(self.L["manageMacros"]).focus()
        self.press("Enter")
        expect(self.page.locator(".settings-page")).to_be_visible()
        expect(self.page.locator(".settings-pane-title")).to_have_text(self.L["writing"])
        expect(self.page.locator("#macros")).to_be_in_viewport()

    def test_search_filters_opens_first_match_and_clears(self):
        self.settings()
        search = self.page.get_by_role("searchbox", name=self.L["search"])
        expect(search).to_have_value("")
        search.fill("macro")
        expect(self.page.locator(".settings-nav-item")).to_have_count(1)
        expect(self.nav("writing")).to_be_visible()
        search.press("Enter")
        self.expect_pane("writing")
        search.fill("PASSWORD")  # case does not matter
        expect(self.nav("account")).to_be_visible()
        search.press("Enter")
        self.expect_pane("account")
        search.fill("zzzz-not-a-setting")
        expect(self.page.locator(".settings-nav-empty")).to_be_visible()
        expect(self.page.locator(".settings-nav-item")).to_have_count(0)
        search.press("Escape")
        expect(search).to_have_value("")
        expect(self.page.locator(".settings-nav-item")).to_have_count(len(PANES))
        # Escape clearing the search must not also leave Settings.
        expect(self.page.locator(".settings-page")).to_be_visible()

    # ── General ──

    def test_language_changes_interface_and_persists(self):
        self.settings("#general")
        english_title = self.L["title"]
        french = self.page.get_by_role("radio", name="Français", exact=False).first
        french.click()
        expect(french).to_have_attribute("aria-checked", "true")
        expect(self.page.locator(".settings-page h1")).not_to_have_text(english_title)
        expect(self.page.locator("html")).to_have_attribute("lang", "fr")
        french_title = self.page.locator(".settings-page h1").inner_text()
        self.reload()
        expect(self.page.locator(".settings-page h1")).to_have_text(french_title)
        english = self.page.get_by_role("radio", name="English", exact=True)
        english.click()
        expect(self.page.locator(".settings-page h1")).to_have_text(english_title)

    def test_element_menu_on_enter_and_shortcut(self):
        self.settings("#general")
        box = self.checkbox(self.L["menuOnEnter"])
        expect(box).to_be_checked()
        box.uncheck()
        self.assertEqual(self.stored("opendraft:elementMenuOnEnter"), "0")
        field = self.page.locator("#element-menu-shortcut")
        field.click()
        self.page.keyboard.press("Control+Alt+KeyE")
        expect(field).not_to_have_text(self.page.evaluate("testI18n.t('settings:shortcutField.pressKeys')"))
        shortcut = self.stored("opendraft:elementMenuShortcut")
        self.assertEqual((shortcut or "").lower(), "ctrl-alt-e")
        self.reload()
        expect(self.checkbox(self.L["menuOnEnter"])).not_to_be_checked()
        self.assertEqual(self.stored("opendraft:elementMenuShortcut"), shortcut)
        # The editor obeys it: Enter on a blank line no longer opens the menu.
        self.page.go_back()
        self.page.locator(".ProseMirror").wait_for()
        editor = self.page.locator(".ProseMirror")
        editor.click()
        self.page.keyboard.press("End")
        self.page.keyboard.press("Enter")
        self.page.keyboard.press("Enter")
        expect(self.page.locator(".element-picker")).to_have_count(0)

    # ── Saving & Backups ──

    def test_auto_save_switches_and_interval_persist(self):
        self.settings("#saving")
        library = self.checkbox(self.L["library"])
        interval = self.page.locator("#settings-save-interval")
        expect(library).to_be_checked()
        self.choose(interval, self.L["interval2m"])
        self.assertEqual(self.stored("opendraft:autoSaveIntervalSeconds"), "120")
        library.uncheck()
        self.assertEqual(self.stored("opendraft:autoSaveLibrary"), "0")
        switches = self.page.locator(".settings-content input[type=checkbox]")
        if switches.count() > 1:
            # Saving opened files in place (Chromium's File System Access).
            files = switches.nth(1)
            files.check()
            self.assertEqual(self.stored("opendraft:autoSaveFiles"), "1")
            expect(interval).to_be_enabled()
            files.uncheck()
        # With nothing auto-saving, the interval has nothing to time.
        expect(interval).to_be_disabled()
        self.reload()
        expect(self.checkbox(self.L["library"])).not_to_be_checked()
        expect(self.page.locator("#settings-save-interval")).to_contain_text(self.L["interval2m"])
        self.checkbox(self.L["library"]).check()
        expect(self.page.locator("#settings-save-interval")).to_be_enabled()
        # The browser build says backups need the app, under its own heading.
        expect(self.page.locator(".settings-section")).to_have_count(2)

    # ── Writing Tools ──

    def test_smarttype_list_saves_and_persists(self):
        self.settings("#writing")
        transitions = self.page.locator("#smarttype-transitions")
        before = transitions.input_value()
        transitions.fill(before + "\nsmash cut to:")
        self.page.get_by_role("button", name=self.L["smartSave"]).click()
        expect(self.page.get_by_role("status").filter(has_text=self.L["smartSaved"])).to_be_visible()
        # Saved lists are upper-cased.
        self.assertIn("SMASH CUT TO:", self.stored("opendraft:smartTypeLists"))
        self.reload()
        self.assertIn("SMASH CUT TO:", self.page.locator("#smarttype-transitions").input_value())

    def test_macro_add_edit_shortcut_persists_and_inserts(self):
        self.settings("#writing")
        macros = self.page.locator("#macros")
        expect(macros.get_by_text(self.L["macroEmpty"])).to_be_visible()
        macros.get_by_role("button", name=self.L["macroAdd"]).click()
        row = macros.locator(".macro-row").first
        row.get_by_label(self.L["name"], exact=True).fill("Continuous")
        row.get_by_label(self.L["macroText"], exact=True).fill("CONTINUOUS")
        capture = row.locator(".shortcut-capture")
        capture.click()
        self.page.keyboard.press("Control+Alt+KeyK")
        self.reload()
        row = self.page.locator("#macros .macro-row").first
        # A filled field's value is part of its label's name, so find them by tag.
        expect(row.locator("input.dialog-input")).to_have_value("Continuous")
        expect(row.locator("textarea")).to_have_value("CONTINUOUS")
        stored = json.loads(self.stored("opendraft:macros"))
        self.assertEqual(len(stored), 1)
        self.assertTrue(stored[0]["shortcut"], stored)
        # The shortcut inserts the text in the editor.
        self.page.go_back()
        self.page.locator(".ProseMirror").wait_for()
        self.page.locator(".ProseMirror").click()
        self.page.keyboard.press("End")
        self.page.keyboard.press("Control+Alt+KeyK")
        expect(self.page.locator(".ProseMirror")).to_contain_text("CONTINUOUS")
        # Remove it again.
        self.page.go_forward()
        expect(self.page.locator(".settings-page")).to_be_visible()
        self.page.locator("#macros").get_by_role("button", name=self.L["remove"]).click()
        expect(self.page.locator("#macros .macro-row")).to_have_count(0)
        self.assertEqual(json.loads(self.stored("opendraft:macros")), [])

    def test_table_read_engine_persists(self):
        self.settings("#writing")
        ai = self.page.get_by_label(self.L["useAi"], exact=True)
        system = self.page.get_by_label(self.L["useSystem"], exact=True)
        ai.check()
        expect(ai).to_be_checked()
        self.reload()
        expect(self.page.get_by_label(self.L["useAi"], exact=True)).to_be_checked()
        self.page.get_by_label(self.L["useSystem"], exact=True).check()
        self.reload()
        expect(self.page.get_by_label(self.L["useSystem"], exact=True)).to_be_checked()

    # ── Print & Export ──

    def test_print_and_word_export_switches_persist(self):
        self.settings("#export")
        pdf = self.checkbox(self.L["viaPdf"])
        word = self.checkbox(self.L["exactHighlights"])
        expect(pdf).to_be_checked()
        expect(word).not_to_be_checked()
        pdf.uncheck()
        word.check()
        self.assertEqual(self.stored("opendraft:printViaPdf"), "0")
        self.assertEqual(self.stored("opendraft:docxExactHighlights"), "1")
        self.reload()
        expect(self.checkbox(self.L["viaPdf"])).not_to_be_checked()
        expect(self.checkbox(self.L["exactHighlights"])).to_be_checked()

    # ── Account & Sharing ──

    def test_signed_out_account_tabs_and_invite_expiry(self):
        self.settings("#account")
        content = self.page.locator(".settings-content")
        expect(content.locator(".settings-auth-tabs")).to_be_visible()
        tabs = content.locator(".settings-auth-tabs")
        tabs.get_by_role("button", name=self.L["createAccount"], exact=True).click()
        expect(content.locator('input[type="password"]')).to_have_count(2)  # password + confirm
        tabs.get_by_role("button", name=self.L["signIn"], exact=True).click()
        expect(content.locator('input[type="password"]')).to_have_count(1)
        # Signed out: no security block and no delete button.
        expect(content.get_by_text(self.L["accountTitle"], exact=True)).to_have_count(0)
        expect(content.get_by_role("button", name=self.L["deleteOpen"])).to_have_count(0)
        expiry = self.page.locator("#settings-invite-expiry")
        for label, hours in [(self.L["expiry7d"], "168"), (self.L["expiry30m"], "0.5")]:
            self.choose(expiry, label)
            self.assertEqual(self.stored("opendraft:defaultInviteExpiry"), hours)
            self.reload()
            expect(self.page.locator("#settings-invite-expiry")).to_contain_text(label)
            # 30 minutes once read back as 0, which still showed as the first option.
            self.assertEqual(self.setting("defaultInviteExpiry"), float(hours))
            expiry = self.page.locator("#settings-invite-expiry")

    def signed_in(self):
        user = dict(USER)
        calls = []

        def handle(route):
            path = urlparse(route.request.url).path.removeprefix("/api/auth")
            calls.append((route.request.method, path))
            if path == "/config":
                return route.fulfill(json={"googleEnabled": False,
                                           "emailVerificationRequired": False,
                                           "smtpConfigured": True})
            if path == "/me":
                return route.fulfill(json=user)
            if path == "/devices":
                device = self.page.evaluate("localStorage.getItem('opendraft:deviceId')")
                return route.fulfill(json={"devices": [
                    {"deviceId": device or "this", "deviceName": "This browser", "platform": "macOS",
                     "userAgent": None, "ipAddress": "127.0.0.1", "trusted": True,
                     "firstSeenAt": "2026-11-01T10:00:00Z", "lastSeenAt": "2026-11-19T10:00:00Z",
                     "current": True},
                    {"deviceId": "other", "deviceName": "Old laptop", "platform": "Windows",
                     "userAgent": None, "ipAddress": None, "trusted": True,
                     "firstSeenAt": "2026-10-01T10:00:00Z", "lastSeenAt": "2026-10-02T10:00:00Z",
                     "current": False},
                ]})
            if path == "/two-factor":
                user["twoFactorEnabled"] = json.loads(route.request.post_data or "{}").get("enabled")
                return route.fulfill(json={"user": user})
            return route.fulfill(status=404, json={"error": "not mocked"})

        # The backend is the dev server's host on port 8008 (127.0.0.1 or localhost).
        self.page.route(re.compile(r"^http://(127\.0\.0\.1|localhost):8008/api/auth/"), handle)
        self.page.evaluate(
            "u => localStorage.setItem('opendraft:collabAuth', JSON.stringify("
            "{accessToken:'test-access', refreshToken:'test-refresh', user:u}))",
            USER,
        )
        return calls

    def test_signed_in_account_security_devices_and_delete_last(self):
        self.L
        calls = self.signed_in()
        self.settings("#account")
        self.reload()  # pick up the stored sign-in
        content = self.page.locator(".settings-content")
        expect(content.get_by_text(USER["displayName"], exact=True)).to_be_visible()
        expect(content.get_by_text(self.L["accountTitle"], exact=True)).to_be_visible()
        # The device list loads by itself when the pane opens.
        expect(content.locator(".settings-device-row")).to_have_count(2)
        expect(content.get_by_text("Old laptop")).to_be_visible()
        expect(content.get_by_role("button", name=self.L["revoke"])).to_have_count(1)
        self.assertIn(("GET", "/devices"), calls)
        # Two-factor switch calls the server and shows the new state.
        twofa = content.locator(".settings-switch input")
        expect(twofa).to_be_enabled()
        twofa.click()  # controlled: it flips once the server answers
        expect(twofa).to_be_checked()
        self.toast("success", self.L["twoFactorOn"])
        expect(content.locator(".settings-switch")).to_contain_text(self.L["on"])
        self.assertIn(("POST", "/two-factor"), calls)
        # Delete account is the last thing in the pane, and needs DELETE typed.
        last = content.locator(".settings-section").last
        open_delete = last.get_by_role("button", name=self.L["deleteOpen"])
        expect(open_delete).to_be_visible()
        open_delete.click()
        confirm = last.get_by_role("button", name=self.L["deleteConfirm"])
        expect(confirm).to_be_disabled()
        last.get_by_placeholder("DELETE").fill("DELETE")
        expect(confirm).to_be_enabled()
        last.get_by_role("button", name=self.L["cancel"]).click()
        expect(confirm).to_have_count(0)
        self.assertNotIn(("DELETE", "/account"), calls)

    # ── Add-ons ──

    def test_addons_pane_appears_and_turns_an_add_on_on(self):
        self.L
        self.page.evaluate("""() => testRegistry.register({id:'settings-fixture-addon',
            name:'Fixture Add-on', version:'1.0', optIn:true,
            description:'A synthetic add-on for the settings test.'})""")
        self.settings()
        self.pane("addons")
        switch = self.page.locator("#addon-toggle-settings-fixture-addon")
        expect(switch).not_to_be_checked()
        switch.click()
        dialog = self.page.locator('[role="dialog"]').last
        expect(dialog).to_be_visible()
        dialog.locator(".dialog-primary").click()
        expect(switch).to_be_checked()
        self.assertIn("settings-fixture-addon", self.stored("opendraft:addons:enabled") or "")
        # Search finds it by name.
        self.page.get_by_role("searchbox").fill("fixture add")
        expect(self.page.locator(".settings-nav-item")).to_have_count(1)
        expect(self.nav("addons")).to_be_visible()

    # ── Advanced ──

    def test_server_addresses_validate_save_and_persist(self):
        self.settings("#advanced")
        collab = self.page.locator("#settings-collab-url")
        collab_section = self.page.locator(".settings-section").filter(has=collab)
        collab.fill("http://not-a-websocket")
        collab_section.get_by_role("button", name=self.L["save"], exact=True).click()
        self.toast("error", self.L["urlInvalid"])
        self.assertIsNone(self.stored("opendraft:collabServerUrl"))
        collab.fill("ws://127.0.0.1:4999")
        collab.press("Enter")
        self.toast("success", self.L["urlSaved"])
        self.assertEqual(self.stored("opendraft:collabServerUrl"), "ws://127.0.0.1:4999")

        cloud = self.page.locator("#settings-cloud-url")
        cloud_section = self.page.locator(".settings-section").filter(has=cloud)
        cloud.fill("ftp://nope")
        cloud_section.get_by_role("button", name=self.L["save"], exact=True).click()
        self.toast("error", self.L["cloudInvalid"])
        cloud.fill("http://127.0.0.1:8008/")
        cloud_section.get_by_role("button", name=self.L["save"], exact=True).click()
        self.toast("success", self.L["cloudSaved"])
        self.assertEqual(self.stored("opendraft:cloudApiUrl"), "http://127.0.0.1:8008")
        self.reload()
        expect(self.page.locator("#settings-collab-url")).to_have_value("ws://127.0.0.1:4999")
        expect(self.page.locator("#settings-cloud-url")).to_have_value("http://127.0.0.1:8008")
        # Clearing the cloud address goes back to the default.
        self.page.locator("#settings-cloud-url").fill("")
        self.page.locator(".settings-section").filter(
            has=self.page.locator("#settings-cloud-url")
        ).get_by_role("button", name=self.L["save"], exact=True).click()
        self.assertIsNone(self.stored("opendraft:cloudApiUrl"))

    # ── narrow window ──

    def test_phone_width_grid_and_no_sideways_scroll(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.settings()
        for p in PANES:
            self.pane(p)
            overflow = self.page.evaluate(
                "document.documentElement.scrollWidth - document.documentElement.clientWidth"
            )
            self.assertLessEqual(overflow, 0, f"{p} scrolls sideways by {overflow}px")
        columns = self.page.evaluate(
            "getComputedStyle(document.querySelector('.settings-nav-list'))"
            ".gridTemplateColumns.split(' ').length"
        )
        self.assertEqual(columns, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
