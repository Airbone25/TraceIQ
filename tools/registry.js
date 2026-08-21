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

  async execute(name, input, context = undefined) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    if (tool.schema) {
      const parsed = tool.schema.safeParse(input);
      if (!parsed.success) {
        const errors = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw new Error(`Tool input validation failed for ${name}: ${errors}`);
      }
      input = parsed.data;
    }

    return tool.execute(input, context);
  }
}
