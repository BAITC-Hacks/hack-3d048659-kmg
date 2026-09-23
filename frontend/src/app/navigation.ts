import { Activity, CloudSun, FileClock, Map, Wind } from "lucide-react";
import type { ForecastRun, Horizon, TurbineId, Turbine } from "../domain/forecast";

export type Page = "forecast" | "weather" | "history" | "map" | "turbines";

export const navigation = [
  { id: "forecast", label: "Прогноз", icon: Activity },
  { id: "weather", label: "Погода", icon: CloudSun },
  { id: "map", label: "3D карта", icon: Map },
  { id: "turbines", label: "Ветряки и данные", icon: Wind },
  { id: "history", label: "История расчётов", icon: FileClock },
] as const;

export const stepLabels = [
  "Получение погоды",
  "Подготовка данных",
  "Расчёт прогноза",
  "Проверка результата",
];

export function readLocation(
  runs: ForecastRun[],
  current: Pick<Location, "pathname" | "search"> = window.location,
  turbines: Pick<Turbine, "id">[] = [...new Set(runs.map((run) => run.turbine))].map((id) => ({ id })),
) {
  const params = new URLSearchParams(current.search);
  const turbine: TurbineId = turbines.find((site) => site.id === params.get("turbine"))?.id ?? turbines[0]?.id ?? "";
  const page =
    navigation.find((item) => current.pathname === `/${item.id}`)?.id ||
    "forecast";
  const run =
    runs.find(
      (item) => item.id === params.get("run") && item.turbine === turbine,
    ) ||
    runs
      .filter((item) => item.turbine === turbine)
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];

  return {
    page,
    turbine,
    runId: run?.id ?? "",
    horizon: (params.get("horizon") === "24" ? 24 : 48) as Horizon,
  };
}
