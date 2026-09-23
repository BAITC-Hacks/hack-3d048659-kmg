import pandas as pd
import pytest
from src.data.load import COLUMNS, load_turbine


@pytest.mark.parametrize('encoding,delimiter', [('utf-8-sig', ','), ('cp1251', ';')])
def test_loader_utc_hourly_cutoff(tmp_path, encoding, delimiter):
    frame = pd.DataFrame([
        [1, '2026-01-31 00:00:00', 4, 0.2, 10],
        [2, '2026-01-31 00:10:00', 6, 0.4, 12],
        [3, '2026-02-01 00:00:00', 99, 99, 99],
    ], columns=list(COLUMNS))
    path = tmp_path / 'turbine.csv'
    frame.to_csv(path, index=False, sep=delimiter, encoding=encoding)
    hourly, report = load_turbine(path, 1)
    assert len(hourly) == 1
    assert hourly.time.iloc[0] == pd.Timestamp('2026-01-30T19:00Z')
    assert hourly.power.iloc[0] == pytest.approx(0.3)
    assert hourly.measured_wind.iloc[0] == 5
    assert hourly.available_at_utc.iloc[0] == pd.Timestamp('2026-01-30T20:00Z')
    assert report['raw_rows'] == 2
