import { LoaderCircle, RefreshCw, TriangleAlert, X } from "lucide-react";
import type { ForecastWorkspace } from "../app/useForecastWorkspace";
import { stamp } from "../lib/format";

type UpdateDialogProps = Pick<ForecastWorkspace,
  "dialogRef" | "closeUpdate" | "running" | "setUpdateOpen" | "run" | "requestError" | "startRecalculation"
>;

export default function UpdateDialog({
  dialogRef, closeUpdate, running, setUpdateOpen, run, requestError, startRecalculation,
}: UpdateDialogProps) {
  return (
    <dialog ref={dialogRef} className="demo-dialog" aria-labelledby="update-dialog-title"
      aria-describedby="update-dialog-description"
      onCancel={(event) => { event.preventDefault(); closeUpdate(); }}
      onClose={() => { if (!running) setUpdateOpen(false); }}>
      <div className="dialog-header">
        <span className="soft-icon"><RefreshCw size={23} /></span>
        <button className="icon-button" aria-label="Закрыть окно" disabled={running} onClick={closeUpdate}><X size={20} /></button>
      </div>
      <span className="eyebrow">АРХИВНЫЙ РАСЧЁТ</span>
      <h2 id="update-dialog-title">Пересчитать прогноз</h2>
      <p className="muted" id="update-dialog-description">
        Модель пересчитает выбранный выпуск для обеих турбин на 48 часов
        по погоде, доступной на момент этого выпуска.
      </p>
      <div className="update-context">
        <strong>Выпуск: {stamp(run.issuedAt)} UTC</strong>
        <span>Турбины 1 и 2 · 48 часов</span>
        <small>Результат заменит этот выпуск в серверном архиве. Остальные выпуски сохранятся.</small>
      </div>
      <p className="muted">Новые фактические измерения не создаются: доступны только переданные данные за январь.</p>
      {requestError && <div className="notice warning" role="alert"><TriangleAlert size={18} /><span>{requestError}</span></div>}
      {running && <div className="demo-progress" role="status">
        <LoaderCircle className="spin" size={20} /><span>Сервер рассчитывает и проверяет прогноз…</span>
      </div>}
      <button className="button primary full-width" disabled={running} onClick={startRecalculation}>
        {running ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={16} />}
        {running ? "Выполняется расчёт…" : "Пересчитать и сохранить"}
      </button>
    </dialog>
  );
}
