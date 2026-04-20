FROM node:22-bookworm

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-tk python3-venv && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY backend/requirements-render.txt ./backend/requirements-render.txt
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /opt/venv/bin/pip install --no-cache-dir -r backend/requirements-render.txt

COPY . .

ENV NODE_ENV=production
ENV PATH="/opt/venv/bin:${PATH}"
ENV SNAPPY_PYTHON_BIN=/opt/venv/bin/python
ENV PYTHONUNBUFFERED=1

EXPOSE 10000

CMD ["npm", "run", "start:backend"]
