import pino from 'pino';

const logger = pino({ name: 'tool-registry' });

export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    if (!tool.name || !tool.description || !tool.execute) {
      throw new Error('Tool must have name, description, and execute');
    }
    this.tools.set(tool.name, tool);
    logger.info({ tool: tool.name }, 'Tool registered');
  }

  get(name) {
    return this.tools.get(name);
  }

  getAll() {
    return Array.from(this.tools.values());
  }

  getDefinitions() {
    return this.getAll().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  async execute(name, input) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool.execute(input);
  }
}
