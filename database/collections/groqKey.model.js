import { Schema, model } from 'mongoose';

// A Groq API key belonging to a user. The raw key is encrypted at rest with the
// app APP_SECRET and never returned in plaintext except to the local agent.
const groqKeySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, default: 'default' },
    apiKeyEnc: { type: String, default: null },
    model: { type: String, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const GroqKey = model('GroqKey', groqKeySchema);
