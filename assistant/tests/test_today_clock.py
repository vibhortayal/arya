"""Today header clock — review 2026-10-28, M7.

The Today header is a clock: it renders the real current date.
The brain's as_of (the newest data date) appears only under its
own label, "Data through". Before the fix the header printed
as_of AS the date, so a quiet week showed last week's date as
today. Client-source pins, in the house style.
"""
import os, unittest

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")


def read(name):
    with open(os.path.join(PWA, name)) as fh:
        return fh.read()


class TestTodayClock(unittest.TestCase):
    def test_header_uses_the_real_date(self):
        js = read("app.js")
        # The weekday comes from the live clock, not from as_of.
        self.assertIn("days[now.getDay()]", js)
        # The old line built the header date FROM as_of.
        self.assertNotIn("h.as_of ? new Date(", js)
        self.assertNotIn('h.as_of ? fmtDate(h.as_of) : ""', js)

    def test_data_through_is_labeled_as_data(self):
        self.assertIn('id="today-through"', read("index.html"))
        self.assertIn("Data through ${fmtDate(h.as_of)}", read("app.js"))


if __name__ == "__main__":
    unittest.main()
