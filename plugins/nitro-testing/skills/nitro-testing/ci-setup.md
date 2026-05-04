# CI/CD Setup

Configure GitHub Actions to run tests with a real PostgreSQL database.

## GitHub Actions Workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: myapp-test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "yarn"

      - name: Install dependencies
        run: yarn install --frozen-lockfile

      - name: Run tests
        run: yarn test --coverage
        env:
          TEST_POSTGRESQL_CONNECTION_STRING: postgresql://postgres:postgres@localhost:5432/myapp-test

      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
          retention-days: 7

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "yarn"
      - run: yarn install --frozen-lockfile
      - run: yarn typecheck
```

## Coverage Report on PRs

Add coverage reporting to pull requests:

```yaml
# .github/workflows/ci.yml (add to test job steps)
      - name: Coverage Report
        if: github.event_name == 'pull_request'
        uses: davelosert/vitest-coverage-report-action@v2
        with:
          vite-config-path: vitest.config.ts
          json-summary-path: coverage/coverage-summary.json
          json-final-path: coverage/coverage-final.json
```

## Key Configuration Points

### PostgreSQL Service

```yaml
services:
  postgres:
    image: postgres:15  # Match your production version
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: myapp-test  # Test database name
    ports:
      - 5432:5432
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

The health check ensures PostgreSQL is ready before tests run.

### Connection String

```yaml
env:
  TEST_POSTGRESQL_CONNECTION_STRING: postgresql://postgres:postgres@localhost:5432/myapp-test
```

This environment variable is read by `global-setup.ts` and `setup.ts`.

### Node.js Version

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "22"  # Match your project
    cache: "yarn"       # or "npm"
```

## Parallel Test Jobs

For faster CI, run tests in parallel (if you have many):

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shard: [1, 2, 3, 4]

    services:
      postgres:
        # ... same config

    steps:
      # ... setup steps

      - name: Run tests (shard ${{ matrix.shard }})
        run: yarn test --shard=${{ matrix.shard }}/${{ strategy.job-total }}
        env:
          TEST_POSTGRESQL_CONNECTION_STRING: postgresql://postgres:postgres@localhost:5432/myapp-test
```

## Caching Dependencies

The `cache: "yarn"` option caches `node_modules` based on `yarn.lock`:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "22"
    cache: "yarn"  # Automatically caches based on yarn.lock
```

For npm:
```yaml
    cache: "npm"  # Caches based on package-lock.json
```

## Branch Protection

Configure branch protection rules in GitHub:

1. Go to **Settings → Branches → Add rule**
2. Branch name pattern: `main`
3. Enable:
   - ✅ Require status checks to pass before merging
   - ✅ Require branches to be up to date before merging
4. Add required status checks:
   - `test`
   - `typecheck`

## Local CI Simulation

Test the CI workflow locally using [act](https://github.com/nektos/act):

```bash
# Install act
brew install act

# Run workflow
act push
```

Or use Docker directly:

```bash
# Start test database
docker run -d --name test-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=myapp-test \
  -p 5432:5432 \
  postgres:15

# Run tests
TEST_POSTGRESQL_CONNECTION_STRING=postgresql://postgres:postgres@localhost:5432/myapp-test \
  yarn test

# Cleanup
docker stop test-db && docker rm test-db
```

## Secrets and Environment Variables

For production-like test databases or external services:

```yaml
steps:
  - name: Run tests
    run: yarn test
    env:
      TEST_POSTGRESQL_CONNECTION_STRING: ${{ secrets.TEST_DATABASE_URL }}
      STRIPE_TEST_KEY: ${{ secrets.STRIPE_TEST_KEY }}
```

Store secrets in **Settings → Secrets and variables → Actions**.
