import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CloudSun,
  Database,
  FileClock,
  Info,
  Layers3,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Thermometer,
  TriangleAlert,
  Wind,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  createDemoObservations,
  createDemoRun,
  formatDate,
  formatTime,
  initialRuns,
} from "./data/demo";
import type {
  ForecastPoint,
  ForecastRun,
  Horizon,
  ObservationBatch,
  TurbineId,
} from "./data/demo";
import ActualComparison from "./components/ActualComparison";

type Page = "forecast" | "weather" | "history";
type WeatherState = "ready" | "loading" | "empty" | "stale";
const navigation = [
  { id: "forecast", label: "Прогноз", icon: Activity },
  { id: "weather", label: "Погода", icon: CloudSun },
  { id: "history", label: "История расчётов", icon: FileClock },
] as const;
const stepLabels = [
  "Получение погоды",
  "Подготовка данных",
  "Расчёт прогноза",
  "Проверка результата",
];
const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const number = (v: number, digits = 2) =>
  v.toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const stamp = (time: string) => `${formatDate(time)} · ${formatTime(time)}`;
const hoursLabel = (value: Horizon) => (value === 24 ? "24 часа" : "48 часов");
const turbineName = (id: TurbineId) =>
  id === "t1" ? "Турбина 1" : "Турбина 2";

function loadRuns(): ForecastRun[] {
  try {
    const saved: unknown = JSON.parse(
      sessionStorage.getItem("wind-demo-runs-v1") || "null",
    );
    if (
      Array.isArray(saved) &&
      saved.length &&
      saved.every(
        (r) =>
          r &&
          typeof r.id === "string" &&
          ["t1", "t2"].includes(r.turbine) &&
          ["success", "error"].includes(r.status) &&
          Number.isFinite(Date.parse(r.issuedAt)) &&
          Number.isFinite(Date.parse(r.weatherIssuedAt)) &&
          Number.isFinite(Date.parse(r.weatherAvailableAt)) &&
          Array.isArray(r.points) &&
          r.points.length === 48 &&
          r.points.every(
            (p: ForecastPoint) =>
              Number.isFinite(Date.parse(p.time)) &&
              [p.power, p.wind, p.temperature].every(Number.isFinite),
          ),
      )
    )
      return saved;
  } catch {
    /* Storage is optional; the prototype still works without it. */
  }
  return initialRuns;
}

function loadObservations(): ObservationBatch[] {
  try {
    const saved: unknown = JSON.parse(
      sessionStorage.getItem("wind-demo-observations-v1") || "null",
    );
    if (
      Array.isArray(saved) &&
      saved.every(
        (batch) =>
          batch &&
          ["t1", "t2"].includes(batch.turbine) &&
          Number.isFinite(Date.parse(batch.updatedAt)) &&
          Array.isArray(batch.points) &&
          batch.points.every(
            (point: { time: string; power: number }) =>
              Number.isFinite(Date.parse(point.time)) &&
              point.time < batch.updatedAt &&
              Number.isFinite(point.power) &&
              point.power >= 0 &&
              point.power <= 1,
          ),
      )
    )
      return saved;
  } catch {
    /* Optional tab-local measurements. */
  }
  return [];
}

function readLocation(runs: ForecastRun[]) {
  const params = new URLSearchParams(location.search);
  const turbine: TurbineId = params.get("turbine") === "t2" ? "t2" : "t1";
  const page =
    navigation.find((n) => location.pathname === `/${n.id}`)?.id || "forecast";
  const run =
    runs.find((r) => r.id === params.get("run") && r.turbine === turbine) ||
    runs.find(
      (r) => r.turbine === turbine && r.issuedAt === "2026-02-01T00:00:00.000Z",
    ) ||
    runs.find((r) => r.turbine === turbine)!;
  return {
    page,
    turbine,
    runId: run.id,
    horizon: (params.get("horizon") === "24" ? 24 : 48) as Horizon,
  };
}

function App() {
  const [runs, setRuns] = useState(loadRuns);
  const [observations, setObservations] = useState(loadObservations);
  const initial = useRef(readLocation(runs)).current;
  const [page, setPage] = useState<Page>(initial.page);
  const [turbine, setTurbine] = useState<TurbineId>(initial.turbine);
  const [runId, setRunId] = useState(initial.runId);
  const [horizon, setHorizon] = useState<Horizon>(initial.horizon);
  const [hour, setHour] = useState(12);
  const [weatherState, setWeatherState] = useState<WeatherState>("ready");
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoScenario, setDemoScenario] = useState<"success" | "error">(
    "success",
  );
  const [activeStep, setActiveStep] = useState(-1);
  const [notice, setNotice] = useState("");
  const [noticeWarning, setNoticeWarning] = useState(false);
  const [includeActuals, setIncludeActuals] = useState(true);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("all");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const replayButtonRef = useRef<HTMLButtonElement>(null);
  const run =
    runs.find((r) => r.id === runId) ||
    runs.find((r) => r.turbine === turbine)!;
  const releases = runs
    .filter((r) => r.turbine === turbine && r.status === "success")
    .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
  const points = run.points.slice(0, horizon);
  const selected = points[Math.min(hour, points.length - 1)];
  const peak = points.reduce((a, b) => (a.power > b.power ? a : b));
  const previous = releases.filter((r) => r.issuedAt < run.issuedAt).at(-1);
  const comparison = points
    .map((p) => ({
      ...p,
      previous: previous?.points
        .slice(0, previous.horizon)
        .find((old) => old.time === p.time)?.power,
    }))
    .filter((p) => p.previous !== undefined);
  const delta = comparison.length
    ? comparison.reduce((sum, p) => sum + p.power - p.previous!, 0) /
      comparison.length
    : null;
  const selectedRunHistory = runs
    .filter(
      (r) =>
        r.turbine === turbine &&
        (historyFilter === "all" || r.status === historyFilter),
    )
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const running = activeStep >= 0;
  const latestRun = runs
    .filter((r) => r.turbine === turbine)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];
  const nextIssue = new Date(
    Date.parse(latestRun.issuedAt) + 6 * 60 * 60 * 1000,
  ).toISOString();
  const turbineObservations = observations.find(
    (batch) => batch.turbine === turbine,
  );

  function url(nextPage = page, nextRun = runId) {
    return `/${nextPage}?${new URLSearchParams({ turbine, run: nextRun, horizon: String(horizon) })}`;
  }

  useEffect(() => {
    history.replaceState(null, "", url());
  }, [page, turbine, runId, horizon]);
  useEffect(() => {
    const handlePop = () => {
      const next = readLocation(runs);
      setPage(next.page);
      setTurbine(next.turbine);
      setRunId(next.runId);
      setHorizon(next.horizon);
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, [runs]);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        "wind-demo-observations-v1",
        JSON.stringify(observations),
      );
    } catch {
      /* Optional tab-local measurements. */
    }
  }, [observations]);
  useEffect(() => {
    try {
      sessionStorage.setItem("wind-demo-runs-v1", JSON.stringify(runs));
    } catch {
      /* Optional tab-local history. */
    }
  }, [runs]);
  useEffect(() => {
    setHour(12);
    setWeatherState("ready");
  }, [runId]);
  useEffect(() => {
    setHour((current) => Math.min(current, horizon - 1));
  }, [horizon]);
  useEffect(() => {
    if (weatherState !== "loading") return;
    const timeout = setTimeout(() => setWeatherState("ready"), 2200);
    return () => clearTimeout(timeout);
  }, [weatherState]);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  useEffect(() => {
    if (demoOpen) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [demoOpen]);
  useEffect(() => {
    document.title = `${navigation.find((n) => n.id === page)?.label} · Ветропрогноз`;
  }, [page]);

  function navigate(nextPage: Page, nextRun = runId) {
    history.pushState(null, "", url(nextPage, nextRun));
    setPage(nextPage);
    setRunId(nextRun);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function navClick(event: MouseEvent<HTMLAnchorElement>, nextPage: Page) {
    if (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      event.button === 0
    ) {
      event.preventDefault();
      navigate(nextPage);
    }
  }

  function changeTurbine(next: TurbineId) {
    const equivalent =
      runs.find(
        (r) =>
          r.turbine === next &&
          r.issuedAt === run.issuedAt &&
          r.status === run.status,
      ) ||
      runs.filter((r) => r.turbine === next && r.status === "success").at(-1)!;
    setTurbine(next);
    setRunId(equivalent.id);
  }

  function finishDemo(status: "success" | "error", baseRun: ForecastRun) {
    const created = createDemoRun(baseRun.turbine, baseRun, horizon, status);
    setRuns((current) => [...current, created]);
    setTurbine(baseRun.turbine);
    setActiveStep(-1);
    setDemoOpen(false);
    setNoticeWarning(status === "error");
    setNotice(
      status === "success"
        ? `Демообновление завершено: выпуск ${stamp(created.issuedAt)} UTC сохранён в истории.${includeActuals ? " Новые измерения доступны в сравнении с фактом." : ""}`
        : "Демонстрация сбоя: погода недоступна. Обновление не выполнено; предыдущий прогноз сохранён. Ошибка записана в историю.",
    );
    if (status === "success") {
      if (includeActuals) {
        const batch = createDemoObservations(baseRun.turbine, created.issuedAt);
        setObservations((current) => {
          const old = current.find((item) => item.turbine === batch.turbine);
          const merged = new Map(
            old?.points.map((point) => [point.time, point]),
          );
          batch.points.forEach((point) => merged.set(point.time, point));
          return [
            ...current.filter((item) => item.turbine !== batch.turbine),
            {
              ...batch,
              points: [...merged.values()].sort((a, b) =>
                a.time.localeCompare(b.time),
              ),
            },
          ];
        });
      }
      setWeatherState("ready");
      navigate("forecast", created.id);
    } else {
      if (run.status === "error" && releases.length)
        setRunId(releases.at(-1)!.id);
      if (page === "history") setHistoryFilter("all");
    }
    replayButtonRef.current?.focus();
  }

  function startDemo() {
    setNotice("");
    const baseRun = latestRun;
    setActiveStep(0);
    let step = 0;
    const tick = () => {
      if (demoScenario === "error" || step === 3) {
        finishDemo(demoScenario, baseRun);
        return;
      }
      step += 1;
      setActiveStep(step);
      timerRef.current = setTimeout(tick, 900);
    };
    timerRef.current = setTimeout(tick, 1100);
  }

  function closeDemo() {
    if (running) return;
    setDemoOpen(false);
    replayButtonRef.current?.focus();
  }

  function openUpdate() {
    setDemoScenario("success");
    setDemoOpen(true);
  }

  const chartClick = (index: unknown) => {
    const parsed = Number(index);
    if (index !== null && index !== undefined && Number.isInteger(parsed))
      setHour(Math.max(0, Math.min(points.length - 1, parsed)));
  };
  const timeTick = (iso: string) => formatTime(iso);
  const chartTooltip = <Tooltip content={<DataTooltip />} />;

  return (
    <>
      <a className="skip-link" href="#main">
        К содержимому
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a
            className="brand"
            href={url("forecast")}
            onClick={(e) => navClick(e, "forecast")}
            aria-label="Ветропрогноз, главная"
          >
            <span className="brand-icon">
              <Wind size={25} strokeWidth={1.8} />
            </span>
            <span>
              ветропрогноз<span className="brand-period">.</span>
            </span>
          </a>
          <nav aria-label="Основная навигация">
            {navigation.map((item) => (
              <a
                key={item.id}
                className={`nav-item ${page === item.id ? "active" : ""}`}
                href={url(item.id)}
                onClick={(e) => navClick(e, item.id)}
                aria-current={page === item.id ? "page" : undefined}
              >
                <item.icon size={17} />
                {item.label}
              </a>
            ))}
          </nav>
          <span className="demo-badge">
            <span />
            Демонстрационные данные
          </span>
        </div>
      </header>

      <main id="main" className="main-shell">
        <section
          className={`page-header ${page === "forecast" ? "forecast-heading" : ""}`}
        >
          {page === "forecast" && (
            <img className="page-header-art" src="/wind-hero.png" alt="" />
          )}
          <h1>
            {page === "forecast"
              ? "Прогноз мощности"
              : page === "weather"
                ? "Погодные данные"
                : "История расчётов"}
          </h1>
        </section>

        {notice && (
          <div
            className={`notice ${noticeWarning ? "warning" : ""}`}
            role="status"
          >
            <Info size={18} />
            <span>{notice}</span>
            <button
              className="icon-button"
              aria-label="Закрыть уведомление"
              onClick={() => setNotice("")}
            >
              <X size={17} />
            </button>
          </div>
        )}

        <section className="view-controls" aria-label="Параметры прогноза">
          <label className="control-field">
            <span>Турбина</span>
            <select
              value={turbine}
              onChange={(e) => changeTurbine(e.target.value as TurbineId)}
              disabled={running}
            >
              <option value="t1">Турбина 1</option>
              <option value="t2">Турбина 2</option>
            </select>
          </label>
          {page !== "history" && (
            <label className="control-field">
              <span>Выпуск прогноза · UTC</span>
              <select value={run.id} onChange={(e) => setRunId(e.target.value)}>
                {run.status === "error" && (
                  <option value={run.id}>{stamp(run.issuedAt)} · ошибка</option>
                )}
                {releases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {stamp(r.issuedAt)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            ref={replayButtonRef}
            className="button primary page-action"
            onClick={openUpdate}
            disabled={running}
          >
            <RefreshCw size={15} />
            Обновить данные
          </button>
        </section>

        {page === "forecast" &&
          (run.status === "error" ? (
            <ErrorPanel
              onPrevious={() => previous && setRunId(previous.id)}
              hasPrevious={!!previous}
            />
          ) : (
            <>
              <div className="primary-forecast">
                <section className="panel forecast-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Почасовая мощность</h2>
                    </div>
                    <HorizonControl value={horizon} onChange={setHorizon} />
                  </div>
                  <div className="chart-meta">
                    <span>
                      <span className="legend-dot blue" />
                      Нормализованная мощность
                    </span>
                    <span className="period-label">
                      Период: {stamp(points[0].time)} —{" "}
                      {stamp(points.at(-1)!.time)} UTC
                    </span>
                  </div>
                  <div
                    className="chart-wrap power-chart"
                    aria-label="Почасовой график нормализованной мощности; точные значения доступны в выборе часа и таблице"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={points}
                        margin={{ top: 15, right: 22, left: -24, bottom: 0 }}
                        onClick={(state) =>
                          chartClick(state.activeTooltipIndex)
                        }
                      >
                        <defs>
                          <linearGradient
                            id="powerFill"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="#365ef6"
                              stopOpacity={0.19}
                            />
                            <stop
                              offset="95%"
                              stopColor="#365ef6"
                              stopOpacity={0.015}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 5"
                          vertical={false}
                          stroke="#e9edf5"
                        />
                        <XAxis
                          dataKey="time"
                          tickFormatter={timeTick}
                          minTickGap={35}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: "#65748b", fontSize: 12 }}
                          dy={8}
                        />
                        <YAxis
                          domain={[0, 1]}
                          ticks={[0, 0.25, 0.5, 0.75, 1]}
                          tickFormatter={(n) => nf.format(n)}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: "#65748b", fontSize: 12 }}
                        />
                        {chartTooltip}
                        <ReferenceLine
                          x={selected.time}
                          stroke="#aebdfb"
                          strokeDasharray="4 4"
                        />
                        <Area
                          type="monotone"
                          dataKey="power"
                          name="Нормализованная мощность"
                          stroke="#365ef6"
                          strokeWidth={2.7}
                          fill="url(#powerFill)"
                          isAnimationActive={false}
                          activeDot={{ r: 5, stroke: "#fff", strokeWidth: 3 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="hour-controls">
                    <label htmlFor="hour-range">
                      <Clock3 size={14} />
                      Выбранный час <strong>{stamp(selected.time)}</strong>
                    </label>
                    <input
                      id="hour-range"
                      type="range"
                      min="0"
                      max={points.length - 1}
                      value={Math.min(hour, points.length - 1)}
                      onChange={(e) => setHour(Number(e.target.value))}
                      aria-valuetext={`${stamp(selected.time)}, мощность ${number(selected.power)}`}
                    />
                    <div className="hour-step-buttons">
                      <button
                        className="icon-button"
                        aria-label="Предыдущий час"
                        disabled={hour === 0}
                        onClick={() => setHour((h) => Math.max(0, h - 1))}
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Следующий час"
                        disabled={hour >= points.length - 1}
                        onClick={() =>
                          setHour((h) => Math.min(points.length - 1, h + 1))
                        }
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="selected-metrics" aria-live="polite">
                    <Metric
                      icon={<Zap size={18} />}
                      label="Норм. мощность"
                      value={number(selected.power)}
                      unit="усл. ед."
                    />
                    <Metric
                      icon={<Wind size={18} />}
                      label="Скорость ветра"
                      value={number(selected.wind, 1)}
                      unit="м/с"
                    />
                    <Metric
                      icon={<Thermometer size={18} />}
                      label="Температура"
                      value={number(selected.temperature, 1)}
                      unit="°C"
                    />
                  </div>
                  <p className="forecast-summary">
                    Максимум прогноза —{" "}
                    <strong>{number(peak.power)} усл. ед.</strong>,{" "}
                    {stamp(peak.time)} UTC.
                  </p>
                </section>
              </div>

              <div className="secondary-sections">
                <ActualComparison
                  runs={runs}
                  selectedRun={run}
                  observations={turbineObservations}
                  onUpdate={openUpdate}
                />
                <details className="panel disclosure">
                  <summary>
                    <span>Почасовые значения</span>
                    <span className="disclosure-meta">
                      {hoursLabel(horizon)}
                    </span>
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
                            className={
                              selected.time === p.time ? "highlight-row" : ""
                            }
                          >
                            <th>
                              <button
                                className="table-hour"
                                onClick={() => setHour(i)}
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
                <details
                  className="panel disclosure"
                  open={comparisonOpen}
                  onToggle={(event) =>
                    setComparisonOpen(event.currentTarget.open)
                  }
                >
                  <summary>
                    <span>Сравнить с предыдущим выпуском</span>
                    <ChevronDown size={17} />
                  </summary>
                  {comparisonOpen && (
                    <div className="disclosure-body change-panel">
                      {previous && comparison.length ? (
                        <>
                          <p className="muted">
                            Сравнение с выпуском {stamp(previous.issuedAt)} UTC.
                            <br />
                            Только совпадающие целевые часы: {comparison.length}
                            .
                          </p>
                          <div className="change-summary">
                            <span className="delta-value">
                              {delta! > 0 ? "+" : ""}
                              {number(delta!, 3)}
                            </span>
                            <span>
                              среднее изменение
                              <br />
                              норм. мощности, усл. ед.
                            </span>
                          </div>
                          <div className="comparison-chart">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart
                                data={comparison}
                                margin={{
                                  top: 5,
                                  right: 20,
                                  left: 0,
                                  bottom: 0,
                                }}
                              >
                                <XAxis
                                  dataKey="time"
                                  tickFormatter={timeTick}
                                  minTickGap={50}
                                  tickLine={false}
                                  axisLine={false}
                                  tick={{ fill: "#65748b", fontSize: 12 }}
                                />
                                <Tooltip content={<DataTooltip />} />
                                <Line
                                  type="monotone"
                                  dataKey="previous"
                                  name="Предыдущий выпуск"
                                  stroke="#aab3c6"
                                  strokeDasharray="5 5"
                                  dot={false}
                                  strokeWidth={2}
                                  isAnimationActive={false}
                                />
                                <Line
                                  type="monotone"
                                  dataKey="power"
                                  name="Выбранный выпуск"
                                  stroke="#365ef6"
                                  dot={false}
                                  strokeWidth={2.5}
                                  isAnimationActive={false}
                                />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="comparison-legend">
                            <span>
                              <span className="line-key blue" />
                              Выбранный выпуск
                            </span>
                            <span>
                              <span className="line-key dashed" />
                              Предыдущий
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="empty-inline">
                          <Layers3 size={28} />
                          <p>
                            {previous
                              ? "У этих выпусков нет совпадающих целевых часов."
                              : "Это первый выпуск. Сравнение появится после обновления."}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </details>
                <details className="panel disclosure">
                  <summary>
                    <span>Как получен прогноз</span>
                    <ChevronDown size={17} />
                  </summary>
                  <div className="disclosure-body">
                    <AgentSteps run={run} activeStep={-1} />
                    <div className="agent-bottom">
                      <span>Демонстрация: модель пока не подключена.</span>
                      <a
                        className="text-link"
                        href={url("weather")}
                        onClick={(e) => navClick(e, "weather")}
                      >
                        Источник погодных данных
                        <ArrowRight size={16} />
                      </a>
                    </div>
                  </div>
                </details>
              </div>
            </>
          ))}

        {page === "weather" && (
          <>
            {run.status === "error" ? (
              <ErrorPanel
                onPrevious={() => previous && setRunId(previous.id)}
                hasPrevious={!!previous}
              />
            ) : weatherState === "loading" ? (
              <section className="panel state-panel" role="status">
                <LoaderCircle className="spin" size={32} />
                <h2>Получаем погодный выпуск</h2>
                <p>Демонстрация загрузки локальных данных…</p>
                <div className="skeleton-bar" />
                <div className="skeleton-bar short" />
              </section>
            ) : weatherState === "empty" ? (
              <section className="panel state-panel">
                <CloudSun size={38} />
                <h2>Для этого выпуска нет погодных данных</h2>
                <p>
                  Это демонстрационный сценарий. Расчёт без входных данных
                  недоступен.
                </p>
                <button className="button primary" onClick={openUpdate}>
                  <RefreshCw size={16} />
                  Повторить загрузку
                </button>
              </section>
            ) : (
              <>
                {weatherState === "stale" && (
                  <div className="notice warning" role="status">
                    <TriangleAlert size={19} />
                    <span>
                      <strong>Демонстрация: погодный выпуск устарел.</strong>{" "}
                      Показаны ранее использованные данные. Для нового расчёта
                      нужен свежий выпуск.
                    </span>
                    <button className="button small" onClick={openUpdate}>
                      Обновить
                    </button>
                  </div>
                )}
                <div className="weather-toolbar">
                  <div>
                    <h2>Погода по часам</h2>
                    <p className="muted">
                      {stamp(points[0].time)} — {stamp(points.at(-1)!.time)} UTC
                    </p>
                  </div>
                  <HorizonControl value={horizon} onChange={setHorizon} />
                </div>
                <div className="weather-grid">
                  <WeatherChart
                    points={points}
                    kind="wind"
                    selected={selected}
                    onSelect={chartClick}
                  />
                  <WeatherChart
                    points={points}
                    kind="temperature"
                    selected={selected}
                    onSelect={chartClick}
                  />
                </div>
                <section className="panel weather-detail">
                  <div>
                    <Clock3 size={18} />
                    <label htmlFor="weather-hour">
                      Выбранный час
                      <select
                        id="weather-hour"
                        value={Math.min(hour, points.length - 1)}
                        onChange={(e) => setHour(Number(e.target.value))}
                      >
                        {points.map((p, i) => (
                          <option value={i} key={p.time}>
                            {stamp(p.time)} UTC
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="weather-readings" aria-live="polite">
                    <span>
                      <Wind size={17} />
                      <strong>{number(selected.wind, 1)}</strong> м/с
                    </span>
                    <span>
                      <Thermometer size={17} />
                      <strong>{number(selected.temperature, 1)}</strong> °C
                    </span>
                    <span>
                      <Zap size={17} />
                      <strong>{number(selected.power)}</strong> усл. ед.
                    </span>
                  </div>
                </section>
              </>
            )}
            <div className="secondary-sections">
              <details className="panel disclosure">
                <summary>
                  <span>Источник и время погодных данных</span>
                  <ChevronDown size={17} />
                </summary>
                <div className="disclosure-body">
                  <dl className="source-grid">
                    <div>
                      <dt>Источник</dt>
                      <dd>Локальный демонабор</dd>
                    </div>
                    <div>
                      <dt>Выпуск погоды · UTC</dt>
                      <dd>{stamp(run.weatherIssuedAt)}</dd>
                    </div>
                    <div>
                      <dt>Данные доступны · UTC</dt>
                      <dd>{stamp(run.weatherAvailableAt)}</dd>
                    </div>
                  </dl>
                  <p className="source-note">
                    Погодные данные доступны до расчёта от {stamp(run.issuedAt)}{" "}
                    UTC. Значения искусственные.
                  </p>
                </div>
              </details>
              <details className="demo-settings">
                <summary>
                  Демосценарии
                  <ChevronDown size={15} />
                </summary>
                <label className="scenario-control">
                  Состояние данных
                  <select
                    value={weatherState}
                    onChange={(e) =>
                      setWeatherState(e.target.value as WeatherState)
                    }
                  >
                    <option value="ready">Доступны</option>
                    <option value="loading">Загрузка · демо</option>
                    <option value="empty">Нет данных · демо</option>
                    <option value="stale">Устарели · демо</option>
                  </select>
                </label>
              </details>
            </div>
          </>
        )}

        {page === "history" && (
          <>
            <section className="panel history-panel">
              <div className="history-filters">
                <div className="segmented" aria-label="Фильтр запусков">
                  {[
                    { id: "all", label: "Все" },
                    { id: "success", label: "Готовые" },
                    { id: "error", label: "Ошибки" },
                  ].map((item) => (
                    <button
                      key={item.id}
                      aria-pressed={historyFilter === item.id}
                      className={historyFilter === item.id ? "selected" : ""}
                      onClick={() => setHistoryFilter(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <span className="muted small-text">Сначала новые</span>
              </div>
              <div className="table-scroll">
                <table className="history-table">
                  <caption className="sr-only">
                    История демонстрационных запусков выбранной турбины
                  </caption>
                  <thead>
                    <tr>
                      <th>Дата расчёта · UTC</th>
                      <th>Причина запуска</th>
                      <th>Горизонт</th>
                      <th>Статус</th>
                      <th>
                        <span className="sr-only">Действие</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRunHistory.map((r) => (
                      <tr
                        key={r.id}
                        className={r.id === run.id ? "highlight-row" : ""}
                      >
                        <th>
                          <span className="run-date">
                            {formatDate(r.issuedAt, true)}
                          </span>
                          <span className="run-time">
                            {formatTime(r.issuedAt)}
                          </span>
                        </th>
                        <td>{r.reason}</td>
                        <td className="nowrap">{hoursLabel(r.horizon)}</td>
                        <td>
                          <span
                            className={`status ${r.status === "success" ? "success" : "error"}`}
                          >
                            {r.status === "success" ? (
                              <Check size={13} />
                            ) : (
                              <TriangleAlert size={13} />
                            )}
                            {r.status === "success"
                              ? "Прогноз готов"
                              : "Ошибка погоды"}
                          </span>
                        </td>
                        <td>
                          <button
                            className="icon-button open-run"
                            aria-label={`Открыть расчёт ${stamp(r.issuedAt)}`}
                            onClick={() => {
                              setHorizon(r.horizon);
                              navigate("forecast", r.id);
                            }}
                          >
                            <ArrowUpRight size={19} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!selectedRunHistory.length && (
                  <div className="empty-inline">
                    Запусков с таким статусом пока нет.
                  </div>
                )}
              </div>
              <div className="history-footnote">
                <Info size={15} />
                Новые демонстрационные запуски сохраняются только в текущей
                вкладке браузера.
              </div>
            </section>
          </>
        )}
      </main>

      <dialog
        ref={dialogRef}
        className="demo-dialog"
        aria-labelledby="demo-dialog-title"
        aria-describedby="demo-dialog-description"
        onCancel={(e) => {
          e.preventDefault();
          closeDemo();
        }}
        onClose={() => {
          if (!running) setDemoOpen(false);
        }}
      >
        <div className="dialog-header">
          <span className="soft-icon">
            <Sparkles size={23} />
          </span>
          <button
            className="icon-button"
            aria-label="Закрыть окно"
            disabled={running}
            onClick={closeDemo}
          >
            <X size={20} />
          </button>
        </div>
        <span className="eyebrow">ДЕМОНСТРАЦИОННЫЙ СЦЕНАРИЙ</span>
        <h2 id="demo-dialog-title">Обновить данные и прогноз</h2>
        <p className="muted" id="demo-dialog-description">
          Получим следующий выпуск погоды и пересчитаем прогноз. Предыдущие
          версии останутся в истории.
        </p>
        <div className="update-context">
          <strong>
            {turbineName(turbine)} · {hoursLabel(horizon)}
          </strong>
          <span>Новый расчёт: {stamp(nextIssue)} UTC</span>
          <small>
            Демовремя продвинется на 6 часов. Все данные искусственные.
          </small>
        </div>
        <label className="update-actuals">
          <input
            type="checkbox"
            checked={includeActuals}
            disabled={running}
            onChange={(event) => setIncludeActuals(event.target.checked)}
          />
          <span>
            <strong>Загрузить фактическую выработку</strong>
            <small>
              Демоизмерения прошедших часов для проверки прошлых прогнозов.
            </small>
          </span>
        </label>
        <details className="update-scenarios">
          <summary>
            Сценарий демонстрации <ChevronDown size={15} />
          </summary>
          <fieldset disabled={running} className="scenario-options">
            <legend>Результат запуска</legend>
            <label>
              <input
                type="radio"
                name="scenario"
                checked={demoScenario === "success"}
                onChange={() => setDemoScenario("success")}
              />
              <CheckCheck size={19} />
              <span>
                <strong>Успешный пересчёт</strong>
                <small>Все четыре этапа и новый прогноз</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="scenario"
                checked={demoScenario === "error"}
                onChange={() => setDemoScenario("error")}
              />
              <TriangleAlert size={19} />
              <span>
                <strong>Погода недоступна</strong>
                <small>Остановка на первом этапе</small>
              </span>
            </label>
          </fieldset>
        </details>
        {demoScenario === "error" && (
          <p className="update-error-hint">
            <TriangleAlert size={16} /> Выбран сбой погоды. Данные и прогноз не
            обновятся.
          </p>
        )}
        {running && (
          <div className="demo-progress" role="status">
            <LoaderCircle className="spin" size={20} />
            <span>{stepLabels[activeStep]}…</span>
            <span>{activeStep + 1}/4</span>
          </div>
        )}
        <button
          className="button primary full-width"
          disabled={running}
          onClick={startDemo}
        >
          {running ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <RefreshCw size={16} />
          )}
          {running ? "Обновляем данные…" : "Обновить · демо"}
        </button>
      </dialog>
    </>
  );
}

function HorizonControl({
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

function Metric({
  icon,
  label,
  value,
  unit,
}: {
  icon: React.ReactNode;
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

function DataTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{
    name?: string | number;
    value?: string | number | readonly (string | number)[];
    color?: string;
    dataKey?: string | number | ((...args: never[]) => unknown);
  }>;
  label?: string | number;
}) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="chart-tooltip">
      <strong>{stamp(String(label))} UTC</strong>
      {payload.map((entry, i) => (
        <div key={i}>
          <span
            className="legend-dot"
            style={{ backgroundColor: entry.color }}
          />
          <span>{entry.name}</span>
          <b>
            {typeof entry.value === "number"
              ? number(
                  entry.value,
                  entry.dataKey === "power" || entry.dataKey === "previous"
                    ? 3
                    : 1,
                )
              : entry.value}
            {entry.dataKey === "wind"
              ? " м/с"
              : entry.dataKey === "temperature"
                ? " °C"
                : ""}
          </b>
        </div>
      ))}
    </div>
  );
}

function AgentSteps({
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

function WeatherChart({
  points,
  kind,
  selected,
  onSelect,
}: {
  points: ForecastPoint[];
  kind: "wind" | "temperature";
  selected: ForecastPoint;
  onSelect: (index: unknown) => void;
}) {
  const wind = kind === "wind";
  const color = wind ? "#159e9b" : "#7384c7";
  return (
    <section className="panel weather-chart">
      <div className="weather-chart-title">
        <span className={`soft-icon ${wind ? "teal" : ""}`}>
          {wind ? <Wind size={20} /> : <Thermometer size={20} />}
        </span>
        <div>
          <h2>{wind ? "Скорость ветра" : "Температура"}</h2>
          <span>
            {wind ? "м/с · прогноз на целевой час" : "°C · окружающая среда"}
          </span>
        </div>
      </div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            syncId="weather"
            margin={{ top: 12, right: 22, left: -18, bottom: 0 }}
            onClick={(state) => onSelect(state.activeTooltipIndex)}
          >
            <defs>
              <linearGradient id={`${kind}Fill`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                <stop offset="100%" stopColor={color} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 5"
              vertical={false}
              stroke="#e9edf5"
            />
            <XAxis
              dataKey="time"
              tickFormatter={formatTime}
              minTickGap={40}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#65748b", fontSize: 12 }}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={(n) => nf.format(n)}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#65748b", fontSize: 12 }}
            />
            <Tooltip content={<DataTooltip />} />
            <ReferenceLine
              x={selected.time}
              stroke={color}
              strokeDasharray="3 4"
              opacity={0.6}
            />
            <Area
              type="monotone"
              dataKey={kind}
              name={wind ? "Скорость ветра" : "Температура"}
              stroke={color}
              strokeWidth={2.5}
              fill={`url(#${kind}Fill)`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function ErrorPanel({
  onPrevious,
  hasPrevious,
}: {
  onPrevious: () => void;
  hasPrevious: boolean;
}) {
  return (
    <section className="panel state-panel error-panel" role="alert">
      <span className="soft-icon amber">
        <TriangleAlert size={28} />
      </span>
      <span className="small-demo">ДЕМОНСТРАЦИЯ СБОЯ</span>
      <h2>Прогноз не был сформирован</h2>
      <p>
        Источник погоды недоступен. Агент остановил расчёт на первом этапе.
        <br />
        Данные ошибочного запуска не используются для графиков.
      </p>
      {hasPrevious && (
        <button className="button" onClick={onPrevious}>
          <ChevronLeft size={16} />
          Открыть предыдущий прогноз
        </button>
      )}
    </section>
  );
}

export default App;
