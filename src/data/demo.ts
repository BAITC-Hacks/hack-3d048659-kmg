// Искусственные демонстрационные данные: это не измерения ВЭС и не реальный прогноз погоды.

export type TurbineId = "t1" | "t2";
export type Horizon = 24 | 48;

export interface ForecastPoint {
  time: string;
  power: number;
  wind: number;
  temperature: number;
}

export interface ActualPoint {
  time: string;
  power: number;
}

export interface ObservationBatch {
  turbine: TurbineId;
  updatedAt: string;
  points: ActualPoint[];
}

export interface ForecastRun {
  id: string;
  turbine: TurbineId;
  issuedAt: string;
  weatherIssuedAt: string;
  weatherAvailableAt: string;
  horizon: Horizon;
  status: "success" | "error";
  reason: string;
  points: ForecastPoint[];
}

const HOUR = 60 * 60 * 1000;
const DEMO_EPOCH = Date.UTC(2026, 0, 1);

const round = (value: number, digits = 2): number =>
  Number(value.toFixed(digits));

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function createDemoObservations(
  turbine: TurbineId,
  availableAt: string,
): ObservationBatch {
  const availableTimestamp = Date.parse(availableAt);
  if (!Number.isFinite(availableTimestamp)) {
    throw new RangeError(
      "Некорректное время обновления демонстрационных данных",
    );
  }
  // Искусственный «факт»: час считается доступным лишь через час после его начала.
  const lastTimestamp = Math.floor(availableTimestamp / HOUR) * HOUR - HOUR;
  const turbineOffset = turbine === "t2" ? 0.45 : 0;

  return {
    turbine,
    updatedAt: new Date(availableTimestamp).toISOString(),
    points: Array.from({ length: 96 }, (_, index) => {
      const timestamp = lastTimestamp - (95 - index) * HOUR;
      const targetHour = (timestamp - DEMO_EPOCH) / HOUR;
      // Значение зависит только от турбины и целевого часа, а не от выпуска прогноза.
      // Это синтетическая кривая для показа обновления факта, не реальные измерения ВЭС.
      const wind = clamp(
        8.2 +
          Math.sin(targetHour / 8.5) * 2.2 +
          Math.cos(targetHour / 3.8) * 0.95 +
          Math.sin(targetHour / 31) * 0.8 +
          turbineOffset +
          Math.sin(targetHour * 0.77 + turbineOffset) * 0.35 +
          Math.cos(targetHour / 5.4 + turbineOffset) * 0.22,
        2.2,
        15.4,
      );
      const temperature =
        -8.5 +
        Math.sin(((targetHour - 8) * Math.PI) / 12) * 3.4 +
        Math.cos(targetHour / 36) * 1.8 -
        turbineOffset;
      const windFraction = clamp((wind - 3) / 9, 0, 1);
      const temperatureFactor = 1 + (-temperature - 5) * 0.002;
      const turbineFactor = turbine === "t1" ? 0.98 : 0.95;
      const power = clamp(
        Math.pow(windFraction, 1.7) * temperatureFactor * turbineFactor +
          Math.sin(targetHour * 1.31 + turbineOffset) * 0.018,
        0,
        1,
      );

      return {
        time: new Date(timestamp).toISOString(),
        power: round(power, 3),
      };
    }),
  };
}

function buildPoints(turbine: TurbineId, issuedAt: string): ForecastPoint[] {
  const issuedTimestamp = Date.parse(issuedAt);
  const issueHour = (issuedTimestamp - DEMO_EPOCH) / HOUR;
  const turbineOffset = turbine === "t2" ? 0.45 : 0;
  // Погода зависит от целевого часа; поправка выпуска меняет перекрывающиеся прогнозы.
  const runCorrection = Math.sin(issueHour * 0.29) * 0.72;

  return Array.from({ length: 48 }, (_, index) => {
    const targetTimestamp = issuedTimestamp + (index + 1) * HOUR;
    const targetHour = (targetTimestamp - DEMO_EPOCH) / HOUR;
    const wind = clamp(
      8.2 +
        Math.sin(targetHour / 8.5) * 2.2 +
        Math.cos(targetHour / 3.8) * 0.95 +
        Math.sin(targetHour / 31) * 0.8 +
        turbineOffset +
        runCorrection * (0.8 + index / 96),
      2.2,
      15.4,
    );
    const temperature =
      -8.5 +
      Math.sin(((targetHour - 8) * Math.PI) / 12) * 3.4 +
      Math.cos(targetHour / 36) * 1.8 -
      turbineOffset -
      runCorrection * 0.4;
    // Условная кривая мощности нужна только для согласованности демонстрационного графика.
    const windFraction = clamp((wind - 3) / 9, 0, 1);
    const temperatureFactor = 1 + (-temperature - 5) * 0.002;
    const turbineFactor = turbine === "t1" ? 0.98 : 0.95;
    const power = clamp(
      Math.pow(windFraction, 1.7) * temperatureFactor * turbineFactor,
      0,
      1,
    );

    return {
      time: new Date(targetTimestamp).toISOString(),
      power: round(power, 3),
      wind: round(wind),
      temperature: round(temperature, 1),
    };
  });
}

function buildRun(
  turbine: TurbineId,
  issuedAt: string,
  horizon: Horizon,
  status: ForecastRun["status"],
  reason: string,
  idSuffix = "",
): ForecastRun {
  const issuedTimestamp = Date.parse(issuedAt);
  // Условный погодный выпуск каждые 6 часов, с доступностью через 2 часа.
  const weatherTimestamp =
    Math.floor((issuedTimestamp - 3 * HOUR) / (6 * HOUR)) * 6 * HOUR;

  return {
    id: `${turbine}-${issuedTimestamp}${idSuffix}`,
    turbine,
    issuedAt: new Date(issuedTimestamp).toISOString(),
    weatherIssuedAt: new Date(weatherTimestamp).toISOString(),
    weatherAvailableAt: new Date(weatherTimestamp + 2 * HOUR).toISOString(),
    horizon,
    status,
    reason,
    points: buildPoints(turbine, issuedAt),
  };
}

const initialIssues: {
  issuedAt: string;
  status: ForecastRun["status"];
  reason: string;
}[] = [
  {
    issuedAt: "2026-01-31T00:00:00.000Z",
    status: "success",
    reason: "Плановый расчёт по расписанию",
  },
  {
    issuedAt: "2026-01-31T06:00:00.000Z",
    status: "success",
    reason: "Обновился доступный выпуск прогноза погоды",
  },
  {
    issuedAt: "2026-01-31T12:00:00.000Z",
    status: "error",
    reason: "Демонстрация сбоя: источник погоды временно недоступен",
  },
  {
    issuedAt: "2026-02-01T00:00:00.000Z",
    status: "success",
    reason: "Плановый расчёт по расписанию",
  },
  {
    issuedAt: "2026-02-02T00:00:00.000Z",
    status: "success",
    reason: "Плановый расчёт по расписанию",
  },
];

export const initialRuns: ForecastRun[] = (["t1", "t2"] as const).flatMap(
  (turbine) =>
    initialIssues.map(({ issuedAt, status, reason }) =>
      buildRun(turbine, issuedAt, 48, status, reason),
    ),
);

let demoRunSequence = 0;

export function createDemoRun(
  turbine: TurbineId,
  previousRun: ForecastRun,
  horizon: Horizon,
  status: ForecastRun["status"],
): ForecastRun {
  const issuedAt = new Date(
    Date.parse(previousRun.issuedAt) + 6 * HOUR,
  ).toISOString();
  demoRunSequence += 1;

  return buildRun(
    turbine,
    issuedAt,
    horizon,
    status,
    status === "success"
      ? "Обновление прогноза по новому выпуску погоды"
      : "Демонстрация сбоя: источник погоды временно недоступен",
    `-demo-${Date.now()}-${demoRunSequence}`,
  );
}

export function formatDate(iso: string, withYear = false): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(iso));
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(iso));
}
