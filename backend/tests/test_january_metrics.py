import json
import numpy as np
import pandas as pd
import pytest
from src.data.load import ROOT, HISTORY_END
from src.eval.backtest_jan import JAN_START


def test_january_metrics_reconcile_with_saved_rows():
    metrics = json.loads((ROOT / 'outputs/metrics.json').read_text())
    rows = pd.read_csv(ROOT / 'outputs/jan_evaluation_rows.csv')
    assert metrics['weather_source'] == 'single_runs'
    assert len(rows) == metrics['n'] == 2878
    for turbine, group in rows.groupby('turbine_id'):
        for method in ('model', 'power_curve', 'persistence'):
            error = group[method] - group.actual_power
            expected = metrics['per_turbine'][str(turbine)][method]
            assert np.abs(error).mean() == pytest.approx(expected['mae'], abs=1e-8)
            assert np.sqrt((error ** 2).mean()) == pytest.approx(expected['rmse'], abs=1e-8)
    training = json.loads((ROOT / 'outputs/jan_model_metadata.json').read_text())
    assert pd.Timestamp(training['train_last_available_at_utc']) <= JAN_START
    assert pd.Timestamp(training['train_last_target_utc']) < JAN_START
    targets = pd.to_datetime(rows.target_time_utc, utc=True)
    assert (targets >= JAN_START).all() and (targets < HISTORY_END).all()


def test_ui_actuals_are_unique_january_observations():
    actuals = pd.read_csv(ROOT / 'outputs/actuals_jan.csv')
    assert list(actuals) == ['turbine_id', 'target_time_utc', 'actual_power']
    assert not actuals.duplicated(['turbine_id', 'target_time_utc']).any()
    assert not actuals.isna().any().any()
    times = pd.to_datetime(actuals.target_time_utc, utc=True)
    assert (times >= JAN_START).all() and (times < HISTORY_END).all()
