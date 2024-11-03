FROM node:16-alpine

ENV NODE_ENV=production

WORKDIR /usr/src

ADD package.json package.json
ADD package-lock.json package-lock.json

RUN npm install

ADD index.js /usr/src/index.js
ADD plugins /usr/src/plugins

CMD ["node", "/usr/src/index.js"]
