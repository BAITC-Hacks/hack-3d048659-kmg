# Ветропрогноз — агентный почасовой прогноз выработки ВЭС на 48 часов

Команда хакатона HackAlem AI (кейс KMG). Система строит почасовой прогноз
нормализованной мощности двух ветротурбин на горизонт 1–48 ч только по данным,
которые были доступны в момент прогноза: история измерений и **архивный** прогноз
погоды ECMWF IFS того выпуска, который уже был опубликован.

- Турбина 1: 43.645150, 78.535604; турбина 2: 43.643198, 78.538828 (~340 м, одна ячейка ECMWF).
- Мощность нормализована в `[0, 1]` (не МВт). Внутри системы всё время — UTC;
  исходные файлы в местном времени UTC+05:00.
- Бэктест: 29 запусков прогноза — местная полночь 31.01…28.02.2026
  (`2026-01-30T19:00Z` … `2026-02-27T19:00Z`), 2 турбины × 48 часов.

## Быстрый запуск (для проверяющих)

Всё нужное лежит в репозитории: исходные данные, архив погодных выпусков,
обученные модели. **Сеть и API-ключи для работы не нужны.**

### Вариант 1 — Docker (рекомендуется)

Нужен запущенный Docker Desktop / Docker Engine с Compose v2.

```bash
git clone https://github.com/BAITC-Hacks/hack-3d048659-kmg.git
cd hack-3d048659-kmg
docker compose up --build -d --wait
```

Откройте http://127.0.0.1:8088. Страницы: прогноз, погода, история запусков агента,
3D-карта турбин. Поднимаются два контейнера: `backend`
(Python API прогноза) и `frontend` (React + nginx, проксирует `/api` в backend).
Остановка: `docker compose down`. Подробнее и запуск на сервере — [DEPLOYMENT.md](DEPLOYMENT.md).

### Вариант 2 — без Docker

Нужны Python 3.11 и Node.js ≥ 22.12. Два терминала из корня репозитория.

Терминал 1 — backend (Windows PowerShell):

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m src.api --host 127.0.0.1 --port 8000
```

Linux/macOS: `python3.11 -m venv .venv` и `.venv/bin/python` вместо Windows-путей.
Версии в `requirements.txt` закреплены — они нужны для загрузки сохранённых моделей.

Терминал 2 — frontend:

```bash
cd frontend
npm ci
npm run dev
```

Откройте http://127.0.0.1:5173 (Vite перенаправляет `/api` на порт 8000).

### Вариант 3 — только расчёт, без интерфейса

```powershell
cd backend
.\.venv\Scripts\python.exe -m src.agent.run --backtest --no-llm   # 29 origins -> outputs/forecasts.csv
.\.venv\Scripts\python.exe -m src.agent.run --origin 2026-02-10T19:00Z --no-llm   # один запуск
.\.venv\Scripts\python.exe -m src.eval.backtest_jan              # январский бэктест -> outputs/metrics.json
```

## Проверка

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -p no:cacheprovider -q
cd ..\frontend
npm test
npm run build
```

После `docker compose up` из `frontend/`: `npm run docker:check` — проверка UI, API и данных.

## Что внутри

**Агент** (`backend/src/agent/`), детерминированная оркестрация, режим `--no-llm` по умолчанию:

1. `select_weather_run` — последний выпуск ECMWF (00/06/12/18Z), для которого
   `init + 6 ч ≤ origin` (задержка публикации 6 ч).
2. `fetch_weather` — Open-Meteo Single Runs API, ответ кешируется с метаданными.
3. `prepare_features` → `predict` — модель, выбранная так, чтобы её обучающие данные
   были доступны на момент origin.
4. `validate_forecast` — 48 часов на турбину, значения в [0,1], UTC, `run + 6 ч ≤ origin`.
5. `save_forecast` / `reforecast` — идемпотентная запись и перерасчёт.
6. **Fallback:** выпуск недоступен → предыдущий выпуск → кривая мощности → persistence;
   в результате ставится `fallback_used=true`, каждый шаг пишется в `agent_runs.jsonl`.
   Демонстрация: `python -m src.agent.run --origin 2026-01-31T19:00Z --simulate-missing-run`.

**Модель:** HistGradientBoostingRegressor (loss=`absolute_error`, выбран на декабре 2025)
на прогнозной погоде (ветер 10/100 м, порывы, температура, давление, sin/cos направления),
календарных признаках и `turbine_id`. Базовые линии: эмпирическая кривая мощности
(медиана по бинам 0,5 м/с) и persistence.

**Защита от утечки данных:**
- обучение — только на часах до origin (production-модель до 2026-02-01 00:00 местного,
  отдельная as-of модель для первого origin 31.01);
- тест — только архивные Single Runs, доступные на момент прогноза; фактическая погода
  и сшитый Historical Forecast в тесте не используются;
- проверки встроены в код (`assert_bundle_available`, `validate_forecast`) и покрыты тестами.

## Результаты

- `backend/outputs/forecasts.csv` — 2784 строки (29 origins × 2 турбины × 48 ч).
  Колонки: `turbine_id, forecast_origin_utc, weather_run_utc, target_time_utc, horizon_h,
  predicted_power, model_version, fallback_used`.
- Фактических измерений за февраль в исходных данных нет (ряд заканчивается
  2026-01-31 23:50 местного), поэтому метрики посчитаны на **честном январском бэктесте**
  по тем же правилам: модель обучена до 2026-01-01, origins 01.01–30.01, только архивные
  выпуски погоды (`backend/outputs/metrics.json`, n = 2878).

| Горизонт | Модель MAE / RMSE | Кривая мощности MAE / RMSE | Persistence MAE / RMSE |
|---|---|---|---|
| 1–24 ч | **0.139** / **0.208** | 0.149 / 0.220 | 0.322 / 0.456 |
| 25–48 ч | **0.163** / **0.244** | 0.168 / 0.246 | 0.355 / 0.466 |
| Турбина 1 | **0.149** / **0.223** | 0.157 / 0.231 | 0.340 / 0.462 |
| Турбина 2 | **0.153** / **0.229** | 0.160 / 0.235 | 0.337 / 0.459 |

## API backend

| Метод | Назначение |
|---|---|
| `GET /api/health` | `{"status":"ok"}` |
| `GET /api/workspace` | прогнозы, январские измерения, метаданные |
| `POST /api/forecasts` `{"origin":"2026-02-10T19:00:00Z"}` | пересчёт обеих турбин агентом |

Подробности: [backend/README.md](backend/README.md).

## Структура

| Путь | Содержимое |
|---|---|
| `backend/` | агент, модель, API, тесты, `config.yaml`, данные, погодный кеш, модели и результаты |
| `frontend/` | React/Vite-дашборд, тесты, Dockerfile и nginx ([frontend/README.md](frontend/README.md)) |
| `docker-compose.yml`, `DEPLOYMENT.md` | запуск двух контейнеров |

## Сторонние библиотеки и источники данных

- Python: pandas, numpy, scikit-learn, joblib, threadpoolctl, requests, pyarrow, PyYAML, pytest
  (версии — `backend/requirements.txt`).
- Frontend: React, Vite, TypeScript, Recharts, lucide-react, MapLibre GL JS, three.js,
  шрифт Manrope (@fontsource);
  полный список с версиями — `frontend/package.json`.
- Инфраструктура: Docker, nginx, Node.js, Python.
- Погода: [Open-Meteo Historical Forecast API](https://open-meteo.com/en/docs/historical-forecast-api)
  (обучающий ряд) и [Open-Meteo Single Runs API](https://open-meteo.com/en/docs/single-runs-api)
  (архивные выпуски для прогноза), модель ECMWF IFS (`ecmwf_ifs`).
- Картографическая подложка 3D-карты турбин: © [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors (тайлы tile.openstreetmap.org). Для подложки карты нужен интернет;
  прогноз, API и остальные страницы работают офлайн.
- Измерения турбин: данные организаторов, `backend/data/raw/`.
- При разработке использовались AI-ассистенты для генерации и ревью кода.
