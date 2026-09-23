"""UTC join and timezone diagnostics; no future observations become features."""
import pandas as pd
from src.data.load import ROOT, load_all
from src.weather.client import WeatherClient


def join_weather(observations, weather):
    if weather.time.duplicated().any():
        raise ValueError('Duplicate weather timestamps')
    return observations.merge(weather, on='time', how='left', validate='many_to_one')


def wind_correlations(observations, weather):
    shifted = observations[['time', 'turbine_id', 'measured_wind']].copy()
    names = []
    for offset in (-5, 0, 5):
        name = f'weather_shift_{offset:+d}h'
        names.append(name)
        data = weather[['time', 'wind_speed_100m']].copy()
        # Positive offset moves weather timestamps later: value at t is NWP(t-offset).
        data['time'] += pd.Timedelta(hours=offset)
        shifted = shifted.merge(data.rename(columns={'wind_speed_100m': name}), on='time', how='left', validate='many_to_one')
    rows = []
    for turbine_id, group in shifted.groupby('turbine_id'):
        common = group.dropna(subset=['measured_wind', *names])
        for offset, name in zip((-5, 0, 5), names):
            rows.append({'turbine_id': int(turbine_id), 'weather_timestamp_shift_h': offset,
                         'pearson_r': common.measured_wind.corr(common[name]), 'paired_hours': len(common)})
    return pd.DataFrame(rows)


def main():
    observations, _ = load_all()
    weather = WeatherClient().historical()
    joined = join_weather(observations, weather)
    correlations = wind_correlations(observations, weather)
    joined.to_parquet(ROOT / 'outputs/training_frame.parquet', index=False)
    correlations.to_csv(ROOT / 'outputs/wind_correlations.csv', index=False)
    print('Positive shift means weather timestamps move later (NWP at t-shift).')
    print(correlations.to_string(index=False))
    print('Missing joined weather hours:', joined.wind_speed_100m.isna().groupby(joined.turbine_id).sum().to_dict())


if __name__ == '__main__':
    main()
