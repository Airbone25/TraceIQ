import { z } from 'zod';

if (process.env.NODE_ENV === 'test') {
  const { config } = await import('dotenv');
  config({ path: '.env.test' });
} else {
  await import('dotenv/config');
}

const envSchema = z.object({
  GROQ_API_KEY: z.string().min(1, 'GROQ_API_KEY is required'),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  MYSQL_HOST: z.string().default('localhost'),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_USER: z.string().min(1, 'MYSQL_USER is required'),
  MYSQL_PASSWORD: z.string().default(''),
  MYSQL_DATABASE: z.string().min(1, 'MYSQL_DATABASE is required'),
  MAX_AGENT_STEPS: z.coerce.number().int().positive().default(8),
  MAX_SQL_QUERIES: z.coerce.number().int().positive().default(5),
  MAX_QUERY_ROWS: z.coerce.number().int().positive().default(500),
  MAX_EXECUTION_TIME_MS: z.coerce.number().int().positive().default(60000),
  MAX_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  MAX_QUESTION_LENGTH: z.coerce.number().int().positive().default(5000),
  LLM_MAX_TOKENS: z.coerce.number().int().positive().default(1024),
  MAX_TOOL_RESULT_CHARS: z.coerce.number().int().positive().default(4000),
  MAX_CONTEXT_CHARS: z.coerce.number().int().positive().default(12000),
  MAX_CONCURRENT_INVESTIGATIONS: z.coerce.number().int().positive().default(1),
  INVESTIGATION_QUEUE_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  THREAD_CONTEXT_TURNS: z.coerce.number().int().positive().default(3),
  THREAD_CONTEXT_ANSWER_CHARS: z.coerce.number().int().positive().default(2000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export default parsed.data;
