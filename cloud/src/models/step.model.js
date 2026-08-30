import { Schema, model } from 'mongoose';

const stepSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    investigationId: { type: Schema.Types.ObjectId, ref: 'Investigation', required: true, index: true },
    type: { type: String, default: 'tool' },
    tool: { type: String, default: null },
    input: { type: Schema.Types.Mixed, default: null },
    result: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: ['running', 'completed', 'failed'], default: 'completed' },
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: 'created_at' } }
);

stepSchema.index({ investigationId: 1, created_at: 1 });

export const Step = model('Step', stepSchema);
