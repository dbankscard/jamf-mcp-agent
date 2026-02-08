import * as http from 'node:http';
import { HealthChecker } from './health.js';

export function createHealthServer(checker: HealthChecker, port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    if (req.url === '/health') {
      const status = await checker.getHealthStatus();
      const code = status.status === 'unhealthy' ? 503 : 200;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    if (req.url === '/ready') {
      const status = await checker.getHealthStatus();
      const mcpHealthy = status.components.mcp.status === 'healthy';
      const code = mcpHealthy ? 200 : 503;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port);
  return server;
}
