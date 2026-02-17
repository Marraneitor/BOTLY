import { Subscription } from '../models/Subscription';

export const createSubscription = async (userId: string, planId: string) => {
    const subscription = await Subscription.create({
        userId,
        planId,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
    });
    return subscription;
};

export const getSubscriptionByUserId = async (userId: string) => {
    const subscription = await Subscription.findOne({ where: { userId } });
    return subscription;
};

export const updateSubscription = async (userId: string, updates: Partial<{ planId: string; status: string }>) => {
    const subscription = await Subscription.findOne({ where: { userId } });
    if (subscription) {
        await subscription.update(updates);
    }
    return subscription;
};

export const cancelSubscription = async (userId: string) => {
    const subscription = await Subscription.findOne({ where: { userId } });
    if (subscription) {
        await subscription.update({ status: 'canceled' });
    }
    return subscription;
};