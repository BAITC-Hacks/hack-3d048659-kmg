import type { Horizon } from "../domain/forecast";
import { hoursLabel } from "../lib/format";

export default function HorizonControl({
  value,
  onChange,
}: {
  value: Horizon;
  onChange: (v: Horizon) => void;
}) {
  return (
    <div className="segmented horizon" aria-label="Горизонт прогноза">
      {([24, 48] as const).map((h) => (
        <button
          key={h}
          aria-pressed={value === h}
          className={value === h ? "selected" : ""}
          onClick={() => onChange(h)}
        >
          {hoursLabel(h)}
        </button>
      ))}
    </div>
  );
}
