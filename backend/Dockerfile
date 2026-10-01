FROM python:3.11-slim-bookworm

WORKDIR /app

# curl: health check. openjdk: JPype/JDBC para el sync con Informix.
RUN apt-get update && apt-get install -y --no-install-recommends curl openjdk-17-jre-headless \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 appuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY drivers ./drivers
USER appuser

EXPOSE 8000
# 1 worker: el sync de Informix corre dentro del proceso (no debe duplicarse)
# y con poca CPU varios workers se matan al arrancar. --proxy-headers: detras del ALB.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header"]
