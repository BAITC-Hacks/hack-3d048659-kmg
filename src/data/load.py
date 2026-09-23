"""Load supplied ten-minute observations, using fixed UTC+05 throughout."""
import csv
import io
import json
from datetime import timedelta, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
LOCAL_TZ = timezone(timedelta(hours=5))
HISTORY_END = pd.Timestamp('2026-02-01', tz=LOCAL_TZ).tz_convert('UTC')
COLUMNS = {
    'ID': 'record_id',
    'Статистическое время': 'time',
    'Средняя скорость ветра(m/s)': 'measured_wind',
    'Нормализованная активная мощность': 'power',
    'Средняя температура окружающей среды(°C)': 'measured_temperature',
}
MEASUREMENTS = ['measured_wind', 'power', 'measured_temperature']


def read_raw(path):
    raw = Path(path).read_bytes()
    for encoding in ('utf-8-sig', 'cp1251'):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError(f'Unsupported encoding: {path}')
    delimiter = csv.Sniffer().sniff(text[:65536], delimiters=',;\t|').delimiter
    frame = pd.read_csv(io.StringIO(text), sep=delimiter)
    frame.columns = frame.columns.str.strip()
    missing = set(COLUMNS) - set(frame.columns)
    if missing:
        raise ValueError(f'Missing columns: {missing}')
    frame = frame.rename(columns=COLUMNS)
    frame['time'] = pd.to_datetime(frame['time'], format='mixed', errors='raise')
    frame['time'] = frame['time'].dt.tz_localize(LOCAL_TZ).dt.tz_convert('UTC')
    for name in MEASUREMENTS:
        frame[name] = pd.to_numeric(frame[name].astype('string').str.replace(',', '.', regex=False), errors='raise').astype(float)
    if frame['time'].duplicated().any():
        raise ValueError(f'Duplicate timestamps in {path}')
    return frame.sort_values('time'), {'encoding': encoding, 'delimiter': delimiter}


def load_turbine(path, turbine_id):
    raw, file_info = read_raw(path)
    raw = raw.loc[raw.time < HISTORY_END].copy()
    indexed = raw.set_index('time')
    hourly = indexed[MEASUREMENTS].resample('1h', label='left', closed='left').mean()
    hourly['sample_count'] = indexed['power'].resample('1h').count()
    hourly['turbine_id'] = turbine_id
    hourly['available_at_utc'] = hourly.index + pd.Timedelta(hours=1)
    local_hours = raw.time.dt.tz_convert(LOCAL_TZ).dt.hour
    peak = raw.groupby(local_hours).measured_temperature.mean().idxmax()
    report = {
        'turbine_id': turbine_id, **file_info,
        'columns_dtypes': {name: str(dtype) for name, dtype in raw.dtypes.items()},
        'source_timezone_assumption': 'fixed UTC+05:00 (not inferred)',
        'raw_rows': len(raw), 'hourly_rows': len(hourly),
        'start_utc': raw.time.min().isoformat(), 'end_utc': raw.time.max().isoformat(),
        'modal_step_minutes': raw.time.diff().mode().iloc[0].total_seconds() / 60,
        'missing_raw': raw.isna().sum().to_dict(),
        'missing_hourly': hourly[MEASUREMENTS].isna().sum().to_dict(),
        'partial_hours': int(((hourly.sample_count > 0) & (hourly.sample_count < 6)).sum()),
        'raw_power_min': float(raw.power.min()), 'raw_power_max': float(raw.power.max()),
        'hourly_power_min': float(hourly.power.min()), 'hourly_power_max': float(hourly.power.max()),
        'temperature_peak_hour_local': int(peak),
        'temperature_peak_hour_utc': int((peak - 5) % 24),
    }
    return hourly.reset_index(), report


def load_all(raw_dir=ROOT / 'data/raw'):
    loaded = [load_turbine(Path(raw_dir) / f'turbine_{i}.csv', i) for i in (1, 2)]
    return pd.concat([x[0] for x in loaded], ignore_index=True), [x[1] for x in loaded]


def main():
    hourly, report = load_all()
    output = ROOT / 'outputs'
    output.mkdir(exist_ok=True)
    hourly.to_parquet(output / 'turbines_hourly.parquet', index=False)
    payload = json.dumps(report, indent=2, ensure_ascii=False)
    (output / 'data_profile.json').write_text(payload, encoding='utf-8')
    print(payload)


if __name__ == '__main__':
    main()
