import {
  ChevronDown,
  Clock3,
  CloudSun,
  RefreshCw,
  Thermometer,
  TriangleAlert,
  Wind,
  Zap,
} from "lucide-react";
import type { ForecastWorkspace } from "../app/useForecastWorkspace";
import { number, stamp } from "../lib/format";
import WeatherChart from "../components/charts/WeatherChart";
import ErrorPanel from "../components/ErrorPanel";
import HorizonControl from "../components/HorizonControl";

type WeatherPageProps = Pick<
  ForecastWorkspace,
  | "run"
  | "previous"
  | "setRunId"
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
  openUpdate,
  points,
  horizon,
  setHorizon,
  selected,
  chartClick,
  hour,
  setHour,
}: WeatherPageProps) {
  if (!run || !selected) return null;
  const hasWeather = points.some((point) => point.wind !== null || point.temperature !== null);
  const incompleteWeather = points.some((point) => point.wind === null || point.temperature === null);
  const usesWeather = run.method !== "persistence" && run.method !== "autoregressive";

  return (
    <>
      {run.status === "error" ? (
        <ErrorPanel
          onPrevious={() => previous && setRunId(previous.id)}
          hasPrevious={!!previous}
        />
      ) : !hasWeather ? (
        <section className="panel state-panel">
          <CloudSun size={38} />
          <h2>{usesWeather ? "Для этого выпуска нет погодных данных" : "Расчёт выполнен без погоды"}</h2>
          <p>
            {usesWeather
              ? "Прогноз сохранён, но почасовые значения погоды отсутствуют в локальном архиве."
                : "Модель использует историю мощности. Ветер и температура для этого расчёта не использовались."}
          </p>
          <button className="button primary" onClick={openUpdate}>
            <RefreshCw size={16} />
            Новый расчёт
          </button>
        </section>
      ) : (
        <>
          {incompleteWeather && (
            <div className="notice warning" role="status">
              <TriangleAlert size={19} />
              <span>
                Для части часов погодные значения недоступны. Пропуски показаны
                разрывами на графиках и прочерками в таблице.
              </span>
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
            <WeatherChart points={points} kind="wind" selected={selected} onSelect={chartClick} />
            <WeatherChart points={points} kind="temperature" selected={selected} onSelect={chartClick} />
          </div>
          <section className="panel weather-detail">
            <div>
              <Clock3 size={18} />
              <label htmlFor="weather-hour">
                Выбранный час
                <select
                  id="weather-hour"
                  value={Math.min(hour, points.length - 1)}
                  onChange={(event) => setHour(Number(event.target.value))}
                >
                  {points.map((point, index) => (
                    <option value={index} key={point.time}>{stamp(point.time)} UTC</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="weather-readings" aria-live="polite">
              <span><Wind size={17} /><strong>{number(selected.wind, 1)}</strong> м/с</span>
              <span><Thermometer size={17} /><strong>{number(selected.temperature, 1)}</strong> °C</span>
              <span><Zap size={17} /><strong>{number(selected.power)}</strong> усл. ед.</span>
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
              <div><dt>Источник</dt><dd>{usesWeather ? run.weatherSource || "Не указан" : "Погода не использовалась"}</dd></div>
              <div><dt>{usesWeather ? "Выпуск погоды · UTC" : "Кандидат выпуска · UTC"}</dt><dd>{stamp(run.weatherIssuedAt)}</dd></div>
              <div><dt>{usesWeather ? "Данные доступны · UTC" : "Кандидат доступен · UTC"}</dt><dd>{stamp(run.weatherAvailableAt)}</dd></div>
            </dl>
            <p className="source-note">
              {usesWeather
                ? `Архивный погодный выпуск для расчёта от ${stamp(run.issuedAt)} UTC.`
                : "Указан доступный по времени кандидат выпуска. Для резервного расчёта его погодные значения не использовались."}
            </p>
          </div>
        </details>
      </div>
    </>
  );
}
