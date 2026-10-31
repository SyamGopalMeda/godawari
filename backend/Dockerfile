FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt requirements-video.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# Optional video crowd-count verification (adds ~1 GB: torch CPU build + OpenCV). Build with
#   docker compose build --build-arg WITH_VIDEO=1
# For GPU inference run the API outside Docker or use an nvidia/cuda base image (docs/12).
ARG WITH_VIDEO=0
RUN if [ "$WITH_VIDEO" = "1" ]; then pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch && pip install --no-cache-dir -r requirements-video.txt; fi
COPY app ./app
COPY simulators ./simulators
COPY scripts ./scripts
COPY data ./data
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
