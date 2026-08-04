# syntax=docker/dockerfile:1.7
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

ARG NODE_ARCH
ARG NODE_SHA256
ARG RUNNER_ARCH
ARG RUNNER_SHA256
ARG NODE_VERSION=24.18.0
ARG NPM_VERSION=11.6.2
ARG PLAYWRIGHT_VERSION=1.62.1
ARG RUNNER_VERSION=2.332.0
ARG INSTALL_BROWSERS=1

ENV DEBIAN_FRONTEND=noninteractive \
    ANISH_RELEASE_RUNNER=1 \
    NODE_USE_SYSTEM_CA=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN --mount=type=secret,id=corporate_ca \
  set -eu; \
  if [ -s /run/secrets/corporate_ca ]; then \
    if [ -r /etc/ssl/certs/ca-certificates.crt ]; then cat /etc/ssl/certs/ca-certificates.crt /run/secrets/corporate_ca; else cat /run/secrets/corporate_ca; fi > /tmp/anish-build-ca.pem; \
    export SSL_CERT_FILE=/tmp/anish-build-ca.pem CURL_CA_BUNDLE=/tmp/anish-build-ca.pem; \
    printf '%s\n' 'Acquire::https::CaInfo "/tmp/anish-build-ca.pem";' > /etc/apt/apt.conf.d/99-anish-build-ca; \
  fi; \
  trap 'rm -f /tmp/anish-build-ca.pem /etc/apt/apt.conf.d/99-anish-build-ca' EXIT; \
  apt-get update; \
  apt-get install -y --no-install-recommends ca-certificates curl git jq tar xz-utils tini; \
  rm -rf /var/lib/apt/lists/*

RUN --mount=type=secret,id=corporate_ca \
  set -eu; \
  if [ -s /run/secrets/corporate_ca ]; then \
    if [ -r /etc/ssl/certs/ca-certificates.crt ]; then cat /etc/ssl/certs/ca-certificates.crt /run/secrets/corporate_ca; else cat /run/secrets/corporate_ca; fi > /tmp/anish-build-ca.pem; \
    export SSL_CERT_FILE=/tmp/anish-build-ca.pem CURL_CA_BUNDLE=/tmp/anish-build-ca.pem NODE_EXTRA_CA_CERTS=/tmp/anish-build-ca.pem; \
  fi; \
  trap 'rm -f /tmp/anish-build-ca.pem' EXIT; \
  archive="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"; \
  curl --fail --location --proto '=https' --tlsv1.2 \
    "https://nodejs.org/dist/v${NODE_VERSION}/${archive}" --output "/tmp/${archive}"; \
  echo "${NODE_SHA256}  /tmp/${archive}" | sha256sum --check --strict; \
  tar -xJf "/tmp/${archive}" -C /usr/local --strip-components=1 --no-same-owner; \
  rm "/tmp/${archive}"; \
  npm install --global "npm@${NPM_VERSION}" --ignore-scripts; \
  test "$(node --version)" = "v${NODE_VERSION}"; \
  test "$(npm --version)" = "${NPM_VERSION}"

RUN --mount=type=secret,id=corporate_ca \
  set -eu; \
  if [ -s /run/secrets/corporate_ca ]; then \
    if [ -r /etc/ssl/certs/ca-certificates.crt ]; then cat /etc/ssl/certs/ca-certificates.crt /run/secrets/corporate_ca; else cat /run/secrets/corporate_ca; fi > /tmp/anish-build-ca.pem; \
    export SSL_CERT_FILE=/tmp/anish-build-ca.pem CURL_CA_BUNDLE=/tmp/anish-build-ca.pem; \
    printf '%s\n' 'Acquire::https::CaInfo "/tmp/anish-build-ca.pem";' > /etc/apt/apt.conf.d/99-anish-build-ca; \
  fi; \
  trap 'rm -f /tmp/anish-build-ca.pem /etc/apt/apt.conf.d/99-anish-build-ca' EXIT; \
  mkdir -p /opt/actions-runner; \
  archive="actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"; \
  curl --fail --location --proto '=https' --tlsv1.2 \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${archive}" \
    --output "/tmp/${archive}"; \
  echo "${RUNNER_SHA256}  /tmp/${archive}" | sha256sum --check --strict; \
  tar -xzf "/tmp/${archive}" -C /opt/actions-runner --no-same-owner; \
  rm "/tmp/${archive}"; \
  /opt/actions-runner/bin/installdependencies.sh

RUN --mount=type=secret,id=corporate_ca \
  set -eu; \
  if [ -s /run/secrets/corporate_ca ]; then \
    if [ -r /etc/ssl/certs/ca-certificates.crt ]; then cat /etc/ssl/certs/ca-certificates.crt /run/secrets/corporate_ca; else cat /run/secrets/corporate_ca; fi > /tmp/anish-build-ca.pem; \
    export SSL_CERT_FILE=/tmp/anish-build-ca.pem CURL_CA_BUNDLE=/tmp/anish-build-ca.pem NODE_EXTRA_CA_CERTS=/tmp/anish-build-ca.pem; \
    printf '%s\n' 'Acquire::https::CaInfo "/tmp/anish-build-ca.pem";' > /etc/apt/apt.conf.d/99-anish-build-ca; \
  fi; \
  trap 'rm -f /tmp/anish-build-ca.pem /etc/apt/apt.conf.d/99-anish-build-ca' EXIT; \
  case "$INSTALL_BROWSERS" in 0|1) ;; *) exit 64 ;; esac; \
  if [ "$INSTALL_BROWSERS" = 1 ]; then \
    mkdir -p /tmp/playwright-install /ms-playwright; \
    cd /tmp/playwright-install; \
    npm init --yes; \
    npm install --ignore-scripts --save-exact "@playwright/test@${PLAYWRIGHT_VERSION}"; \
    ./node_modules/.bin/playwright install --with-deps chromium webkit; \
    cd /; \
    rm -rf /tmp/playwright-install; \
    chmod -R a+rX /ms-playwright; \
  fi

RUN useradd --create-home --uid 10001 --shell /bin/bash runner \
  && chown -R runner:runner /opt/actions-runner

COPY --chown=runner:runner entrypoint.sh /opt/anish-runner/entrypoint.sh
COPY --chown=runner:runner job-started-hook.sh /opt/anish-runner/job-started-hook.sh
RUN chmod 0555 /opt/anish-runner/entrypoint.sh /opt/anish-runner/job-started-hook.sh

USER runner
WORKDIR /opt/actions-runner
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/anish-runner/entrypoint.sh"]
