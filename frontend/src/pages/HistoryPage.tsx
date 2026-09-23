import { ArrowUpRight, Check, Info, TriangleAlert } from "lucide-react";
import type { ForecastWorkspace } from "../app/useForecastWorkspace";
import { formatDate, formatTime, hoursLabel, stamp } from "../lib/format";

type HistoryPageProps = Pick<
  ForecastWorkspace,
  | "historyFilter"
  | "setHistoryFilter"
  | "selectedRunHistory"
  | "run"
  | "setHorizon"
  | "navigate"
>;

export default function HistoryPage({
  historyFilter,
  setHistoryFilter,
  selectedRunHistory,
  run,
  setHorizon,
  navigate,
}: HistoryPageProps) {
  return (
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
              Сохранённые на сервере прогнозы выбранной турбины
            </caption>
            <thead>
              <tr>
                <th>Дата расчёта · UTC</th>
                <th>Метод и модель</th>
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
                  className={r.id === run?.id ? "highlight-row" : ""}
                >
                  <th>
                    <span className="run-date">
                      {formatDate(r.issuedAt, true)}
                    </span>
                    <span className="run-time">{formatTime(r.issuedAt)}</span>
                  </th>
                  <td>
                    {r.reason}
                    <span className="run-time">{r.modelVersion}</span>
                  </td>
                  <td className="nowrap">{hoursLabel(r.horizon)}</td>
                  <td>
                    <span
                      className={`status ${r.status === "success" && !r.fallbackUsed ? "success" : "error"}`}
                    >
                      {r.status === "success" && !r.fallbackUsed ? (
                        <Check size={13} />
                      ) : (
                        <TriangleAlert size={13} />
                      )}
                      {r.status === "success"
                        ? r.fallbackUsed ? "Резервный расчёт" : "Прогноз готов"
                        : "Ошибка расчёта"}
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
          Показаны сохранённые на сервере прогнозы. Ошибки обновления отображаются
          в уведомлении и не создают прогноз.
        </div>
      </section>
    </>
  );
}
