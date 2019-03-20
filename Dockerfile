# A docker image for the func container.

# default variant is the official alpine node image (much smaller than the standard image)
FROM node:11

ARG NODE_ENV
ENV NODE_ENV $NODE_ENV

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY package.json /usr/src/app/
RUN npm install && npm cache clean --force
COPY server.js /usr/src/app/server.js

CMD [ "node", "server.js" ]

EXPOSE 8888