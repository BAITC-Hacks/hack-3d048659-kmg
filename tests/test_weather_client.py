import json
import pandas as pd
from src.weather.client import WeatherClient, read_config


def test_shared_cache_and_provenance(tmp_path, monkeypatch):
    config = read_config()
    client = WeatherClient(config, tmp_path)
    calls = []

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {'utc_offset_seconds': 0, 'elevation': 555,
                    'hourly_units': {'wind_speed_100m': 'm/s'},
                    'hourly': {'time': ['2026-01-30T12:00'],
                               **{v: [5.0] for v in config['weather_variables']}}}

    def get(url, params, timeout):
        calls.append(params)
        return Response()

    monkeypatch.setattr(client.session, 'get', get)
    first = client.single_run()
    second = client.single_run()
    assert len(calls) == 1
    assert calls[0]['latitude'] == config['weather_point']['lat']
    assert 'elevation' not in calls[0]
    assert calls[0]['wind_speed_unit'] == 'ms'
    pd.testing.assert_frame_equal(first, second)
    metadata = json.loads(next(tmp_path.glob('*.json')).read_text())
    assert metadata['elevation'] == 555
    assert metadata['source_kind'] == 'single_run'
    assert first.weather_run_utc.iloc[0] == pd.Timestamp('2026-01-30T12:00Z')
