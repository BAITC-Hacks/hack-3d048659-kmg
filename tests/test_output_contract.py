"""Validate the shared forecast contract without requiring model dependencies."""

import csv
import unittest
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path


class OutputContractTest(unittest.TestCase):
    def test_mock_contract(self):
        path = Path(__file__).resolve().parents[1] / "outputs" / "forecasts_mock.csv"
        with path.open(newline="", encoding="utf-8") as stream:
            reader = csv.DictReader(stream)
            self.assertEqual(reader.fieldnames, [
                "turbine_id", "forecast_origin_utc", "weather_run_utc",
                "target_time_utc", "horizon_h", "predicted_power",
                "model_version", "fallback_used",
            ])
            rows = list(reader)
        self.assertEqual(len(rows), 192)
        groups = defaultdict(list)
        for row in rows:
            times = []
            for field in ("forecast_origin_utc", "weather_run_utc", "target_time_utc"):
                self.assertTrue(row[field].endswith("Z"))
                times.append(datetime.fromisoformat(row[field].replace("Z", "+00:00")))
            origin, run, target = times
            horizon = int(row["horizon_h"])
            self.assertEqual(target - origin, timedelta(hours=horizon))
            self.assertLessEqual(run + timedelta(hours=6), origin)
            self.assertEqual((origin + timedelta(hours=5)).hour, 0)
            self.assertGreaterEqual(float(row["predicted_power"]), 0)
            self.assertLessEqual(float(row["predicted_power"]), 1)
            self.assertEqual(row["model_version"], "mock-v0")
            self.assertIn(row["fallback_used"], ("true", "false"))
            groups[row["turbine_id"], row["forecast_origin_utc"]].append(horizon)
        self.assertEqual(len({key[0] for key in groups}), 2)
        self.assertEqual(len({key[1] for key in groups}), 2)
        self.assertEqual(len(groups), 4)
        for horizons in groups.values():
            self.assertEqual(sorted(horizons), list(range(1, 49)))


if __name__ == "__main__":
    unittest.main()
