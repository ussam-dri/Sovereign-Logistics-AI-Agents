FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY guard_app ./guard_app
COPY policies ./policies
ENV PYTHONPATH=/app
CMD ["uvicorn", "guard_app.main:app", "--host", "0.0.0.0", "--port", "8010"]
