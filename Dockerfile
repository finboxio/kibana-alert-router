FROM node:16-alpine

ENV NODE_ENV=production

WORKDIR /usr/src

ADD package.json package.json
ADD package-lock.json package-lock.json

RUN npm install

ADD index.js /usr/src/index.js
ADD plugins /usr/src/plugins

ENTRYPOINT ["/bin/sh" "-c" "node"]

CMD ["/bin/sh" "-c" "/usr/src/index.js"]
