import { Schema, model } from 'mongoose';

const investigationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    threadId: { type: Schema.Types.ObjectId, ref: 'Thread', default: null, index: true },
    question: { type: String, required: true },
    status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued' },
    finalAnswer: { type: String, default: null },
    error: { type: String, default: null },
    steps: { type: Number, default: 0 },
    sqlQueries: { type: Number, default: 0 },
    llmCalls: { type: Number, default: 0 },
    llmDurationMs: { type: Number, default: 0 },
    toolDurationMs: { type: Number, default: 0 },
    totalDurationMs: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

investigationSchema.index({ userId: 1, created_at: -1 });

export const Investigation = model('Investigation', investigationSchema);
