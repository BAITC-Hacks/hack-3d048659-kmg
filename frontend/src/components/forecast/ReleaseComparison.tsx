import { ChevronDown, Layers3 } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { ForecastPoint, ForecastRun } from "../../domain/forecast";
import { formatTime, number, stamp } from "../../lib/format";
import DataTooltip from "../charts/DataTooltip";

interface ReleaseComparisonProps {
  previous?: ForecastRun;
  comparison: (ForecastPoint & { previous: number | undefined })[];
  delta: number | null;
  comparisonOpen: boolean;
  setComparisonOpen: (open: boolean) => void;
}

export default function ReleaseComparison({
  previous,
  comparison,
  delta,
  comparisonOpen,
  setComparisonOpen,
}: ReleaseComparisonProps) {
  return (
    <details
      className="panel disclosure"
      open={comparisonOpen}
      onToggle={(event) => setComparisonOpen(event.currentTarget.open)}
    >
      <summary>
        <span>Сравнить с предыдущим выпуском</span>
        <ChevronDown size={17} />
      </summary>
      {comparisonOpen && (
        <div className="disclosure-body change-panel">
          {previous && comparison.length ? (
            <>
              <p className="muted">
                Сравнение с выпуском {stamp(previous.issuedAt)} UTC.
                <br />
                Только совпадающие целевые часы: {comparison.length}.
              </p>
              <div className="change-summary">
                <span className="delta-value">
                  {delta! > 0 ? "+" : ""}
                  {number(delta!, 3)}
                </span>
                <span>
                  среднее изменение
                  <br />
                  норм. мощности, усл. ед.
                </span>
              </div>
              <div className="comparison-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={comparison}
                    margin={{
                      top: 5,
                      right: 20,
                      left: 0,
                      bottom: 0,
                    }}
                  >
                    <XAxis
                      dataKey="time"
                      tickFormatter={formatTime}
                      minTickGap={50}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "#65748b", fontSize: 12 }}
                    />
                    <Tooltip content={<DataTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="previous"
                      name="Предыдущий выпуск"
                      stroke="#aab3c6"
                      strokeDasharray="5 5"
                      dot={false}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="power"
                      name="Выбранный выпуск"
                      stroke="#365ef6"
                      dot={false}
                      strokeWidth={2.5}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="comparison-legend">
                <span>
                  <span className="line-key blue" />
                  Выбранный выпуск
                </span>
                <span>
                  <span className="line-key dashed" />
                  Предыдущий
                </span>
              </div>
            </>
          ) : (
            <div className="empty-inline">
              <Layers3 size={28} />
              <p>
                {previous
                  ? "У этих выпусков нет совпадающих целевых часов."
                  : "Это первый выпуск. Сравнение появится после обновления."}
              </p>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
