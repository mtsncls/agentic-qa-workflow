# Runtime: Playwright's official image pins browsers + system deps and matches
# the @playwright/test version installed in the repo.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

# Install app deps first (better layer caching) from the committed lockfile.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The official image ships a dedicated non-root user (pwuser): running as it
# keeps Chromium's sandbox enabled and avoids running the pipeline as root.
RUN chown -R pwuser:pwuser /app
USER pwuser

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

CMD ["npx", "playwright", "test"]