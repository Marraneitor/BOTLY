import { Schema, model } from 'mongoose';

const messageSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    botId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'Bot'
    },
    content: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['sent', 'delivered', 'read'],
        default: 'sent'
    }
});

const Message = model('Message', messageSchema);

export default Message;