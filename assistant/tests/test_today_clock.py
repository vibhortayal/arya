"""Today header clock — review 2026-10-28, M7.

The Today header is a clock: it renders the real current date.
The brain's as_of (the newest data date) appears only under its
own label, "Data through". Before the fix the header printed
as_of AS the date, so a quiet week showed last week's date as
today. Client-source pins, in the house style.
"""
import unittest

from tests.frontend import src


class TestTodayClock(unittest.TestCase):
    def test_header_uses_the_real_date(self):
        js = src("screens/Today.tsx")
        # The weekday and date come from the live clock, not from as_of.
        self.assertIn("const now = new Date();", js)
        self.assertIn("{h ? `${DAYS[now.getDay()]} · ${fmtDate(isoToday())}` : \"\"}", js)
        # The old line built the header date FROM as_of.
        self.assertNotIn("h.as_of ? new Date(", js)
        self.assertNotIn('h.as_of ? fmtDate(h.as_of) : ""', js)

    def test_data_through_is_labeled_as_data(self):
        js = src("screens/Today.tsx")
        self.assertIn('id="today-through"', js)
        self.assertIn("`Data through ${fmtDate(h.as_of)}`", js)


if __name__ == "__main__":
    unittest.main()
