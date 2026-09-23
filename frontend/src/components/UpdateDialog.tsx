import {
  CheckCheck,
  ChevronDown,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import type { ForecastWorkspace } from "../app/useForecastWorkspace";
import { stepLabels } from "../app/navigation";
import { hoursLabel, stamp, turbineName } from "../lib/format";

type UpdateDialogProps = Pick<
  ForecastWorkspace,
  | "dialogRef"
  | "closeDemo"
  | "running"
  | "setDemoOpen"
  | "turbine"
  | "horizon"
  | "nextIssue"
  | "includeActuals"
  | "setIncludeActuals"
  | "demoScenario"
  | "setDemoScenario"
  | "activeStep"
  | "startDemo"
>;

export default function UpdateDialog({
  dialogRef,
  closeDemo,
  running,
  setDemoOpen,
  turbine,
  horizon,
  nextIssue,
  includeActuals,
  setIncludeActuals,
  demoScenario,
  setDemoScenario,
  activeStep,
  startDemo,
}: UpdateDialogProps) {
  return (
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
        Получим следующий выпуск погоды и пересчитаем прогноз. Предыдущие версии
        останутся в истории.
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
  );
}
