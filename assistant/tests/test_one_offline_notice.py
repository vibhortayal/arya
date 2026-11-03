"""Owner, 2026-11-02 (iPhone, airplane mode): a list showed two offline
notices at once ("double notifications"). Offline, only the app-wide bar
shows, and it counts list changes waiting to sync; the yellow note on
Lists shows only once back online, while they sync."""
import os
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")


def src(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


class OneOfflineNotice(unittest.TestCase):
    def test_list_note_hides_offline(self):
        s = src("web/src/app/listSync.tsx")
        self.assertIn("if (s.demo || !pending || !online) return null;", s)
        self.assertNotIn('"lists.queue.offline"', s)
        self.assertNotIn('"offline": "You\'re offline. You can still add, tick, edit and remove items.',
                         src("web/src/i18n/en.json"))

    def test_app_bar_counts_waiting(self):
        a = src("web/src/App.tsx")
        self.assertIn('t(slow ? "offline.slowBar" : "offline.bar")}{pending ? " " + t("lists.queue.waiting", { count: pending }) : ""}', a)

    def test_help_and_ask_say_so(self):
        self.assertIn("The offline note at the top counts the changes waiting", src("web/src/i18n/en.json"))
        self.assertIn("one note, not two", src("prompts/arya_features.md"))


if __name__ == "__main__":
    unittest.main()
