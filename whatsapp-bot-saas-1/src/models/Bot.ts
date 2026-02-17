import { Schema, model } from 'mongoose';

const botSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    businessId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'Business'
    },
    botName: {
        type: String,
        required: true
    },
    botToken: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

const Bot = model('Bot', botSchema);

export default Bot;