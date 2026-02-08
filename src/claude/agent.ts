import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type ContentBlock,
  type ToolUseBlock,
  type ToolResultBlock,
  type SystemContentBlock,
  type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import { MCPClient } from '../mcp/client.js';
import { mapTools } from '../mcp/tool-mapper.js';
import { AgentResult, AgentReport, RemediationResult, RemediationReport, TokenUsage } from './types.js';
import { PROMPT_VERSION } from './prompts.js';
import { logger } from '../logger.js';
import { BedrockError } from '../errors.js';
import { recordAgentRun } from '../metrics.js';
import { runWithContext } from '../context.js';

export interface AgentOptions {
  model: string;
  maxToolRounds: number;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  readOnlyTools?: boolean;
  requestTimeoutMs?: number;
  maxTokens?: number;
  progressToStderr?: boolean;
}

const RATE_LIMIT_PATTERN = /too many connections|rate limit|throttl/i;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 2000;
const TOOL_CALL_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class Agent {
  private client: BedrockRuntimeClient;
  private mcpClient: MCPClient;
  private options: AgentOptions;

  private progressEnabled: boolean;

  constructor(mcpClient: MCPClient, options: AgentOptions) {
    this.progressEnabled = options.progressToStderr ?? (process.stderr.isTTY ?? false);
    const clientConfig: ConstructorParameters<typeof BedrockRuntimeClient>[0] = {
      region: options.region,
    };

    if (options.accessKeyId && options.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      };
    }

    this.client = new BedrockRuntimeClient(clientConfig);
    this.mcpClient = mcpClient;
    this.options = options;
  }

  private reportProgress(round: number, toolCalls: number, tokenUsage: TokenUsage): void {
    if (!this.progressEnabled) return;
    const maxRounds = this.options.maxToolRounds;
    process.stderr.write(
      `\r  Round ${round}/${maxRounds} | ${toolCalls} tool call(s) | ${tokenUsage.totalTokens} tokens`,
    );
  }

  async run(systemPrompt: string, userMessage: string): Promise<AgentResult> {
    return runWithContext(() => this.executeAgentLoop(systemPrompt, userMessage));
  }

  async runRemediation(systemPrompt: string, userMessage: string): Promise<RemediationResult> {
    const result = await runWithContext(() => this.executeAgentLoop(systemPrompt, userMessage));
    return {
      report: parseRemediationReport(result.rawText),
      rawText: result.rawText,
      toolCallCount: result.toolCallCount,
      rounds: result.rounds,
      tokenUsage: result.tokenUsage,
    };
  }

  private async executeAgentLoop(systemPrompt: string, userMessage: string): Promise<AgentResult> {
    const agentStart = Date.now();
    const bedrockTools = mapTools(
      this.mcpClient.getTools(),
      this.options.readOnlyTools ?? false,
    );

    const toolConfig = {
      tools: bedrockTools as Tool[],
    };

    logger.info(`Agent starting — ${bedrockTools.length} tools available, prompt v${PROMPT_VERSION}`);

    const system: SystemContentBlock[] = [{ text: systemPrompt }];

    const messages: Message[] = [
      { role: 'user', content: [{ text: userMessage }] },
    ];

    let rounds = 0;
    let toolCallCount = 0;
    const tokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    while (rounds < this.options.maxToolRounds) {
      rounds++;
      logger.info(`Round ${rounds}/${this.options.maxToolRounds}`);
      this.reportProgress(rounds, toolCallCount, tokenUsage);

      // Wrap entire round in retry logic — rate-limit errors can surface from
      // the MCP transport layer (async errors from compound tool internals),
      // not just from individual callTool invocations.
      const roundResult = await this.executeRoundWithRetry(
        system, messages, toolConfig, () => toolCallCount,
        (n: number) => { toolCallCount = n; },
        tokenUsage,
      );

      if (roundResult.done) {
        if (roundResult.rawText !== undefined) {
          if (this.progressEnabled) process.stderr.write('\r\x1b[K');
          logger.info(`Agent finished after ${rounds} round(s), ${toolCallCount} tool call(s), ${tokenUsage.totalTokens} tokens`);
          recordAgentRun(Date.now() - agentStart, toolCallCount, rounds, tokenUsage).catch(() => {});
          return {
            report: parseReport(roundResult.rawText),
            rawText: roundResult.rawText,
            toolCallCount,
            rounds,
            tokenUsage,
          };
        }
      }
    }

    // Max rounds reached
    if (this.progressEnabled) process.stderr.write('\r\x1b[K');
    logger.warn(`Agent hit max rounds (${this.options.maxToolRounds})`);

    const lastAssistant = messages
      .filter(m => m.role === 'assistant')
      .pop();

    const rawText = lastAssistant?.content
      ?.filter((b): b is ContentBlock & { text: string } => 'text' in b && typeof b.text === 'string')
      .map(b => b.text)
      .join('\n') ?? '';

    recordAgentRun(Date.now() - agentStart, toolCallCount, rounds, tokenUsage).catch(() => {});
    return { report: parseReport(rawText), rawText, toolCallCount, rounds, tokenUsage };
  }

  private async executeRoundWithRetry(
    system: SystemContentBlock[],
    messages: Message[],
    toolConfig: { tools: Tool[] },
    getToolCount: () => number,
    setToolCount: (n: number) => void,
    tokenUsage: TokenUsage,
  ): Promise<{ done: boolean; rawText?: string }> {
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.executeRound(system, messages, toolConfig, getToolCount, setToolCount, tokenUsage);
      } catch (err: any) {
        if (RATE_LIMIT_PATTERN.test(err.message) && attempt < RETRY_ATTEMPTS) {
          const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
          logger.warn(`Rate limited (attempt ${attempt}/${RETRY_ATTEMPTS}), retrying round in ${delay}ms...`);
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }
    return { done: false };
  }

  private async executeRound(
    system: SystemContentBlock[],
    messages: Message[],
    toolConfig: { tools: Tool[] },
    getToolCount: () => number,
    setToolCount: (n: number) => void,
    tokenUsage: TokenUsage,
  ): Promise<{ done: boolean; rawText?: string }> {
    const timeoutMs = this.options.requestTimeoutMs ?? 120_000;
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    const command = new ConverseCommand({
      modelId: this.options.model,
      system,
      messages,
      toolConfig,
      inferenceConfig: { maxTokens: this.options.maxTokens ?? 8192 },
    });

    let response;
    try {
      response = await this.client.send(command, {
        abortSignal: abortController.signal,
      });
    } catch (err: any) {
      if (abortController.signal.aborted) {
        throw new BedrockError(`Bedrock request timed out after ${timeoutMs}ms`, {
          operation: 'converse',
          context: { model: this.options.model, timeoutMs },
        });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    // Accumulate token usage from this round
    if (response.usage) {
      tokenUsage.inputTokens += response.usage.inputTokens ?? 0;
      tokenUsage.outputTokens += response.usage.outputTokens ?? 0;
      tokenUsage.totalTokens = tokenUsage.inputTokens + tokenUsage.outputTokens;
    }

    const assistantContent = response.output?.message?.content ?? [];
    messages.push({ role: 'assistant', content: assistantContent });

    if (response.stopReason === 'end_turn') {
      const rawText = assistantContent
        .filter((b): b is ContentBlock & { text: string } => 'text' in b && typeof b.text === 'string')
        .map(b => b.text)
        .join('\n');
      return { done: true, rawText };
    }

    // Handle tool_use blocks
    const toolUseBlocks = assistantContent.filter(
      (b): b is ContentBlock & Required<Pick<ContentBlock, 'toolUse'>> =>
        'toolUse' in b && b.toolUse !== undefined,
    );

    if (toolUseBlocks.length === 0) {
      const rawText = assistantContent
        .filter((b): b is ContentBlock & { text: string } => 'text' in b && typeof b.text === 'string')
        .map(b => b.text)
        .join('\n');
      return { done: true, rawText };
    }

    // Execute tool calls with throttle + per-call retry
    const toolResults: ContentBlock[] = [];
    let toolCallCount = getToolCount();

    for (let i = 0; i < toolUseBlocks.length; i++) {
      if (i > 0) await sleep(TOOL_CALL_DELAY_MS);

      const toolUse = toolUseBlocks[i].toolUse as ToolUseBlock;
      toolCallCount++;
      logger.info(`  Tool call: ${toolUse.name}`);

      const result = await this.callToolWithRetry(
        toolUse.name!,
        (toolUse.input ?? {}) as Record<string, unknown>,
      );

      toolResults.push({
        toolResult: {
          toolUseId: toolUse.toolUseId,
          content: [{ text: result.text }],
          status: result.isError ? 'error' : 'success',
        } as ToolResultBlock,
      });
    }

    setToolCount(toolCallCount);
    messages.push({ role: 'user', content: toolResults });
    return { done: false };
  }

  private async callToolWithRetry(
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ text: string; isError: boolean }> {
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      try {
        const result = await this.mcpClient.callTool(name, input);

        const text = result.content
          .map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c)))
          .join('\n');

        if (result.isError && RATE_LIMIT_PATTERN.test(text) && attempt < RETRY_ATTEMPTS) {
          const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
          logger.warn(`  Rate limited on ${name} (attempt ${attempt}/${RETRY_ATTEMPTS}), retrying in ${delay}ms...`);
          await sleep(delay);
          continue;
        }

        return { text, isError: result.isError ?? false };
      } catch (err: any) {
        if (RATE_LIMIT_PATTERN.test(err.message) && attempt < RETRY_ATTEMPTS) {
          const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
          logger.warn(`  Rate limited on ${name} (attempt ${attempt}/${RETRY_ATTEMPTS}), retrying in ${delay}ms...`);
          await sleep(delay);
          continue;
        }

        logger.error(`  Tool error: ${name} — ${err.message}`);
        return { text: `Error: ${err.message}`, isError: true };
      }
    }

    return { text: 'Error: max retries exceeded', isError: true };
  }
}

/**
 * Extract and parse a JSON AgentReport from Claude's response text.
 * Handles optional markdown code fences.
 */
function parseReport(text: string): AgentReport | null {
  if (!text.trim()) return null;

  // Strip markdown fences if present
  let json = text;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    json = fenceMatch[1];
  }

  // Try to find a JSON object in the text
  const braceStart = json.indexOf('{');
  const braceEnd = json.lastIndexOf('}');
  if (braceStart === -1 || braceEnd === -1) return null;

  try {
    const parsed = JSON.parse(json.slice(braceStart, braceEnd + 1));
    if (parsed.summary && parsed.overallStatus && Array.isArray(parsed.findings)) {
      return parsed as AgentReport;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract and parse a JSON RemediationReport from Claude's response text.
 * Checks for `actions` array and `findingsAttempted` field.
 */
function parseRemediationReport(text: string): RemediationReport | null {
  if (!text.trim()) return null;

  let json = text;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    json = fenceMatch[1];
  }

  const braceStart = json.indexOf('{');
  const braceEnd = json.lastIndexOf('}');
  if (braceStart === -1 || braceEnd === -1) return null;

  try {
    const parsed = JSON.parse(json.slice(braceStart, braceEnd + 1));
    if (
      parsed.summary &&
      Array.isArray(parsed.actions) &&
      typeof parsed.findingsAttempted === 'number'
    ) {
      // Strip spurious error fields from success/skipped actions
      for (const action of parsed.actions) {
        if ((action.status === 'success' || action.status === 'skipped') && 'error' in action) {
          delete action.error;
        }
      }
      return parsed as RemediationReport;
    }
    return null;
  } catch {
    return null;
  }
}
