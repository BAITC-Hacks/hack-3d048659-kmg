import { Thermometer, Wind } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ForecastPoint } from "../../domain/forecast";
import { formatTime, nf } from "../../lib/format";
import DataTooltip from "./DataTooltip";

export default function WeatherChart({
  points,
  kind,
  selected,
  onSelect,
}: {
  points: ForecastPoint[];
  kind: "wind" | "temperature";
  selected: ForecastPoint;
  onSelect: (index: unknown) => void;
}) {
  const wind = kind === "wind";
  const color = wind ? "#159e9b" : "#7384c7";
  return (
    <section className="panel weather-chart">
      <div className="weather-chart-title">
        <span className={`soft-icon ${wind ? "teal" : ""}`}>
          {wind ? <Wind size={20} /> : <Thermometer size={20} />}
        </span>
        <div>
          <h2>{wind ? "Скорость ветра" : "Температура"}</h2>
          <span>
            {wind ? "м/с · прогноз на целевой час" : "°C · окружающая среда"}
          </span>
        </div>
      </div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            syncId="weather"
            margin={{ top: 12, right: 22, left: -18, bottom: 0 }}
            onClick={(state) => onSelect(state.activeTooltipIndex)}
          >
            <defs>
              <linearGradient id={`${kind}Fill`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                <stop offset="100%" stopColor={color} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 5"
              vertical={false}
              stroke="#e9edf5"
            />
            <XAxis
              dataKey="time"
              tickFormatter={formatTime}
              minTickGap={40}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#65748b", fontSize: 12 }}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={(n) => nf.format(n)}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#65748b", fontSize: 12 }}
            />
            <Tooltip content={<DataTooltip />} />
            <ReferenceLine
              x={selected.time}
              stroke={color}
              strokeDasharray="3 4"
              opacity={0.6}
            />
            <Area
              type="monotone"
              dataKey={kind}
              name={wind ? "Скорость ветра" : "Температура"}
              stroke={color}
              strokeWidth={2.5}
              fill={`url(#${kind}Fill)`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
