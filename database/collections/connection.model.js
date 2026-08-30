import { Schema, model } from 'mongoose';

// A saved MySQL connection belonging to a user. Store only metadata plus an
// encrypted password; the plaintext password is delivered to the local agent
// only when an investigation targets it.
const connectionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    host: { type: String, required: true },
    port: { type: Number, default: 3306 },
    user: { type: String, required: true },
    passwordEnc: { type: String, required: true },
    useSsl: { type: Boolean, default: false },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

connectionSchema.index({ userId: 1, name: 1 }, { unique: true });

export const Connection = model('Connection', connectionSchema);
