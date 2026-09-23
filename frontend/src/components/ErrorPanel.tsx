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
      <h2>Прогноз не был сформирован</h2>
      <p>
        Не удалось получить результат расчёта. Проверьте сообщение об ошибке
        и повторите обновление. Сохранённые прогнозы остаются доступными.
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
