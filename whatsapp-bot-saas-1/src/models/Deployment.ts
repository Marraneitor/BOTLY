import { Schema, model } from 'mongoose';

const deploymentSchema = new Schema({
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
    botId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'Bot'
    },
    status: {
        type: String,
        enum: ['pending', 'active', 'inactive', 'failed'],
        default: 'pending'
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

const Deployment = model('Deployment', deploymentSchema);

export default Deployment;