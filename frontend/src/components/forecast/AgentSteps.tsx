import {
  Activity,
  Check,
  CheckCheck,
  ChevronDown,
  CloudSun,
  Database,
} from "lucide-react";
import { stepLabels } from "../../app/navigation";
import type { ForecastRun } from "../../domain/forecast";
import { stamp } from "../../lib/format";

export default function AgentSteps({
  run,
  activeStep,
}: {
  run: ForecastRun;
  activeStep: number;
}) {
  const icons = [CloudSun, Database, Activity, CheckCheck];
  const descriptions = [
    `Погодный выпуск ${stamp(run.weatherIssuedAt)} UTC. Доступен ${stamp(run.weatherAvailableAt)} UTC, до момента расчёта. Источник — искусственный локальный набор.`,
    "Подготовлены 48 последовательных почасовых значений ветра и температуры. Время приведено к UTC. Данные относятся к выбранной турбине.",
    "В прототипе используется условная зависимость нормализованной мощности от ветра и температуры. Это демонстрация интерфейса, а не обученная ML-модель.",
    "В демонаборе проверены последовательность часов, числовые значения и время доступности погоды. Качество реальной модели не оценивалось.",
  ];
  const summaries = [
    "Архивный выпуск погоды",
    "Почасовые входные данные",
    "Нормализованная мощность",
    "Временные границы и полнота",
  ];
  return (
    <div className="agent-steps">
      {stepLabels.map((label, i) => {
        const Icon = icons[i];
        return (
          <details
            key={label}
            className={`agent-step ${activeStep === i ? "in-progress" : ""}`}
          >
            <summary>
              <span className="step-top">
                <span className="step-number">0{i + 1}</span>
                <span className="step-check">
                  <Check size={12} />
                </span>
              </span>
              <span className="step-label">
                <Icon size={18} />
                {label}
              </span>
              <span className="step-description">
                {summaries[i]}
                <ChevronDown size={13} />
              </span>
            </summary>
            <p>{descriptions[i]}</p>
          </details>
        );
      })}
    </div>
  );
}
