FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    DATASET_DIR=/dataset DATA_DIR=/app/data
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
# кэш артефактов: агрегаты 10 ГБ сырых данных, погода, OSM — сервис стартует без сети и без сырых CSV
COPY data/raw_hourly.parquet data/weather_raw.json data/osm_tram.json data/ml_compare.json data/depots.json data/paymix.json /app/data/
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s CMD curl -fs http://localhost:8000/api/health || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--loop", "uvloop", "--http", "httptools", "--no-access-log"]
