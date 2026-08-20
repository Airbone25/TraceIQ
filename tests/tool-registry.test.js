import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../tools/registry.js';

describe('ToolRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  function makeTool(name, executeFn) {
    return {
      name,
      description: `Test tool: ${name}`,
      parameters: { type: 'object', properties: {} },
      execute: executeFn || (() => ({ success: true })),
    };
  }

  it('should register a tool', () => {
    const tool = makeTool('test_tool');
    registry.register(tool);
    expect(registry.get('test_tool')).toBe(tool);
  });

  it('should throw when registering tool without name', () => {
    const tool = { description: 'no name', execute: () => {} };
    expect(() => registry.register(tool)).toThrow('Tool must have name, description, and execute');
  });

  it('should throw when registering tool without description', () => {
    const tool = { name: 'no_desc', execute: () => {} };
    expect(() => registry.register(tool)).toThrow('Tool must have name, description, and execute');
  });

  it('should throw when registering tool without execute', () => {
    const tool = { name: 'no_exec', description: 'no execute' };
    expect(() => registry.register(tool)).toThrow('Tool must have name, description, and execute');
  });

  it('should return undefined for unknown tool', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('should return all registered tools', () => {
    registry.register(makeTool('tool_a'));
    registry.register(makeTool('tool_b'));
    const all = registry.getAll();
    expect(all).toHaveLength(2);
    expect(all.map(t => t.name)).toEqual(['tool_a', 'tool_b']);
  });

  it('should return tool definitions', () => {
    registry.register(makeTool('my_tool'));
    const defs = registry.getDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('my_tool');
    expect(defs[0].description).toBe('Test tool: my_tool');
    expect(defs[0].parameters).toEqual({ type: 'object', properties: {} });
  });

  it('should execute registered tool', async () => {
    const executeFn = (input) => ({ success: true, input });
    registry.register(makeTool('my_tool', executeFn));
    const result = await registry.execute('my_tool', { foo: 'bar' });
    expect(result).toEqual({ success: true, input: { foo: 'bar' } });
  });

  it('should throw when executing unknown tool', async () => {
    await expect(registry.execute('nonexistent', {})).rejects.toThrow('Tool not found: nonexistent');
  });

  it('should overwrite tool with same name', () => {
    registry.register(makeTool('dup', () => ({ version: 1 })));
    registry.register(makeTool('dup', () => ({ version: 2 })));
    expect(registry.getAll()).toHaveLength(1);
  });

  it('should execute tools independently', async () => {
    registry.register(makeTool('a', () => 'result_a'));
    registry.register(makeTool('b', () => 'result_b'));
    expect(await registry.execute('a', {})).toBe('result_a');
    expect(await registry.execute('b', {})).toBe('result_b');
  });

  it('should return empty array for no registered tools', () => {
    expect(registry.getAll()).toEqual([]);
    expect(registry.getDefinitions()).toEqual([]);
  });
});
