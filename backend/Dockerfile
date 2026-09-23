# syntax=docker/dockerfile:1

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1

WORKDIR /app/backend

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY config.yaml ./
COPY src ./src
COPY data ./data
COPY outputs ./outputs

# Docker initializes the runtime volume with this nonroot ownership.
RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home app \
    && mkdir .runtime \
    && chown app:app .runtime

USER 10001:10001
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3).read()" || exit 1

CMD ["python", "-m", "src.api", "--host", "0.0.0.0", "--port", "8000"]
