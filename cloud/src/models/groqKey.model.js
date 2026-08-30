import { Schema, model } from 'mongoose';

// A Groq ("block") API key belonging to a user. The raw key is encrypted at
// rest with the server DATA_ENCRYPTION_KEY and never returned in plaintext.
const groqKeySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, default: 'default' },
    apiKeyEnc: { type: String, required: true },
    model: { type: String, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const GroqKey = model('GroqKey', groqKeySchema);
