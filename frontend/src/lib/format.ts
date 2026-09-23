import type { Horizon, TurbineId } from "../domain/forecast";

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

export const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

export const number = (value: number, digits = 2) =>
  value.toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export const stamp = (time: string) =>
  `${formatDate(time)} · ${formatTime(time)}`;
export const hoursLabel = (value: Horizon) =>
  value === 24 ? "24 часа" : "48 часов";
export const turbineName = (id: TurbineId) =>
  id === "t1" ? "Турбина 1" : "Турбина 2";
