import { number, stamp } from "../../lib/format";

export default function DataTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{
    name?: string | number;
    value?: string | number | readonly (string | number)[];
    color?: string;
    dataKey?: string | number | ((...args: never[]) => unknown);
  }>;
  label?: string | number;
}) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="chart-tooltip">
      <strong>{stamp(String(label))} UTC</strong>
      {payload.map((entry, i) => (
        <div key={i}>
          <span
            className="legend-dot"
            style={{ backgroundColor: entry.color }}
          />
          <span>{entry.name}</span>
          <b>
            {typeof entry.value === "number"
              ? number(
                  entry.value,
                  entry.dataKey === "power" || entry.dataKey === "previous"
                    ? 3
                    : 1,
                )
              : entry.value}
            {entry.dataKey === "wind"
              ? " м/с"
              : entry.dataKey === "temperature"
                ? " °C"
                : ""}
          </b>
        </div>
      ))}
    </div>
  );
}
