# hack-3d048659-kmg

Почасовой прогноз нормализованной мощности двух турбин на 48 часов.

## Структура проекта

- [`backend/`](backend/README.md) — Python-код прогноза, тесты, конфигурация,
  исходные данные, погодный кеш и сохранённые модели/результаты.
- `src/` — исходники интерфейса React, включая демонстрационные данные.

## Запуск backend

Из корня репозитория перейдите в каталог backend:

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m src.agent.run --backtest
python -m pytest -p no:cacheprovider
```

Все команды Python выполняются из `backend/`. Результаты сохраняются в
`backend/outputs/`, исходные данные и погодный кеш находятся в `backend/data/`.

Подробные инструкции, описание моделей и метрики: [backend/README.md](backend/README.md).
