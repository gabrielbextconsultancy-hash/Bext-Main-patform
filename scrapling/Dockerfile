# Only the HTTP fetcher is installed, not the browser extras. curl_cffi is what
# provides the TLS impersonation, and it is the whole reason this service exists;
# Camoufox and Playwright would add hundreds of megabytes for a capability the
# Node fetcher already covers.
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir "scrapling[fetchers]==0.4.14"

COPY app.py ./

EXPOSE 8090
CMD ["python", "app.py"]
