import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { createDemoObservations, createDemoRun } from "../data/demo";
import {
  loadObservations,
  loadRuns,
  saveObservations,
  saveRuns,
} from "../data/session";
import type { ForecastRun, Horizon, TurbineId } from "../domain/forecast";
import { stamp } from "../lib/format";
import { navigation, readLocation } from "./navigation";
import type { Page, WeatherState } from "./navigation";

export function useForecastWorkspace() {
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
  useEffect(() => saveObservations(observations), [observations]);
  useEffect(() => saveRuns(runs), [runs]);
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

  return {
    runs,
    page,
    turbine,
    horizon,
    hour,
    weatherState,
    demoScenario,
    activeStep,
    notice,
    noticeWarning,
    includeActuals,
    comparisonOpen,
    historyFilter,
    dialogRef,
    replayButtonRef,
    run,
    releases,
    points,
    selected,
    peak,
    previous,
    comparison,
    delta,
    selectedRunHistory,
    running,
    nextIssue,
    turbineObservations,
    url,
    navigate,
    navClick,
    changeTurbine,
    startDemo,
    closeDemo,
    openUpdate,
    chartClick,
    setRunId,
    setHorizon,
    setHour,
    setWeatherState,
    setDemoOpen,
    setDemoScenario,
    setNotice,
    setIncludeActuals,
    setComparisonOpen,
    setHistoryFilter,
  };
}

export type ForecastWorkspace = ReturnType<typeof useForecastWorkspace>;
