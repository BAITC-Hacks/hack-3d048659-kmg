import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Thermometer,
  TriangleAlert,
  Wind,
  Zap,
} from "lucide-react";
import type { ForecastWorkspace } from "../app/useForecastWorkspace";
import { number, stamp } from "../lib/format";
import ActualComparison from "../components/ActualComparison";
import AgentSteps from "../components/forecast/AgentSteps";
import HourlyTable from "../components/forecast/HourlyTable";
import ReleaseComparison from "../components/forecast/ReleaseComparison";
import PowerChart from "../components/charts/PowerChart";
import ErrorPanel from "../components/ErrorPanel";
import HorizonControl from "../components/HorizonControl";
import Metric from "../components/Metric";

type ForecastPageProps = Pick<
  ForecastWorkspace,
  | "run"
  | "previous"
  | "setRunId"
  | "horizon"
  | "setHorizon"
  | "points"
  | "selected"
  | "chartClick"
  | "hour"
  | "setHour"
  | "peak"
  | "runs"
  | "turbineObservations"
  | "refreshData"
  | "refreshing"
  | "comparisonOpen"
  | "setComparisonOpen"
  | "comparison"
  | "delta"
  | "url"
  | "navClick"
>;

export default function ForecastPage({
  run,
  previous,
  setRunId,
  horizon,
  setHorizon,
  points,
  selected,
  chartClick,
  hour,
  setHour,
  peak,
  runs,
  turbineObservations,
  refreshData,
  refreshing,
  comparisonOpen,
  setComparisonOpen,
  comparison,
  delta,
  url,
  navClick,
}: ForecastPageProps) {
  return run.status === "error" ? (
    <ErrorPanel
      onPrevious={() => previous && setRunId(previous.id)}
      hasPrevious={!!previous}
    />
  ) : (
    <>
      {run.fallbackUsed && (
        <div className="notice warning" role="status">
          <TriangleAlert size={19} />
          <span>
            <strong>Использован резервный расчёт.</strong>{" "}
            {run.method === "persistence"
              ? "Прогноз сохраняет последнее доступное значение мощности; погодные данные не использовались."
              : run.method === "power_curve"
                ? "Мощность рассчитана по кривой турбины."
                : "Модель использовала более ранний доступный выпуск погоды."}
          </span>
        </div>
      )}
      <div className="primary-forecast">
        <section className="panel forecast-panel">
          <div className="panel-heading">
            <div>
              <h2>Почасовая мощность</h2>
            </div>
            <HorizonControl value={horizon} onChange={setHorizon} />
          </div>
          <div className="chart-meta">
            <span>
              <span className="legend-dot blue" />
              Нормализованная мощность
            </span>
            <span className="period-label">
              Период: {stamp(points[0].time)} — {stamp(points.at(-1)!.time)} UTC
            </span>
          </div>
          <PowerChart
            points={points}
            selected={selected}
            onSelect={chartClick}
          />
          <div className="hour-controls">
            <label htmlFor="hour-range">
              <Clock3 size={14} />
              Выбранный час <strong>{stamp(selected.time)}</strong>
            </label>
            <input
              id="hour-range"
              type="range"
              min="0"
              max={points.length - 1}
              value={Math.min(hour, points.length - 1)}
              onChange={(e) => setHour(Number(e.target.value))}
              aria-valuetext={`${stamp(selected.time)}, мощность ${number(selected.power)}`}
            />
            <div className="hour-step-buttons">
              <button
                className="icon-button"
                aria-label="Предыдущий час"
                disabled={hour === 0}
                onClick={() => setHour((h) => Math.max(0, h - 1))}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="Следующий час"
                disabled={hour >= points.length - 1}
                onClick={() =>
                  setHour((h) => Math.min(points.length - 1, h + 1))
                }
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          <div className="selected-metrics" aria-live="polite">
            <Metric
              icon={<Zap size={18} />}
              label="Норм. мощность"
              value={number(selected.power)}
              unit="усл. ед."
            />
            <Metric
              icon={<Wind size={18} />}
              label="Скорость ветра"
              value={number(selected.wind, 1)}
              unit="м/с"
            />
            <Metric
              icon={<Thermometer size={18} />}
              label="Температура"
              value={number(selected.temperature, 1)}
              unit="°C"
            />
          </div>
          <p className="forecast-summary">
            Максимум прогноза — <strong>{number(peak.power)} усл. ед.</strong>,{" "}
            {stamp(peak.time)} UTC.
          </p>
        </section>
      </div>

      <div className="secondary-sections">
        <ActualComparison
          runs={runs}
          selectedRun={run}
          observations={turbineObservations}
          onUpdate={refreshData}
          refreshing={refreshing}
        />
        <HourlyTable
          points={points}
          selected={selected}
          horizon={horizon}
          onSelect={setHour}
        />
        <ReleaseComparison
          previous={previous}
          comparison={comparison}
          delta={delta}
          comparisonOpen={comparisonOpen}
          setComparisonOpen={setComparisonOpen}
        />
        <details className="panel disclosure">
          <summary>
            <span>Как получен прогноз</span>
            <ChevronDown size={17} />
          </summary>
          <div className="disclosure-body">
            <AgentSteps run={run} />
            <div className="agent-bottom">
              <span>Модель: {run.modelVersion}. Расчёт на архивных данных.</span>
              <a
                className="text-link"
                href={url("weather")}
                onClick={(e) => navClick(e, "weather")}
              >
                Источник погодных данных
                <ArrowRight size={16} />
              </a>
            </div>
          </div>
        </details>
      </div>
    </>
  );
}
