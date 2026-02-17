import { Schema, model } from 'mongoose';

const subscriptionSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    planId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'Plan'
    },
    startDate: {
        type: Date,
        default: Date.now
    },
    endDate: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'cancelled'],
        default: 'active'
    }
});

const Subscription = model('Subscription', subscriptionSchema);

export default Subscription;