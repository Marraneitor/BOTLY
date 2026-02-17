import { Schema, model } from 'mongoose';

const botFlowSchema = new Schema({
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
    flowName: {
        type: String,
        required: true
    },
    steps: [
        {
            stepType: {
                type: String,
                required: true
            },
            content: {
                type: String,
                required: true
            },
            nextStep: {
                type: Schema.Types.ObjectId,
                ref: 'BotFlow'
            }
        }
    ],
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

export const BotFlow = model('BotFlow', botFlowSchema);