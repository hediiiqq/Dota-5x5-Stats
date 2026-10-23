# syntax=docker/dockerfile:1
FROM golang:1.27.2-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY cmd/server/ ./cmd/server/
COPY cmd/gc-check/ ./cmd/gc-check/
COPY internal/ ./internal/
ARG TARGETOS=linux
ARG TARGETARCH=amd64
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server && \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/gc-check ./cmd/gc-check

FROM alpine:3.22 AS runtime
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -g 10001 app && adduser -D -u 10001 -G app app \
    && mkdir -p /app /state && chown app:app /state
COPY --from=build --chmod=0555 /out/server /out/gc-check /usr/local/bin/
WORKDIR /app
COPY web/*.html ./web/
COPY web/assets/*.js web/assets/*.css ./web/assets/
USER 10001:10001
ENV GOMEMLIMIT=192MiB GOMAXPROCS=1
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/server"]
