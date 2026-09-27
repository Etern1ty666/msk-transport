"""Границы исключения документированного изменения маршрута №7."""
import unittest

import pandas as pd

from app.ml.route_events import disrupted_mask, load


class RouteEventMaskTest(unittest.TestCase):
    def test_july_event_boundaries_and_route(self):
        dates = pd.to_datetime(["2025-07-09", "2025-07-10", "2025-08-10", "2025-08-11"])
        rows = pd.DataFrame([(route, date) for route in (7, 11) for date in dates],
                            columns=["route", "date"])
        self.assertEqual(disrupted_mask(rows).tolist(),
                         [False, True, True, False, False, False, False, False])
        self.assertEqual(len(load()), 1)


if __name__ == "__main__":
    unittest.main()
