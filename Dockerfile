FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --production

# Copy source
COPY . .

# Create data directory
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
