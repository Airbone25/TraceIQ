import { z } from 'zod';

await import('dotenv/config');

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  // MongoDB Atlas connection string.
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  // Envelope key (64 hex chars) used to encrypt Groq keys and MySQL connection
  // passwords before storing them in Mongo.
  DATA_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/, 'DATA_ENCRYPTION_KEY must be a 64-char lowercase hex string (openssl rand -hex 32)'),
  // Secret used to sign/verify JWTs issued at login.
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid cloud API environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export default parsed.data;
