ARG PARENT_VERSION=3.1.4-node24.19.0
ARG PORT=3000

FROM defradigital/node-development:${PARENT_VERSION} AS development

ARG PARENT_VERSION
ARG PORT

LABEL uk.gov.defra.parent-image=defradigital/node-development:${PARENT_VERSION}

ENV PORT=${PORT}
ENV TZ="Europe/London"

EXPOSE ${PORT} 9229

COPY --chown=node:node package*.json .npmrc ./
RUN npm install --ignore-scripts

COPY --chown=node:node src/ ./src/
COPY --chown=node:node public/ ./public/

RUN npm run build

CMD ["npm", "run", "dev"]

FROM development AS production-build

ENV NODE_ENV=production
RUN npm run build

FROM defradigital/node:${PARENT_VERSION} AS production

ARG PARENT_VERSION
ARG PORT

LABEL uk.gov.defra.parent-image=defradigital/node:${PARENT_VERSION}

ENV NODE_ENV=production
ENV PORT=${PORT}
ENV TZ="Europe/London"

EXPOSE ${PORT}

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:${PORT}/health/ready', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

USER root

COPY --from=production-build --chown=root:root /home/node/package*.json ./
COPY --from=production-build --chown=root:root /home/node/.npmrc ./
COPY --from=production-build --chown=root:root /home/node/src/ ./src/
COPY --from=production-build --chown=root:root /home/node/public/ ./public/

RUN npm ci --ignore-scripts --omit=dev && chmod -R a-w /home/node

USER node

CMD ["node", "src/index.js"]
