import { ChevronLeft, TriangleAlert } from "lucide-react";

export default function ErrorPanel({
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
