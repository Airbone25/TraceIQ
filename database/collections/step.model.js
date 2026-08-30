import { Schema, model } from 'mongoose';

const stepSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    investigationId: { type: Schema.Types.ObjectId, ref: 'Investigation', required: true, index: true },
    stepNumber: { type: Number, default: 0 },
    toolName: { type: String, default: null },
    toolInput: { type: Schema.Types.Mixed, default: null },
    toolOutput: { type: Schema.Types.Mixed, default: null },
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: 'created_at' } }
);

stepSchema.index({ investigationId: 1, created_at: 1 });

export const Step = model('Step', stepSchema);
