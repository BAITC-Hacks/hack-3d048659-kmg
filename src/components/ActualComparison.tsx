import { useId, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDate, formatTime } from "../data/demo";
import type { ForecastRun, ObservationBatch } from "../data/demo";
import "./ActualComparison.css";

interface ActualComparisonProps {
  runs: ForecastRun[];
  selectedRun: ForecastRun;
  observations?: ObservationBatch;
  onUpdate: () => void;
}

const stamp = (time: string) => `${formatDate(time)} · ${formatTime(time)}`;
const powerLabel = (value: number) =>
  value.toLocaleString("ru-RU", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
const deltaLabel = (value: number) => {
  const rounded = Number(value.toFixed(3));
  return `${rounded > 0 ? "+" : ""}${powerLabel(rounded === 0 ? 0 : rounded)}`;
};

export function ActualComparison({
  runs,
  selectedRun,
  observations,
  onUpdate,
}: ActualComparisonProps) {
  const selectId = useId();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<{
    sourceRunId: string;
    comparisonRunId: string;
  } | null>(null);
  const availablePoints =
    observations?.turbine === selectedRun.turbine ? observations.points : [];
  const actualByTime = new Map(
    availablePoints.map((point) => [point.time, point.power]),
  );
  const candidates = runs
    .filter(
      (run) => run.turbine === selectedRun.turbine && run.status === "success",
    )
    .sort((a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt));
  const hasOverlap = (run: ForecastRun) =>
    run.points
      .slice(0, run.horizon)
      .some((point) => actualByTime.has(point.time));
  const defaultRun =
    (selectedRun.status === "success" && hasOverlap(selectedRun)
      ? selectedRun
      : candidates.find(hasOverlap)) ?? candidates[0];
  // An explicit comparison choice belongs to the currently viewed forecast.
  // Otherwise derive the default again when new observations become available.
  const comparisonRun =
    (choice?.sourceRunId === selectedRun.id
      ? candidates.find((run) => run.id === choice.comparisonRunId)
      : undefined) ?? defaultRun;
  const rows = (comparisonRun?.points.slice(0, comparisonRun.horizon) ?? [])
    .filter((point) => actualByTime.has(point.time))
    .map((point) => {
      const actual = actualByTime.get(point.time)!;
      return {
        time: point.time,
        forecast: point.power,
        actual,
        delta: actual - point.power,
      };
    });
  const latestPoint = availablePoints.reduce<string | undefined>(
    (latest, point) =>
      !latest || Date.parse(point.time) > Date.parse(latest)
        ? point.time
        : latest,
    undefined,
  );

  return (
    <details
      className="panel disclosure actual-comparison"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>Сравнить с фактической выработкой</span>
        <span className="disclosure-meta">Демо</span>
        <ChevronDown size={17} aria-hidden="true" />
      </summary>
      <div className="disclosure-body actual-comparison-body">
        {!latestPoint ? (
          <div className="actual-empty">
            <p className="muted">Измерения ещё не загружены.</p>
            <button className="button" type="button" onClick={onUpdate}>
              <RefreshCw size={16} aria-hidden="true" />
              Обновить данные
            </button>
          </div>
        ) : (
          <>
            <p className="actual-demo-note">
              Фактическая выработка имитируется; это не измерения ВЭС.
            </p>
            <p className="muted actual-cutoff">
              Данные по {stamp(latestPoint)} UTC включительно.
            </p>
            {comparisonRun ? (
              <>
                <label className="actual-run-control" htmlFor={selectId}>
                  <span>Выпуск для сравнения · UTC</span>
                  <select
                    id={selectId}
                    value={comparisonRun.id}
                    onChange={(event) =>
                      setChoice({
                        sourceRunId: selectedRun.id,
                        comparisonRunId: event.target.value,
                      })
                    }
                  >
                    {candidates.map((run) => (
                      <option key={run.id} value={run.id}>
                        {stamp(run.issuedAt)} · {run.horizon} ч
                      </option>
                    ))}
                  </select>
                </label>
                {rows.length ? (
                  <>
                    <p className="muted actual-chart-description">
                      Нормализованная мощность, усл. ед. Только часы, для
                      которых есть прогноз и демонстрационный факт.
                    </p>
                    {open && (
                      <div
                        className="actual-comparison-chart"
                        role="img"
                        aria-label="Сравнение прогноза и демонстрационного факта по совпадающим часам. Точные значения доступны в таблице ниже."
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart
                            data={rows}
                            margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
                          >
                            <CartesianGrid vertical={false} stroke="#edf0f7" />
                            <XAxis
                              dataKey="time"
                              tickFormatter={formatTime}
                              minTickGap={42}
                              tickLine={false}
                              axisLine={false}
                              tick={{ fill: "#63728a", fontSize: 12 }}
                            />
                            <YAxis
                              domain={[0, 1]}
                              width={34}
                              tickFormatter={(value: number) =>
                                value.toLocaleString("ru-RU")
                              }
                              tickLine={false}
                              axisLine={false}
                              tick={{ fill: "#63728a", fontSize: 12 }}
                            />
                            <Tooltip
                              labelFormatter={(label) =>
                                `${stamp(String(label))} UTC`
                              }
                              formatter={(value) =>
                                typeof value === "number"
                                  ? powerLabel(value)
                                  : String(value)
                              }
                              contentStyle={{
                                borderRadius: 12,
                                border: "1px solid #e9edf4",
                                fontSize: 12,
                              }}
                            />
                            <Line
                              type="monotone"
                              dataKey="forecast"
                              name="Прогноз"
                              stroke="#365ef6"
                              strokeWidth={2.5}
                              dot={rows.length === 1}
                              isAnimationActive={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="actual"
                              name="Демонстрационный факт"
                              stroke="#159e9b"
                              strokeWidth={2.5}
                              dot={rows.length === 1}
                              isAnimationActive={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <div className="actual-legend" aria-hidden="true">
                      <span>
                        <i className="actual-legend-forecast" /> Прогноз
                      </span>
                      <span>
                        <i className="actual-legend-observed" /> Демо-факт
                      </span>
                    </div>
                    <details className="actual-hourly">
                      <summary>
                        <span>Почасовое сравнение</span>
                        <ChevronDown size={16} aria-hidden="true" />
                      </summary>
                      <div
                        className="table-scroll"
                        tabIndex={0}
                        role="region"
                        aria-label="Почасовое сравнение прогноза и демонстрационного факта"
                      >
                        <table>
                          <caption className="sr-only">
                            Нормализованная мощность, условные единицы.
                            Отклонение равно демонстрационному факту минус
                            прогноз.
                          </caption>
                          <thead>
                            <tr>
                              <th scope="col">Час · UTC</th>
                              <th scope="col">Прогноз</th>
                              <th scope="col">Демо-факт</th>
                              <th scope="col">Факт − прогноз</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row) => (
                              <tr key={row.time}>
                                <th scope="row">{stamp(row.time)}</th>
                                <td>{powerLabel(row.forecast)}</td>
                                <td>{powerLabel(row.actual)}</td>
                                <td>{deltaLabel(row.delta)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </>
                ) : (
                  <p className="muted actual-empty">
                    Для часов этого выпуска измерений пока нет.
                  </p>
                )}
              </>
            ) : (
              <p className="muted actual-empty">
                Пока нет успешного выпуска для сравнения.
              </p>
            )}
          </>
        )}
      </div>
    </details>
  );
}

export default ActualComparison;
