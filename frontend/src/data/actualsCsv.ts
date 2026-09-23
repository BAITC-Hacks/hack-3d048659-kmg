import type { ActualPoint } from "../domain/forecast";

export function parseActualsCsv(text: string): ActualPoint[] {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const delimiter = lines[0]?.includes(";") ? ";" : ",";
  const cells = (line: string) => line.split(delimiter).map((cell) => cell.trim().replace(/^"(.*)"$/, "$1"));
  const header = cells(lines.shift() ?? "");
  if (header.length !== 2 || header[0] !== "time" || header[1] !== "power")
    throw new Error("Заголовок CSV должен быть time,power (или time;power).");
  if (!lines.length || lines.length > 10000) throw new Error("Загрузите от 1 до 10 000 строк за один раз.");
  const seen = new Set<string>();
  return lines.map((line, index) => {
    const values = cells(line);
    const date = new Date(values[0]);
    if (values.length !== 2 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.0+)?(?:Z|[+-]\d{2}:\d{2})$/.test(values[0])
      || !Number.isFinite(date.getTime()) || date.getUTCMinutes() || date.getUTCSeconds() || date.getUTCMilliseconds())
      throw new Error(`Строка ${index + 2}: укажите целый час с часовым поясом, например 2026-03-01T00:00:00Z.`);
    const power = Number(values[1]);
    if (!values[1] || !Number.isFinite(power) || power < 0 || power > 1)
      throw new Error(`Строка ${index + 2}: мощность должна быть числом от 0 до 1.`);
    const time = date.toISOString();
    if (seen.has(time)) throw new Error(`Строка ${index + 2}: повторяется час измерения.`);
    seen.add(time);
    return { time, power };
  }).sort((a, b) => a.time.localeCompare(b.time));
}
