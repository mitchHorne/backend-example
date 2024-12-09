FROM node:lts

ARG NPM_TOKEN

RUN mkdir -p /src
WORKDIR /src

COPY package*.json /src/

RUN echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" > .npmrc

RUN npm install

RUN rm -f .npmrc

COPY . /src

EXPOSE 8080
EXPOSE 9229

CMD [ "npm", "start" ]
