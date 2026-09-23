from pathlib import Path
import yaml


def test_config():
    config = yaml.safe_load((Path(__file__).resolve().parents[1] / 'config.yaml').read_text())
    assert len(config['turbines']) == 2
    assert {t['turbine_id'] for t in config['turbines']} == {1, 2}
    for turbine in config['turbines']:
        assert set(turbine) == {'turbine_id', 'lat', 'lon'}
        assert isinstance(turbine['lat'], (int, float))
        assert isinstance(turbine['lon'], (int, float))
    assert config['utc_offset'] == '+05:00'
    assert config['availability_delay_hours'] == 6
    assert config['horizon_hours'] == 48
    assert len(config['weather_variables']) == 6
