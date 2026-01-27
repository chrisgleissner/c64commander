FROM ubuntu:24.04

ARG NODE_VERSION=20.11.1
ARG NPM_VERSION=10.8.2
ARG PLAYWRIGHT_VERSION=1.48.2
ARG ANDROID_CMDLINE_VERSION=11076708

ENV DEBIAN_FRONTEND=noninteractive \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    ANDROID_HOME=/opt/android-sdk \
    JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_VERSION=${NODE_VERSION} \
    NPM_VERSION=${NPM_VERSION} \
    PLAYWRIGHT_VERSION=${PLAYWRIGHT_VERSION}

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

# Install Node.js (via n) and pinned npm
RUN set -eux; \
    npm install -g n; \
    n ${NODE_VERSION}; \
    npm install -g npm@${NPM_VERSION}; \
    npm config delete globalignorefile || true; \
    npm --version; \
    node --version

# Install Android SDK cmdline-tools and required components
ENV PATH="${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools:${PATH}"
RUN set -eux; \
    mkdir -p ${ANDROID_SDK_ROOT}/cmdline-tools; \
    curl -fsSL -o /tmp/cmdline-tools.zip https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CMDLINE_VERSION}_latest.zip; \
    unzip -q /tmp/cmdline-tools.zip -d ${ANDROID_SDK_ROOT}/cmdline-tools; \
    mv ${ANDROID_SDK_ROOT}/cmdline-tools/cmdline-tools ${ANDROID_SDK_ROOT}/cmdline-tools/latest; \
    rm -f /tmp/cmdline-tools.zip; \
    yes | sdkmanager --licenses; \
    sdkmanager \
      "platform-tools" \
      "platforms;android-34" \
      "platforms;android-35" \
      "build-tools;34.0.0" \
      "build-tools;35.0.0"

# Pre-install Playwright browser binaries (all)
RUN set -eux; \
    mkdir -p /tmp/pw-install; \
    cd /tmp/pw-install; \
    npm init -y >/dev/null 2>&1; \
    npm install --no-fund --no-audit --silent @playwright/test@${PLAYWRIGHT_VERSION}; \
    npx playwright install --with-deps; \
    rm -rf /tmp/pw-install

# Pre-install Node dependencies based on lockfile (for CI extraction)
WORKDIR /opt/app
COPY package.json package-lock.json ./
COPY patches ./patches
RUN set -eux; \
    npm ci --no-audit --no-fund; \
    tar -czf /opt/node_modules.tar.gz node_modules; \
    rm -rf node_modules

# Set up workspace
WORKDIR /workspace

# Use bash for subsequent RUN instructions and scripts
SHELL ["/bin/bash", "-c"]

# Ensure `/bin/sh` points to bash for compatibility with GitHub Actions runner
RUN ln -sf /bin/bash /bin/sh