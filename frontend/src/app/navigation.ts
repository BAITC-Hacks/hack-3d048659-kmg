import { Activity, CloudSun, FileClock, Map } from "lucide-react";
import type { ForecastRun, Horizon, TurbineId } from "../domain/forecast";

export type Page = "forecast" | "weather" | "history" | "map";

export const navigation = [
  { id: "forecast", label: "Прогноз", icon: Activity },
  { id: "weather", label: "Погода", icon: CloudSun },
  { id: "map", label: "3D карта", icon: Map },
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
) {
  const params = new URLSearchParams(current.search);
  const turbine: TurbineId = params.get("turbine") === "t2" ? "t2" : "t1";
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
