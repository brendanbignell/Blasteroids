FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY server ./server
COPY shared ./shared
COPY client ./client
ENV PORT=8080 HOST=0.0.0.0 NODE_ENV=production
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "server/index.js"]
