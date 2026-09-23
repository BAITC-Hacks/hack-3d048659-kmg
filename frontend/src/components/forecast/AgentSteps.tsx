import { Activity, ChevronDown, CloudSun, Database, FileCheck } from "lucide-react";
import type { ForecastRun } from "../../domain/forecast";
import { stamp } from "../../lib/format";

export default function AgentSteps({ run }: { run: ForecastRun }) {
  const hasWeather = run.points.some(
    (point) => point.wind !== null || point.temperature !== null,
  );
  const steps = [
    {
      label: "Погодные данные",
      icon: CloudSun,
      summary: ["persistence", "autoregressive"].includes(run.method) ? "Погода не использовалась" : "Архивный выпуск",
      description: ["persistence", "autoregressive"].includes(run.method)
        ? "Расчёт использует историю измеренной мощности. Ветер и температура не входят в этот прогноз."
        : `Источник: ${run.weatherSource || "не указан"}. Выпуск ${stamp(run.weatherIssuedAt)} UTC, доступен ${stamp(run.weatherAvailableAt)} UTC. ${hasWeather ? "Почасовые значения представлены на странице погоды." : "Почасовые значения этого выпуска отсутствуют в локальном архиве."}`,
    },
    {
      label: "Период расчёта",
      icon: Database,
      summary: `${run.points.length} почасовых значений`,
      description: `Прогноз от ${stamp(run.issuedAt)} UTC. Целевые часы: ${stamp(run.points[0]?.time)} — ${stamp(run.points.at(-1)?.time)} UTC. Мощность нормализована от 0 до 1.`,
    },
    {
      label: "Метод прогноза",
      icon: Activity,
      summary: run.method === "persistence"
        ? "Последняя известная мощность"
        : run.method === "power_curve" ? "Кривая мощности" : "Обученная модель",
      description: `Версия модели: ${run.modelVersion}. ${run.fallbackUsed ? "Сервер отметил применение резервного расчёта." : "Сервер выполнил основной расчёт без резервного метода."}`,
    },
    {
      label: "Сохранённый результат",
      icon: FileCheck,
      summary: "Прогноз доступен в истории",
      description: "Здесь показаны сведения из сохранённого результата API. Точность можно оценить в сравнении с фактической выработкой только для часов с доступными измерениями.",
    },
  ];

  return (
    <div className="agent-steps">
      {steps.map(({ label, icon: Icon, summary, description }, index) => (
        <details key={label} className="agent-step">
          <summary>
            <span className="step-top">
              <span className="step-number">0{index + 1}</span>
            </span>
            <span className="step-label">
              <Icon size={18} />
              {label}
            </span>
            <span className="step-description">
              {summary}
              <ChevronDown size={13} />
            </span>
          </summary>
          <p>{description}</p>
        </details>
      ))}
    </div>
  );
}
