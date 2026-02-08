# Jamf MCP Agent

[![CI](https://github.com/dbankscard/jamf-mcp-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/dbankscard/jamf-mcp-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Work in Progress** — This project is under active development. APIs, configuration, and behavior may change.

AI-powered Jamf Pro fleet monitoring and remediation agent using the [Model Context Protocol](https://modelcontextprotocol.io/) and AWS Bedrock (Claude).

Runs compliance, security, and fleet health checks against your Jamf Pro environment, produces structured JSON reports, posts findings to Slack, and can remediate issues automatically — all on a cron schedule or on demand.

## Architecture

```
                          ┌─────────────┐
                          │  Slack Bot   │
                          └──────▲───────┘
                                 │
┌──────────┐  tool calls  ┌─────┴───────┐  invoke   ┌──────────────┐
│ Jamf Pro │◄────────────►│  MCP Client │◄─────────►│  AWS Bedrock │
│  Server  │  (stdio/http)│             │  (Claude)  │              │
└──────────┘              └──┬──────┬───┘           └──────────────┘
                             │      │
                    ┌────────▼┐  ┌──▼──────────┐
                    │Scheduler│  │Health Server │
                    │ (cron)  │  │ :8080       │
                    └─────────┘  └─────────────┘
```

The agent connects to a [Jamf MCP Server](https://github.com/jamf/jamf-mcp-server) via stdio or HTTP, queries your Jamf Pro environment through tool calls, and uses Claude (via AWS Bedrock) to produce structured compliance, security, and fleet health reports. Reports can be posted to Slack and run on a cron schedule.

## Prerequisites

- **Node.js 20+**
- **Jamf Pro** instance with an API client (client ID + secret)
- **AWS account** with Bedrock access enabled for Claude models
- **(Optional)** Slack bot token for posting reports to channels
- **(Optional)** Docker for containerized deployment

## Quick Start

```bash
# Clone
git clone https://github.com/dbankscard/jamf-mcp-agent.git
cd jamf-mcp-agent

# Install dependencies
npm install

# Configure
cp .env.example .env
# Edit .env with your Jamf, AWS, and Slack credentials

# Build
npm run build

# Run a one-off compliance check
npx jamf-agent check compliance
```

## CLI Commands

### Reports

```bash
# Run a report (compliance | security | fleet)
jamf-agent check compliance
jamf-agent check security --slack          # also post to Slack
jamf-agent check fleet --save report.json  # save JSON to file
```

### Ad-hoc Questions

```bash
# Ask a read-only question about your fleet
jamf-agent ask "How many devices are running macOS 15?"

# Enable write tools for the question
jamf-agent ask "Deploy the latest OS update to the test group" --write

# Save the response
jamf-agent ask "List all unencrypted Macs" --save output.json
```

### Remediation

```bash
# Analyze and remediate — interactive selection
jamf-agent remediate compliance

# Dry run — plan remediation without executing
jamf-agent remediate security --dry-run --auto-approve

# Auto-approve automatable findings at or above a severity threshold
jamf-agent remediate compliance --auto-approve --min-severity high

# Remediate from a previously saved report
jamf-agent remediate --file report.json --auto-approve

# Select specific findings by index
jamf-agent remediate security --finding 0,2 --slack --save remediation.json
```

The remediation workflow:
1. **Analyze** — runs a report (or loads one from `--file`)
2. **Select** — interactive prompt, `--auto-approve`, or `--finding` indices
3. **Remediate** — executes fixes via write tools (or plans them with `--dry-run`)
4. **Report** — outputs a structured remediation report

### Daemon Mode

```bash
# Start with scheduled reports, health server, and preflight validation
jamf-agent start
```

### Health Check

```bash
# Check component health (MCP, Bedrock, Slack, Scheduler)
jamf-agent health
```

## Report Format

All reports follow a structured JSON schema:

```json
{
  "summary": "3 of 150 devices have critical compliance issues",
  "overallStatus": "warning",
  "findings": [
    {
      "title": "FileVault Not Enabled",
      "severity": "critical",
      "category": "security",
      "description": "3 devices do not have FileVault disk encryption enabled",
      "affectedDeviceCount": 3,
      "affectedDevices": [
        { "name": "LAPTOP-001", "id": "42", "detail": "FileVault disabled, last check 2025-01-15" }
      ],
      "remediation": {
        "title": "Enable FileVault via Configuration Profile",
        "steps": ["Deploy FileVault profile to affected devices", "Verify encryption status after 24h"],
        "effort": "low",
        "automatable": true
      }
    }
  ],
  "metrics": {
    "totalDevices": 150,
    "compliantDevices": 147
  }
}
```

**Status levels:** `healthy` | `warning` | `critical`
**Severity levels:** `critical` | `high` | `medium` | `low`
**Categories:** `compliance` | `security` | `maintenance`

## Configuration Reference

All configuration is via environment variables (or `.env` file). Defaults shown in parentheses.

### MCP Server

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_TRANSPORT` | Transport mode: `stdio` or `http` | `stdio` |
| `MCP_SERVER_PATH` | Path to MCP server entry point (stdio mode) | -- |
| `JAMF_URL` | Jamf Pro instance URL (stdio mode) | -- |
| `JAMF_CLIENT_ID` | Jamf API client ID (stdio mode) | -- |
| `JAMF_CLIENT_SECRET` | Jamf API client secret (stdio mode) | -- |
| `MCP_SERVER_URL` | MCP server URL (http mode) | -- |
| `MCP_CONNECT_TIMEOUT_MS` | Connection timeout | `30000` |
| `MCP_TOOL_TIMEOUT_MS` | Per-tool-call timeout | `120000` |
| `MCP_MAX_RECONNECT_ATTEMPTS` | Max reconnection attempts | `5` |
| `MCP_RECONNECT_BASE_MS` | Base delay for exponential backoff | `1000` |

### AWS Bedrock

| Variable | Description | Default |
|----------|-------------|---------|
| `AWS_REGION` | AWS region | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | AWS access key (optional -- uses default credential chain) | -- |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | -- |
| `BEDROCK_MODEL` | Bedrock model ID | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` |
| `BEDROCK_MAX_TOOL_ROUNDS` | Max agent tool-use rounds per run | `15` |
| `BEDROCK_MAX_TOKENS` | Max output tokens per Bedrock request | `8192` |
| `BEDROCK_REQUEST_TIMEOUT_MS` | Bedrock request timeout | `120000` |

### Slack

| Variable | Description | Default |
|----------|-------------|---------|
| `SLACK_ENABLED` | Enable Slack posting | `false` |
| `SLACK_BOT_TOKEN` | Slack bot OAuth token (`xoxb-...`) | -- |
| `SLACK_CHANNEL_COMPLIANCE` | Channel ID for compliance reports | -- |
| `SLACK_CHANNEL_SECURITY` | Channel ID for security reports | -- |
| `SLACK_CHANNEL_FLEET` | Channel ID for fleet reports | -- |

### Scheduler

| Variable | Description | Default |
|----------|-------------|---------|
| `SCHEDULER_ENABLED` | Enable cron scheduler in daemon mode | `false` |
| `SCHEDULER_TIMEZONE` | Timezone for cron expressions | `America/New_York` |
| `CRON_COMPLIANCE` | Compliance report cron | `0 8 * * 1-5` |
| `CRON_SECURITY` | Security report cron | `0 9 * * 1-5` |
| `CRON_FLEET` | Fleet health report cron | `0 10 * * 1` |
| `JOB_TIMEOUT_MS` | Max duration per scheduled job | `600000` |

### Health Server

| Variable | Description | Default |
|----------|-------------|---------|
| `HEALTH_PORT` | HTTP port for `/health` and `/ready` endpoints | `8080` |

## Daemon Mode

Run `jamf-agent start` to launch in daemon mode. On startup, the agent:

1. **Loads config** with retry (3 attempts, exponential backoff)
2. **Runs preflight checks** -- validates MCP connection, Slack auth, and Bedrock model access
3. **Logs a startup banner** with transport, model, schedule, and health port
4. **Starts the scheduler** for compliance, security, and fleet reports on cron
5. **Starts the HTTP health server** on the configured port
6. **Installs signal handlers** for graceful shutdown (`SIGINT`/`SIGTERM`)

The agent guards against overlapping job runs, applies per-job timeouts, retries failed jobs with exponential backoff, and tracks in-flight operations for clean shutdown.

### Slack Integration

1. Create a Slack app with `chat:write` scope
2. Install it to your workspace and copy the bot token
3. Set `SLACK_ENABLED=true`, add the bot token and channel IDs to `.env`
4. Set `SCHEDULER_ENABLED=true` and adjust cron expressions if needed
5. Run `jamf-agent start`

Reports are posted as rich Block Kit messages. Critical and high findings are threaded as replies. Medium and low findings are summarized in a single thread reply.

## Health Checks

The daemon exposes two HTTP endpoints:

| Endpoint | Purpose | 200 when | 503 when |
|----------|---------|----------|----------|
| `GET /health` | Liveness probe | `healthy` or `degraded` | `unhealthy` |
| `GET /ready` | Readiness probe | MCP component is `healthy` | MCP is not healthy |

Response body is the full health status JSON:

```json
{
  "status": "healthy",
  "components": {
    "mcp": { "status": "healthy", "message": "Connected, 87 tools" },
    "bedrock": { "status": "healthy", "message": "Model: us.anthropic.claude-sonnet-4-5-20250929-v1:0" },
    "slack": { "status": "healthy", "message": "Slack disabled" },
    "scheduler": { "status": "healthy", "message": "Scheduler active, no jobs running" }
  },
  "timestamp": "2025-01-15T14:30:00.000Z"
}
```

## Docker

### Build and Run

```bash
# Build the image
docker build -t jamf-agent .

# Run with your .env file
docker run --env-file .env -p 8080:8080 jamf-agent

# Check health
curl http://localhost:8080/health
curl http://localhost:8080/ready
```

### Docker Compose

```bash
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

The Dockerfile uses a multi-stage build (Alpine, non-root user, `~120MB` image). The health check is built in via `HEALTHCHECK` directive with a 60s start period for MCP connection and preflight.

## MCP Transport Modes

**stdio** (default) -- the agent spawns the MCP server as a child process and communicates over stdin/stdout. Best for local development. Requires `MCP_SERVER_PATH` and Jamf credentials.

**http** -- the agent connects to a running MCP server over HTTP/SSE. Best for production deployments where the MCP server runs as a separate service (e.g. AWS Lambda). Requires `MCP_SERVER_URL`.

## Tool Safety

By default, the agent operates in **read-only mode** -- only `search*`, `list*`, `get*`, `check*`, and `read*` tools are exposed to the LLM. This ensures scheduled reports and ad-hoc queries cannot modify your Jamf environment.

Write tools (policy execution, profile deployment, MDM commands, etc.) are only available when explicitly enabled:
- `jamf-agent ask "..." --write` -- enables write tools for a single question
- `jamf-agent remediate ...` -- enables write tools for live remediation (not `--dry-run`)

## Production

### AWS Secrets Manager

Store sensitive values (API keys, tokens) in AWS Secrets Manager instead of `.env`:

```bash
# Create a secret with your credentials as JSON
aws secretsmanager create-secret \
  --name jamf-mcp-agent/production \
  --secret-string '{"JAMF_CLIENT_SECRET":"...","SLACK_BOT_TOKEN":"xoxb-..."}'

# Tell the agent to use it
export AWS_SECRET_NAME=jamf-mcp-agent/production
```

Secrets from AWS Secrets Manager override environment variables.

### CloudWatch Metrics

The agent emits CloudWatch metrics via `aws-embedded-metrics` under the `JamfMCPAgent` namespace:

| Metric | Description |
|--------|-------------|
| `mcp.connect.duration` | MCP connection time |
| `mcp.tool_call.duration` | Per-tool-call latency |
| `mcp.tool_call.errors` | Tool call error count |
| `agent.run.duration` | Agent run total duration |
| `agent.run.tool_calls` | Tool calls per run |
| `agent.run.rounds` | LLM rounds per run |
| `agent.run.input_tokens` | Input tokens per run |
| `agent.run.output_tokens` | Output tokens per run |
| `scheduler.job.duration` | Scheduled job duration |
| `scheduler.job.success` | Successful job count |
| `scheduler.job.error` | Failed job count |
| `scheduler.job.skipped` | Skipped job count (overlap) |
| `slack.post.duration` | Slack post latency |
| `slack.post.errors` | Slack post error count |
| `remediation.duration` | Remediation run duration |
| `remediation.findings_attempted` | Findings attempted |
| `remediation.findings_succeeded` | Findings remediated |

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Type-check without emitting
npm run typecheck

# Dev mode (tsx, no build step)
npm run cli -- check compliance
npm run cli -- ask "How many Macs do we have?"
npm run cli -- start
```

### Project Structure

```
src/
  cli/index.ts          # CLI entry point (commander)
  claude/
    agent.ts            # Bedrock agent loop
    prompts.ts          # System prompts & report schema
    types.ts            # Report & finding types
  mcp/
    client.ts           # MCP client (stdio/http, reconnect)
    options.ts          # Config -> MCP options mapper
    tool-mapper.ts      # Tool filtering (read-only vs write)
  scheduler/index.ts    # Cron scheduler with retry
  slack/
    client.ts           # Slack posting (Block Kit)
    templates.ts        # Slack message templates
  config.ts             # Zod schema, env mapping, secrets
  errors.ts             # Error hierarchy (AppError -> typed subclasses)
  health.ts             # Health checker (component status)
  health-server.ts      # HTTP health endpoints
  index.ts              # Programmatic entry point
  logger.ts             # Lightweight JSON/TTY logger
  metrics.ts            # CloudWatch embedded metrics
  preflight.ts          # Startup validation & banner
  shutdown.ts           # Graceful shutdown manager
  context.ts            # AsyncLocalStorage request context
  secrets.ts            # AWS Secrets Manager loader
  utils.ts              # withTimeout utility
```

## License

[MIT](LICENSE)
