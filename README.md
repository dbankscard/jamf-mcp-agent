# Jamf MCP Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

AI-powered Jamf Pro fleet monitoring agent using the [Model Context Protocol](https://modelcontextprotocol.io/) and AWS Bedrock.

## Architecture

```
                          ┌─────────────┐
                          │  Slack Bot   │
                          └──────▲───────┘
                                 │
┌──────────┐  tool calls  ┌─────┴───────┐  invoke   ┌──────────────┐
│ Jamf Pro │◄────────────►│  MCP Client │◄─────────►│  AWS Bedrock │
│  Server  │  (stdio/http)│             │  (Claude)  │              │
└──────────┘              └─────┬───────┘           └──────────────┘
                                │
                          ┌─────▼───────┐
                          │  Scheduler  │
                          │  (cron)     │
                          └─────────────┘
```

The agent connects to a [Jamf MCP Server](https://github.com/jamf/jamf-mcp-server) via stdio or HTTP, queries your Jamf Pro environment through tool calls, and uses Claude (via AWS Bedrock) to produce structured compliance, security, and fleet health reports. Reports can be posted to Slack and run on a cron schedule.

## Prerequisites

- **Node.js 20+**
- **Jamf Pro** instance with an API client (client ID + secret)
- **AWS account** with Bedrock access enabled for Claude models
- **(Optional)** Slack bot token for posting reports to channels

## Quick Start

```bash
# Clone
git clone https://github.com/dbanks/jamf-mcp-agent.git
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

```bash
# Run a report (compliance | security | fleet)
jamf-agent check <type>
jamf-agent check compliance --slack    # also post to Slack

# Ask an ad-hoc question
jamf-agent ask "How many devices are running macOS 15?"

# Start daemon mode with scheduled reports
jamf-agent start

# Check component health
jamf-agent health
```

## Configuration Reference

All configuration is via environment variables (or `.env` file). Defaults shown in parentheses.

### MCP Server

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_TRANSPORT` | Transport mode: `stdio` or `http` | `stdio` |
| `MCP_SERVER_PATH` | Path to MCP server entry point (stdio mode) | — |
| `JAMF_URL` | Jamf Pro instance URL (stdio mode) | — |
| `JAMF_CLIENT_ID` | Jamf API client ID (stdio mode) | — |
| `JAMF_CLIENT_SECRET` | Jamf API client secret (stdio mode) | — |
| `MCP_SERVER_URL` | MCP server URL (http mode) | — |
| `MCP_CONNECT_TIMEOUT_MS` | Connection timeout | `30000` |
| `MCP_TOOL_TIMEOUT_MS` | Per-tool-call timeout | `120000` |
| `MCP_MAX_RECONNECT_ATTEMPTS` | Max reconnection attempts | `5` |
| `MCP_RECONNECT_BASE_MS` | Base delay for exponential backoff | `1000` |

### AWS Bedrock

| Variable | Description | Default |
|----------|-------------|---------|
| `AWS_REGION` | AWS region | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | AWS access key (optional — uses default credential chain) | — |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | — |
| `BEDROCK_MODEL` | Bedrock model ID | `us.anthropic.claude-3-5-sonnet-20241022-v2:0` |
| `BEDROCK_MAX_TOOL_ROUNDS` | Max agent tool-use rounds per run | `15` |
| `BEDROCK_REQUEST_TIMEOUT_MS` | Bedrock request timeout | `120000` |

### Slack

| Variable | Description | Default |
|----------|-------------|---------|
| `SLACK_ENABLED` | Enable Slack posting | `false` |
| `SLACK_BOT_TOKEN` | Slack bot OAuth token (`xoxb-...`) | — |
| `SLACK_CHANNEL_COMPLIANCE` | Channel ID for compliance reports | — |
| `SLACK_CHANNEL_SECURITY` | Channel ID for security reports | — |
| `SLACK_CHANNEL_FLEET` | Channel ID for fleet reports | — |

### Scheduler

| Variable | Description | Default |
|----------|-------------|---------|
| `SCHEDULER_ENABLED` | Enable cron scheduler in daemon mode | `false` |
| `SCHEDULER_TIMEZONE` | Timezone for cron expressions | `America/New_York` |
| `CRON_COMPLIANCE` | Compliance report cron | `0 8 * * 1-5` |
| `CRON_SECURITY` | Security report cron | `0 9 * * 1-5` |
| `CRON_FLEET` | Fleet health report cron | `0 10 * * 1` |

## Daemon Mode + Slack

Run `jamf-agent start` to launch in daemon mode. The scheduler runs compliance, security, and fleet reports on cron schedules and posts results to the configured Slack channels.

1. Create a Slack app with `chat:write` scope
2. Install it to your workspace and copy the bot token
3. Set `SLACK_ENABLED=true`, add the bot token and channel IDs to `.env`
4. Set `SCHEDULER_ENABLED=true` and adjust cron expressions if needed
5. Run `jamf-agent start`

The agent handles graceful shutdown on `SIGTERM`/`SIGINT`, cleans up MCP connections, and guards against overlapping job runs.

## MCP Transport Modes

**stdio** (default) — the agent spawns the MCP server as a child process and communicates over stdin/stdout. Best for local development. Requires `MCP_SERVER_PATH` and Jamf credentials.

**http** — the agent connects to a running MCP server over HTTP/SSE. Best for production deployments where the MCP server runs as a separate service (e.g. AWS Lambda). Requires `MCP_SERVER_URL`.

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

- `mcp.connect.duration` — MCP connection time
- `mcp.tool_call.duration` / `mcp.tool_call.errors` — per-tool latency and errors
- `agent.run.duration` / `agent.run.tool_calls` / `agent.run.rounds` — agent run stats
- `scheduler.job.duration` / `scheduler.job.success` / `scheduler.job.error` — job outcomes
- `slack.post.duration` / `slack.post.errors` — Slack posting stats

## Development

```bash
# Build
npm run build

# Run tests
npm test

# Type-check without emitting
npm run typecheck

# Dev mode (tsx, no build step)
npm run cli -- check compliance
```

## License

[MIT](LICENSE)
