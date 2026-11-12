# Build stage
# Node 24 ships npm 11, which reads this repo's lockfileVersion-3
# package-lock.json cleanly. npm 10 (node:20-alpine) rejects it as out of sync
# over transitive @emnapi/* optional deps.
FROM node:25-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG CONFIG=production
RUN npm run build -- --configuration=$CONFIG \
 && node tools/render-nginx-conf.mjs $CONFIG > /app/nginx.default.conf

# Production stage
FROM nginx:alpine

# nginx.conf with the Content-Security-Policy's API origin taken from the
# configuration's environment file (tools/render-nginx-conf.mjs).
COPY --from=build /app/nginx.default.conf /etc/nginx/conf.d/default.conf
# A config nginx would refuse fails the image build, not the deploy.
RUN nginx -t

COPY --from=build /app/dist/orthoflow-front/browser/ /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
