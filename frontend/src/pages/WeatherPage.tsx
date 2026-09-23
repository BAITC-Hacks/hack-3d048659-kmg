import {
  ChevronDown,
  Clock3,
  CloudSun,
  LoaderCircle,
  RefreshCw,
  Thermometer,
  TriangleAlert,
  Wind,
  Zap,
} from "lucide-react";
import type { ForecastWorkspace } from "../app/useForecastWorkspace";
import type { WeatherState } from "../app/navigation";
import { number, stamp } from "../lib/format";
import WeatherChart from "../components/charts/WeatherChart";
import ErrorPanel from "../components/ErrorPanel";
import HorizonControl from "../components/HorizonControl";

type WeatherPageProps = Pick<
  ForecastWorkspace,
  | "run"
  | "previous"
  | "setRunId"
  | "weatherState"
  | "setWeatherState"
  | "openUpdate"
  | "points"
  | "horizon"
  | "setHorizon"
  | "selected"
  | "chartClick"
  | "hour"
  | "setHour"
>;

export default function WeatherPage({
  run,
  previous,
  setRunId,
  weatherState,
  setWeatherState,
  openUpdate,
  points,
  horizon,
  setHorizon,
  selected,
  chartClick,
  hour,
  setHour,
}: WeatherPageProps) {
  return (
    <>
      {run.status === "error" ? (
        <ErrorPanel
          onPrevious={() => previous && setRunId(previous.id)}
          hasPrevious={!!previous}
        />
      ) : weatherState === "loading" ? (
        <section className="panel state-panel" role="status">
          <LoaderCircle className="spin" size={32} />
          <h2>Получаем погодный выпуск</h2>
          <p>Демонстрация загрузки локальных данных…</p>
          <div className="skeleton-bar" />
          <div className="skeleton-bar short" />
        </section>
      ) : weatherState === "empty" ? (
        <section className="panel state-panel">
          <CloudSun size={38} />
          <h2>Для этого выпуска нет погодных данных</h2>
          <p>
            Это демонстрационный сценарий. Расчёт без входных данных недоступен.
          </p>
          <button className="button primary" onClick={openUpdate}>
            <RefreshCw size={16} />
            Повторить загрузку
          </button>
        </section>
      ) : (
        <>
          {weatherState === "stale" && (
            <div className="notice warning" role="status">
              <TriangleAlert size={19} />
              <span>
                <strong>Демонстрация: погодный выпуск устарел.</strong> Показаны
                ранее использованные данные. Для нового расчёта нужен свежий
                выпуск.
              </span>
              <button className="button small" onClick={openUpdate}>
                Обновить
              </button>
            </div>
          )}
          <div className="weather-toolbar">
            <div>
              <h2>Погода по часам</h2>
              <p className="muted">
                {stamp(points[0].time)} — {stamp(points.at(-1)!.time)} UTC
              </p>
            </div>
            <HorizonControl value={horizon} onChange={setHorizon} />
          </div>
          <div className="weather-grid">
            <WeatherChart
              points={points}
              kind="wind"
              selected={selected}
              onSelect={chartClick}
            />
            <WeatherChart
              points={points}
              kind="temperature"
              selected={selected}
              onSelect={chartClick}
            />
          </div>
          <section className="panel weather-detail">
            <div>
              <Clock3 size={18} />
              <label htmlFor="weather-hour">
                Выбранный час
                <select
                  id="weather-hour"
                  value={Math.min(hour, points.length - 1)}
                  onChange={(e) => setHour(Number(e.target.value))}
                >
                  {points.map((p, i) => (
                    <option value={i} key={p.time}>
                      {stamp(p.time)} UTC
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="weather-readings" aria-live="polite">
              <span>
                <Wind size={17} />
                <strong>{number(selected.wind, 1)}</strong> м/с
              </span>
              <span>
                <Thermometer size={17} />
                <strong>{number(selected.temperature, 1)}</strong> °C
              </span>
              <span>
                <Zap size={17} />
                <strong>{number(selected.power)}</strong> усл. ед.
              </span>
            </div>
          </section>
        </>
      )}
      <div className="secondary-sections">
        <details className="panel disclosure">
          <summary>
            <span>Источник и время погодных данных</span>
            <ChevronDown size={17} />
          </summary>
          <div className="disclosure-body">
            <dl className="source-grid">
              <div>
                <dt>Источник</dt>
                <dd>Локальный демонабор</dd>
              </div>
              <div>
                <dt>Выпуск погоды · UTC</dt>
                <dd>{stamp(run.weatherIssuedAt)}</dd>
              </div>
              <div>
                <dt>Данные доступны · UTC</dt>
                <dd>{stamp(run.weatherAvailableAt)}</dd>
              </div>
            </dl>
            <p className="source-note">
              Погодные данные доступны до расчёта от {stamp(run.issuedAt)} UTC.
              Значения искусственные.
            </p>
          </div>
        </details>
        <details className="demo-settings">
          <summary>
            Демосценарии
            <ChevronDown size={15} />
          </summary>
          <label className="scenario-control">
            Состояние данных
            <select
              value={weatherState}
              onChange={(e) => setWeatherState(e.target.value as WeatherState)}
            >
              <option value="ready">Доступны</option>
              <option value="loading">Загрузка · демо</option>
              <option value="empty">Нет данных · демо</option>
              <option value="stale">Устарели · демо</option>
            </select>
          </label>
        </details>
      </div>
    </>
  );
}
