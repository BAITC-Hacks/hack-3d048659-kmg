import { LoaderCircle, RefreshCw, TriangleAlert, X } from "lucide-react";
import type { ForecastWorkspace } from "../app/useForecastWorkspace";

type UpdateDialogProps = Pick<ForecastWorkspace,
  "dialogRef" | "closeUpdate" | "running" | "setUpdateOpen" | "run" | "requestError" | "startRecalculation"
>;

export default function UpdateDialog({
  dialogRef, closeUpdate, running, setUpdateOpen, requestError, startRecalculation,
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
      <span className="eyebrow">ОБУЧЕНИЕ МОДЕЛИ</span>
      <h2 id="update-dialog-title">Обучить и рассчитать прогноз</h2>
      <p className="muted" id="update-dialog-description">
        Worker обучит модель выбранного ветряка на последней версии фактических
        измерений и сохранит новый прогноз на 48 часов.
      </p>
      <div className="update-context">
        <strong>Последние сохранённые измерения · 48 часов</strong>
        <small>Предыдущие версии моделей и прогнозов сохраняются. Статус доступен на странице «Ветряки и данные».</small>
      </div>
      <p className="muted">Для первого обучения нужно минимум 120 последовательных почасовых измерений.</p>
      {requestError && <div className="notice warning" role="alert"><TriangleAlert size={18} /><span>{requestError}</span></div>}
      {running && <div className="demo-progress" role="status">
        <LoaderCircle className="spin" size={20} /><span>Сервер рассчитывает и проверяет прогноз…</span>
      </div>}
      <button className="button primary full-width" disabled={running} onClick={startRecalculation}>
        {running ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={16} />}
        {running ? "Отправляем задачу…" : "Запустить обучение"}
      </button>
    </dialog>
  );
}
