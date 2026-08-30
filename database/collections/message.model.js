import { Schema, model } from 'mongoose';

const messageSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    threadId: { type: Schema.Types.ObjectId, ref: 'Thread', required: true, index: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, default: '' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

messageSchema.index({ threadId: 1, created_at: 1 });

export const Message = model('Message', messageSchema);
