FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install dependencies including native build tools required for SQLite
RUN apk add --no-cache python3 make g++ && \
    npm ci && \
    apk del python3 make g++

# Bundle app source
COPY . .

# Expose the port the app runs on
EXPOSE 3001

# Start the application
CMD [ "npm", "start" ]
