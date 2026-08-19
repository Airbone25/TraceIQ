import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  GROQ_API_KEY: z.string().min(1, 'GROQ_API_KEY is required'),
  MYSQL_HOST: z.string().default('localhost'),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_USER: z.string().min(1, 'MYSQL_USER is required'),
  MYSQL_PASSWORD: z.string().default(''),
  MYSQL_DATABASE: z.string().min(1, 'MYSQL_DATABASE is required'),
  MAX_AGENT_STEPS: z.coerce.number().int().positive().default(8),
  MAX_SQL_QUERIES: z.coerce.number().int().positive().default(5),
  MAX_QUERY_ROWS: z.coerce.number().int().positive().default(500),
  MAX_EXECUTION_TIME_MS: z.coerce.number().int().positive().default(30000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export default parsed.data;
