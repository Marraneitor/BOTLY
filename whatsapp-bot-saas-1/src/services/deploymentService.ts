import { Deployment } from '../models/Deployment';
import { Bot } from '../models/Bot';

export const deployBot = async (userId: string, botId: string) => {
    try {
        const bot = await Bot.findById(botId);
        if (!bot) {
            throw new Error('Bot not found');
        }

        const deployment = new Deployment({
            userId,
            botId,
            status: 'deployed',
            createdAt: new Date(),
        });

        await deployment.save();
        return deployment;
    } catch (error) {
        throw new Error(`Deployment failed: ${error.message}`);
    }
};

export const getDeploymentsByUser = async (userId: string) => {
    try {
        const deployments = await Deployment.find({ userId });
        return deployments;
    } catch (error) {
        throw new Error(`Failed to retrieve deployments: ${error.message}`);
    }
};

export const deleteDeployment = async (deploymentId: string) => {
    try {
        const result = await Deployment.findByIdAndDelete(deploymentId);
        if (!result) {
            throw new Error('Deployment not found');
        }
        return result;
    } catch (error) {
        throw new Error(`Failed to delete deployment: ${error.message}`);
    }
};