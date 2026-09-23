import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { fetchWorkspace, recalculateForecast } from "../data/api";
import type { ForecastRun, Horizon, TurbineId, WorkspaceData } from "../domain/forecast";
import { stamp } from "../lib/format";
import { navigation, readLocation } from "./navigation";
import type { Page } from "./navigation";

export function useForecastWorkspace(initialData: WorkspaceData) {
  const [data, setData] = useState(initialData);
  const { runs, observations } = data;
  const initial = useRef(readLocation(initialData.runs)).current;
  const [page, setPage] = useState<Page>(initial.page);
  const [turbine, setTurbine] = useState<TurbineId>(initial.turbine);
  const [runId, setRunId] = useState(initial.runId);
  const [horizon, setHorizon] = useState<Horizon>(initial.horizon);
  const [hour, setHour] = useState(12);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateRun, setUpdateRun] = useState<ForecastRun | null>(null);
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeWarning, setNoticeWarning] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("all");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const replayButtonRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const run = runs.find((item) => item.id === runId && item.turbine === turbine)
    || runs.find((item) => item.turbine === turbine)!;
  const releases = runs.filter((item) => item.turbine === turbine && item.status === "success")
    .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
  const points = run.points.slice(0, horizon);
  const selected = points[Math.min(hour, points.length - 1)];
  const peak = points.reduce((a, b) => a.power > b.power ? a : b);
  const previous = releases.filter((item) => item.issuedAt < run.issuedAt).at(-1);
  const comparison = points.map((point) => ({
    ...point, previous: previous?.points.find((old) => old.time === point.time)?.power,
  })).filter((point) => point.previous !== undefined);
  const delta = comparison.length
    ? comparison.reduce((sum, point) => sum + point.power - point.previous!, 0) / comparison.length : null;
  const selectedRunHistory = runs.filter((item) => item.turbine === turbine
    && (historyFilter === "all" || item.status === historyFilter))
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const turbineObservations = observations.find((batch) => batch.turbine === turbine);

  function url(nextPage = page, nextRun = runId, nextTurbine = turbine) {
    return "/" + nextPage + "?" + new URLSearchParams({ turbine: nextTurbine, run: nextRun, horizon: String(horizon) });
  }
  useEffect(() => { history.replaceState(null, "", url()); }, [page, turbine, runId, horizon]);
  useEffect(() => {
    const handlePop = () => {
      const next = readLocation(runs);
      setPage(next.page); setTurbine(next.turbine); setRunId(next.runId); setHorizon(next.horizon);
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, [runs]);
  useEffect(() => { setHour(12); }, [run.issuedAt]);
  useEffect(() => { setHour((current) => Math.min(current, horizon - 1)); }, [horizon]);
  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    if (updateOpen) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [updateOpen]);
  useEffect(() => {
    document.title = navigation.find((item) => item.id === page)?.label + " · Ветропрогноз";
  }, [page]);

  function navigate(nextPage: Page, nextRun = runId, nextTurbine = turbine) {
    history.pushState(null, "", url(nextPage, nextRun, nextTurbine));
    setPage(nextPage); setRunId(nextRun); setTurbine(nextTurbine);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function navClick(event: MouseEvent<HTMLAnchorElement>, nextPage: Page) {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
      event.preventDefault(); navigate(nextPage);
    }
  }
  function changeTurbine(next: TurbineId) {
    const equivalent = runs.find((item) => item.turbine === next && item.issuedAt === run.issuedAt)
      || runs.filter((item) => item.turbine === next).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];
    if (equivalent) { setTurbine(next); setRunId(equivalent.id); }
  }
  function applyData(next: WorkspaceData) {
    if (!next.runs.length) throw new Error("В архиве пока нет прогнозов. Предыдущие данные остаются на экране.");
    setData(next);
    if (!next.runs.some((item) => item.id === runId && item.turbine === turbine)) {
      const replacement = next.runs.filter((item) => item.turbine === turbine)
        .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];
      setRunId(replacement.id);
    }
  }
  async function refreshData() {
    if (requestRef.current) return;
    const controller = new AbortController(); requestRef.current = controller;
    setRefreshing(true); setNotice("");
    try {
      const next = await fetchWorkspace(controller.signal);
      if (controller.signal.aborted) return;
      applyData(next); setNoticeWarning(false); setNotice("Архив прогнозов и доступные измерения обновлены.");
    } catch (error) {
      if (controller.signal.aborted) return;
      setNoticeWarning(true); setNotice(error instanceof Error ? error.message : "Не удалось обновить данные.");
    } finally {
      requestRef.current = null;
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }
  async function startRecalculation() {
    if (requestRef.current) return;
    const target = updateRun ?? run;
    const controller = new AbortController(); requestRef.current = controller;
    setRunning(true); setRequestError(""); setNotice("");
    try {
      const next = await recalculateForecast(target.issuedAt, controller.signal);
      if (controller.signal.aborted) return;
      applyData(next); setUpdateOpen(false); setNoticeWarning(false);
      setNotice("Прогноз на " + stamp(target.issuedAt) + " UTC пересчитан для обеих турбин и сохранён на сервере.");
      navigate("forecast", target.id, target.turbine); replayButtonRef.current?.focus();
    } catch (error) {
      if (controller.signal.aborted) return;
      setRequestError(error instanceof Error ? error.message : "Не удалось пересчитать прогноз.");
    } finally {
      requestRef.current = null;
      if (!controller.signal.aborted) setRunning(false);
    }
  }
  function closeUpdate() {
    if (running) return;
    setUpdateOpen(false); replayButtonRef.current?.focus();
  }
  function openUpdate() {
    if (requestRef.current) return;
    setUpdateRun(run); setRequestError(""); setUpdateOpen(true);
  }
  const chartClick = (index: unknown) => {
    const parsed = Number(index);
    if (index !== null && index !== undefined && Number.isInteger(parsed))
      setHour(Math.max(0, Math.min(points.length - 1, parsed)));
  };
  return {
    runs, observations, page, turbine, horizon, hour, notice, noticeWarning, requestError, updateRun,
    comparisonOpen, historyFilter, dialogRef, replayButtonRef, run, releases,
    points, selected, peak, previous, comparison, delta, selectedRunHistory,
    running, refreshing, turbineObservations, meta: data.meta,
    url, navigate, navClick, changeTurbine, startRecalculation, closeUpdate,
    openUpdate, refreshData, chartClick, setRunId, setHorizon, setHour,
    setUpdateOpen, setNotice, setComparisonOpen, setHistoryFilter,
  };
}
export type ForecastWorkspace = ReturnType<typeof useForecastWorkspace>;
