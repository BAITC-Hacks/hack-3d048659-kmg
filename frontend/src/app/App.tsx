import { Info, RefreshCw, Wind, X } from "lucide-react";
import { navigation } from "./navigation";
import { useForecastWorkspace } from "./useForecastWorkspace";
import type { TurbineId } from "../domain/forecast";
import { stamp } from "../lib/format";
import UpdateDialog from "../components/UpdateDialog";
import ForecastPage from "../pages/ForecastPage";
import WeatherPage from "../pages/WeatherPage";
import HistoryPage from "../pages/HistoryPage";

export default function App() {
  const workspace = useForecastWorkspace();
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
            openUpdate={workspace.openUpdate}
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
            weatherState={workspace.weatherState}
            setWeatherState={workspace.setWeatherState}
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
        closeDemo={workspace.closeDemo}
        running={workspace.running}
        setDemoOpen={workspace.setDemoOpen}
        turbine={workspace.turbine}
        horizon={workspace.horizon}
        nextIssue={workspace.nextIssue}
        includeActuals={workspace.includeActuals}
        setIncludeActuals={workspace.setIncludeActuals}
        demoScenario={workspace.demoScenario}
        setDemoScenario={workspace.setDemoScenario}
        activeStep={workspace.activeStep}
        startDemo={workspace.startDemo}
      />
    </>
  );
}
