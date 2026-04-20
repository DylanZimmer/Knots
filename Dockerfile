FROM node:22-bookworm

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-tk && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY backend/requirements-render.txt ./backend/requirements-render.txt
RUN pip3 install --no-cache-dir -r backend/requirements-render.txt

COPY . .

ENV NODE_ENV=production
ENV SNAPPY_PYTHON_BIN=python3
ENV PYTHONUNBUFFERED=1

EXPOSE 10000

CMD ["npm", "run", "start:backend"]
