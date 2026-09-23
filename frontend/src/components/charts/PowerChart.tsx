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

interface PowerChartProps {
  points: ForecastPoint[];
  selected: ForecastPoint;
  onSelect: (index: unknown) => void;
}

export default function PowerChart({
  points,
  selected,
  onSelect,
}: PowerChartProps) {
  return (
    <div
      className="chart-wrap power-chart"
      aria-label="Почасовой график нормализованной мощности; точные значения доступны в выборе часа и таблице"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          margin={{ top: 15, right: 22, left: -24, bottom: 0 }}
          onClick={(state) => onSelect(state.activeTooltipIndex)}
        >
          <defs>
            <linearGradient id="powerFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#365ef6" stopOpacity={0.19} />
              <stop offset="95%" stopColor="#365ef6" stopOpacity={0.015} />
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
            minTickGap={35}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#65748b", fontSize: 12 }}
            dy={8}
          />
          <YAxis
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickFormatter={(n) => nf.format(n)}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#65748b", fontSize: 12 }}
          />
          <Tooltip content={<DataTooltip />} />
          <ReferenceLine
            x={selected.time}
            stroke="#aebdfb"
            strokeDasharray="4 4"
          />
          <Area
            type="monotone"
            dataKey="power"
            name="Нормализованная мощность"
            stroke="#365ef6"
            strokeWidth={2.7}
            fill="url(#powerFill)"
            isAnimationActive={false}
            activeDot={{ r: 5, stroke: "#fff", strokeWidth: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
