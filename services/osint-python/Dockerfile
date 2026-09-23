FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libxml2-dev libxslt1-dev && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
RUN useradd -m sidecar && chown -R sidecar /app
USER sidecar
EXPOSE 8090
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]
