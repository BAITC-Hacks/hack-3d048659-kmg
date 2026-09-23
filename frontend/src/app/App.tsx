import { useEffect, useState } from "react";
import { Info, LoaderCircle, RefreshCw, TriangleAlert, Wind, X } from "lucide-react";
import { navigation } from "./navigation";
import { useForecastWorkspace } from "./useForecastWorkspace";
import type { TurbineId, WorkspaceData } from "../domain/forecast";
import { fetchWorkspace } from "../data/api";
import { stamp } from "../lib/format";
import UpdateDialog from "../components/UpdateDialog";
import ForecastPage from "../pages/ForecastPage";
import WeatherPage from "../pages/WeatherPage";
import HistoryPage from "../pages/HistoryPage";

export default function App() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetchWorkspace(controller.signal).then((next) => {
      if (!controller.signal.aborted) setData(next);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось загрузить прогнозы.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  if (data?.runs.length) return <Workspace initialData={data} />;
  return <main className="main-shell" id="main">
    <section className="panel state-panel" role={error ? "alert" : "status"}>
      {loading ? <LoaderCircle className="spin" size={32} /> : error ? <TriangleAlert size={32} /> : <Wind size={32} />}
      <h1>{loading ? "Загружаем прогнозы" : error ? "Сервис прогноза недоступен" : "В архиве пока нет прогнозов"}</h1>
      <p>{loading ? "Получаем сохранённые расчёты, погоду и измерения." : error || "Добавьте результаты расчёта в backend и обновите данные."}</p>
      {!loading && <button className="button primary" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} />Повторить загрузку</button>}
    </section>
  </main>;
}

function Workspace({ initialData }: { initialData: WorkspaceData }) {
  const workspace = useForecastWorkspace(initialData);
  const {
    url,
    navClick,
    page,
    notice,
    noticeWarning,
    setNotice,
    turbine,
    changeTurbine,
    running,
    refreshing,
    run,
    setRunId,
    releases,
    replayButtonRef,
    openUpdate,
  } = workspace;

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
            Архивные прогнозы · ECMWF IFS
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
              disabled={running || refreshing}
            >
              <option value="t1">Турбина 1</option>
              <option value="t2">Турбина 2</option>
            </select>
          </label>
          {page !== "history" && (
            <label className="control-field">
              <span>Выпуск прогноза · UTC</span>
              <select value={run.id} disabled={running || refreshing} onChange={(e) => setRunId(e.target.value)}>
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
          <button className="button" onClick={workspace.refreshData} disabled={running || refreshing}>
            <RefreshCw size={15} className={refreshing ? "spin" : undefined} />
            {refreshing ? "Загружаем…" : "Обновить данные"}
          </button>
          <button
            ref={replayButtonRef}
            className="button primary page-action"
            onClick={openUpdate}
            disabled={running || refreshing}
          >
            <RefreshCw size={15} />
            Пересчитать прогноз
          </button>
        </section>

        {page === "forecast" && (
          <ForecastPage
            run={workspace.run}
            previous={workspace.previous}
            setRunId={workspace.setRunId}
            horizon={workspace.horizon}
            setHorizon={workspace.setHorizon}
            points={workspace.points}
            selected={workspace.selected}
            chartClick={workspace.chartClick}
            hour={workspace.hour}
            setHour={workspace.setHour}
            peak={workspace.peak}
            runs={workspace.runs}
            turbineObservations={workspace.turbineObservations}
            refreshData={workspace.refreshData}
            refreshing={workspace.refreshing || workspace.running}
            comparisonOpen={workspace.comparisonOpen}
            setComparisonOpen={workspace.setComparisonOpen}
            comparison={workspace.comparison}
            delta={workspace.delta}
            url={workspace.url}
            navClick={workspace.navClick}
          />
        )}
        {page === "weather" && (
          <WeatherPage
            run={workspace.run}
            previous={workspace.previous}
            setRunId={workspace.setRunId}
            openUpdate={workspace.openUpdate}
            points={workspace.points}
            horizon={workspace.horizon}
            setHorizon={workspace.setHorizon}
            selected={workspace.selected}
            chartClick={workspace.chartClick}
            hour={workspace.hour}
            setHour={workspace.setHour}
          />
        )}
        {page === "history" && (
          <HistoryPage
            historyFilter={workspace.historyFilter}
            setHistoryFilter={workspace.setHistoryFilter}
            selectedRunHistory={workspace.selectedRunHistory}
            run={workspace.run}
            setHorizon={workspace.setHorizon}
            navigate={workspace.navigate}
          />
        )}
      </main>
      <UpdateDialog
        dialogRef={workspace.dialogRef}
        closeUpdate={workspace.closeUpdate}
        running={workspace.running}
        setUpdateOpen={workspace.setUpdateOpen}
        run={workspace.updateRun ?? workspace.run}
        requestError={workspace.requestError}
        startRecalculation={workspace.startRecalculation}
      />
    </>
  );
}
