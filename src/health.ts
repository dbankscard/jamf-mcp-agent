import { MCPClient } from './mcp/client.js';
import { Config } from './config.js';
import { getRunningJobs } from './scheduler/index.js';
import { logger } from './logger.js';

export type ComponentStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ComponentHealth {
  status: ComponentStatus;
  message: string;
}

export interface HealthStatus {
  status: ComponentStatus;
  components: {
    mcp: ComponentHealth;
    bedrock: ComponentHealth;
    slack: ComponentHealth;
    scheduler: ComponentHealth;
  };
  timestamp: string;
}

function worst(a: ComponentStatus, b: ComponentStatus): ComponentStatus {
  const rank: Record<ComponentStatus, number> = { healthy: 0, degraded: 1, unhealthy: 2 };
  return rank[a] >= rank[b] ? a : b;
}

export class HealthChecker {
  constructor(
    private mcp: MCPClient | null,
    private config: Config,
  ) {}

  async getHealthStatus(): Promise<HealthStatus> {
    const mcpHealth = this.checkMCP();
    const bedrockHealth = this.checkBedrock();
    const slackHealth = this.checkSlack();
    const schedulerHealth = this.checkScheduler();

    let overall: ComponentStatus = 'healthy';
    overall = worst(overall, mcpHealth.status);
    overall = worst(overall, bedrockHealth.status);
    overall = worst(overall, slackHealth.status);
    overall = worst(overall, schedulerHealth.status);

    return {
      status: overall,
      components: {
        mcp: mcpHealth,
        bedrock: bedrockHealth,
        slack: slackHealth,
        scheduler: schedulerHealth,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private checkMCP(): ComponentHealth {
    if (!this.mcp) {
      return { status: 'unhealthy', message: 'MCP client not initialized' };
    }
    if (!this.mcp.isConnected()) {
      return { status: 'unhealthy', message: 'MCP not connected' };
    }
    const toolCount = this.mcp.getToolCount();
    if (toolCount === 0) {
      return { status: 'degraded', message: 'MCP connected but no tools discovered' };
    }
    return { status: 'healthy', message: `Connected, ${toolCount} tools` };
  }

  private checkBedrock(): ComponentHealth {
    if (!this.config.bedrock.model) {
      return { status: 'unhealthy', message: 'Bedrock model not configured' };
    }
    return { status: 'healthy', message: `Model: ${this.config.bedrock.model}` };
  }

  private checkSlack(): ComponentHealth {
    if (!this.config.slack.enabled) {
      return { status: 'healthy', message: 'Slack disabled' };
    }
    if (!this.config.slack.botToken) {
      return { status: 'degraded', message: 'Slack enabled but no bot token' };
    }
    return { status: 'healthy', message: 'Slack configured' };
  }

  private checkScheduler(): ComponentHealth {
    if (!this.config.scheduler.enabled) {
      return { status: 'healthy', message: 'Scheduler disabled' };
    }
    const running = getRunningJobs();
    if (running.length > 0) {
      return { status: 'healthy', message: `Running: ${running.join(', ')}` };
    }
    return { status: 'healthy', message: 'Scheduler active, no jobs running' };
  }

  startPeriodicCheck(intervalMs: number = 60_000): () => void {
    let lastStatus: ComponentStatus = 'healthy';

    const check = async () => {
      const status = await this.getHealthStatus();
      if (status.status !== lastStatus) {
        if (status.status === 'healthy') {
          logger.info('Health recovered: all components healthy');
        } else {
          const degraded = Object.entries(status.components)
            .filter(([, c]) => c.status !== 'healthy')
            .map(([name, c]) => `${name}: ${c.message}`)
            .join('; ');
          logger.warn(`Health ${status.status}: ${degraded}`);
        }
        lastStatus = status.status;
      }
    };

    const timer = setInterval(() => void check(), intervalMs);
    return () => clearInterval(timer);
  }
}
