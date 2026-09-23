import type { ReactNode } from "react";

export default function Metric({
  icon,
  label,
  value,
  unit,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="metric">
      <div className="metric-label">
        {icon}
        <span>{label}</span>
      </div>
      <div className="metric-value">
        {value}
        <small>{unit}</small>
      </div>
    </div>
  );
}
