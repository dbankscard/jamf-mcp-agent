import { describe, it, expect } from 'vitest';
import {
  AppError,
  MCPError,
  BedrockError,
  SlackError,
  ConfigError,
  TimeoutError,
} from './errors.js';

describe('AppError', () => {
  it('sets all fields', () => {
    const err = new AppError('boom', {
      component: 'mcp',
      operation: 'connect',
      context: { url: 'http://localhost' },
    });
    expect(err.message).toBe('boom');
    expect(err.component).toBe('mcp');
    expect(err.operation).toBe('connect');
    expect(err.context).toEqual({ url: 'http://localhost' });
    expect(err.cause).toBeUndefined();
    expect(err.name).toBe('AppError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it('chains cause', () => {
    const cause = new Error('underlying');
    const err = new AppError('wrapper', {
      component: 'bedrock',
      operation: 'send',
      cause,
    });
    expect(err.cause).toBe(cause);
  });

  it('toJSON includes all fields', () => {
    const cause = new Error('root');
    const err = new AppError('test', {
      component: 'config',
      operation: 'load',
      context: { key: 'val' },
      cause,
    });
    const json = err.toJSON();
    expect(json.name).toBe('AppError');
    expect(json.message).toBe('test');
    expect(json.component).toBe('config');
    expect(json.operation).toBe('load');
    expect(json.context).toEqual({ key: 'val' });
    expect(json.cause).toEqual({ name: 'Error', message: 'root' });
    expect(json.stack).toBeDefined();
  });
});

describe('MCPError', () => {
  it('is an AppError with component=mcp', () => {
    const err = new MCPError('connection failed', { operation: 'connect' });
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(MCPError);
    expect(err.name).toBe('MCPError');
    expect(err.component).toBe('mcp');
    expect(err.operation).toBe('connect');
  });
});

describe('BedrockError', () => {
  it('is an AppError with component=bedrock', () => {
    const err = new BedrockError('timeout', { operation: 'converse' });
    expect(err).toBeInstanceOf(AppError);
    expect(err.name).toBe('BedrockError');
    expect(err.component).toBe('bedrock');
  });
});

describe('SlackError', () => {
  it('is an AppError with component=slack', () => {
    const err = new SlackError('post failed', { operation: 'postMessage' });
    expect(err).toBeInstanceOf(AppError);
    expect(err.name).toBe('SlackError');
    expect(err.component).toBe('slack');
  });
});

describe('ConfigError', () => {
  it('has operation=load by default', () => {
    const err = new ConfigError('missing key', {});
    expect(err).toBeInstanceOf(AppError);
    expect(err.name).toBe('ConfigError');
    expect(err.component).toBe('config');
    expect(err.operation).toBe('load');
  });
});

describe('TimeoutError', () => {
  it('includes timeoutMs', () => {
    const err = new TimeoutError('timed out', {
      component: 'mcp',
      operation: 'callTool',
      timeoutMs: 30_000,
    });
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err.name).toBe('TimeoutError');
    expect(err.timeoutMs).toBe(30_000);
  });

  it('toJSON includes timeoutMs', () => {
    const err = new TimeoutError('timed out', {
      component: 'bedrock',
      operation: 'send',
      timeoutMs: 120_000,
      context: { model: 'claude' },
    });
    const json = err.toJSON();
    expect(json.timeoutMs).toBe(120_000);
    expect(json.component).toBe('bedrock');
    expect(json.context).toEqual({ model: 'claude' });
  });

  it('chains cause', () => {
    const cause = new Error('socket timeout');
    const err = new TimeoutError('request timed out', {
      component: 'mcp',
      operation: 'connect',
      timeoutMs: 5_000,
      cause,
    });
    expect(err.cause).toBe(cause);
    expect(err.toJSON().cause).toEqual({ name: 'Error', message: 'socket timeout' });
  });
});
