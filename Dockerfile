FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN chown -R node:node /app
USER node
EXPOSE 5000
CMD ["node", "src/server.js"]
