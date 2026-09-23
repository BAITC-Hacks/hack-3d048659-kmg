import { ChevronDown } from "lucide-react";
import type { ForecastPoint, Horizon } from "../../domain/forecast";
import { hoursLabel, number, stamp } from "../../lib/format";

interface HourlyTableProps {
  points: ForecastPoint[];
  selected: ForecastPoint;
  horizon: Horizon;
  onSelect: (hour: number) => void;
}

export default function HourlyTable({
  points,
  selected,
  horizon,
  onSelect,
}: HourlyTableProps) {
  return (
    <details className="panel disclosure">
      <summary>
        <span>Почасовые значения</span>
        <span className="disclosure-meta">{hoursLabel(horizon)}</span>
        <ChevronDown size={17} />
      </summary>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">
            Демонстрационный почасовой прогноз, время UTC
          </caption>
          <thead>
            <tr>
              <th>Целевой час · UTC</th>
              <th>Норм. мощность, усл. ед.</th>
              <th>Ветер, м/с</th>
              <th>Температура, °C</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr
                key={p.time}
                className={selected.time === p.time ? "highlight-row" : ""}
              >
                <th>
                  <button
                    className="table-hour"
                    onClick={() => onSelect(i)}
                    aria-pressed={selected.time === p.time}
                  >
                    {stamp(p.time)}
                  </button>
                </th>
                <td>{number(p.power, 3)}</td>
                <td>{number(p.wind, 1)}</td>
                <td>{number(p.temperature, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
