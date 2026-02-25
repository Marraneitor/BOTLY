import { Schema, model } from 'mongoose';

const businessSchema = new Schema({
    name: {
        type: String,
        required: true,
    },
    owner: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    whatsappNumber: {
        type: String,
        required: true,
        unique: true,
    },
    configuration: {
        type: Object,
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

businessSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

const Business = model('Business', businessSchema);

export default Business;