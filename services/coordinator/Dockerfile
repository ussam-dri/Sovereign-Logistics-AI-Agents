FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY coordinator_app ./coordinator_app
ENV PYTHONPATH=/app
CMD ["uvicorn", "coordinator_app.main:app", "--host", "0.0.0.0", "--port", "8000"]
