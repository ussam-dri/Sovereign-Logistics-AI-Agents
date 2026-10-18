FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY org_agent ./org_agent
ENV PYTHONPATH=/app
CMD ["uvicorn", "org_agent.main:app", "--host", "0.0.0.0", "--port", "8020"]
