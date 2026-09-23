import json
import pandas as pd
from src.data.load import ROOT
from src.model.train import selected_recipe


def test_recipe_was_selected_only_on_december_mae():
    report = json.loads((ROOT / 'outputs/december_experiment.json').read_text())
    assert report['january_used_for_selection'] is False
    assert pd.Timestamp(report['validation_end_exclusive_utc']) == pd.Timestamp('2025-12-31T19:00Z')
    assert pd.Timestamp(report['train_before_utc']) == pd.Timestamp('2025-11-30T19:00Z')
    candidates = ['hgb_current', 'hgb_absolute_error', 'blend_50_50']
    winner = min(candidates, key=lambda name: report['pooled'][name]['mae'])
    expected = winner if report['pooled'][winner]['mae'] < report['pooled']['power_curve']['mae'] else 'hgb_current'
    assert report['selected'] == expected
    assert selected_recipe() == report['recipe']
