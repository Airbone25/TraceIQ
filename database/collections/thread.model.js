import { Schema, model } from 'mongoose';

// An investigation thread. Tracks the user-selected target connection and
// database so the local agent knows what MySQL server to investigate.
const threadSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, default: 'New investigation' },
    connectionId: { type: Schema.Types.ObjectId, ref: 'Connection', default: null },
    database: { type: String, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

threadSchema.index({ userId: 1, updated_at: -1 });

export const Thread = model('Thread', threadSchema);
