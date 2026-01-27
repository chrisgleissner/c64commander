FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_VERSION=20 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy apt packages list
COPY apt-packages.txt /tmp/apt-packages.txt

# Install required APT packages
RUN set -eux; \
    apt-get update; \
    if [ -s /tmp/apt-packages.txt ]; then \
      xargs -a /tmp/apt-packages.txt apt-get install -y --no-install-recommends; \
    fi; \
    rm -rf /var/lib/apt/lists/* /tmp/apt-packages.txt

# Ensure bash is available for GitHub Actions container shell
RUN bash --version

# Install Node.js (via n) and latest npm
RUN set -eux; \
    npm install -g n; \
    n ${NODE_VERSION}; \
    npm install -g npm@latest

# Pre-install Playwright browser binaries (Chromium only)
RUN set -eux; \
    mkdir -p /tmp/pw-install; \
    cd /tmp/pw-install; \
    npm init -y >/dev/null 2>&1; \
    npm install --no-fund --no-audit --silent @playwright/test@^1.40.0; \
    npx playwright install --with-deps chromium; \
    rm -rf /tmp/pw-install

# Set up workspace
WORKDIR /workspace

# Use bash for subsequent RUN instructions and scripts
SHELL ["/bin/bash", "-c"]

# Ensure `/bin/sh` points to bash for compatibility with GitHub Actions runner
RUN ln -sf /bin/bash /bin/sh