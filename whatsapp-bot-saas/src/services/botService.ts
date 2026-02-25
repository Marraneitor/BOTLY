import { Bot } from '../models/Bot';
import { BotFlow } from '../models/BotFlow';
import { Deployment } from '../models/Deployment';
import { Message } from '../models/Message';

export const createBot = async (botData) => {
    const bot = await Bot.create(botData);
    return bot;
};

export const updateBot = async (botId, updateData) => {
    const bot = await Bot.findByIdAndUpdate(botId, updateData, { new: true });
    return bot;
};

export const deleteBot = async (botId) => {
    await Bot.findByIdAndDelete(botId);
};

export const getBotById = async (botId) => {
    const bot = await Bot.findById(botId);
    return bot;
};

export const createBotFlow = async (flowData) => {
    const flow = await BotFlow.create(flowData);
    return flow;
};

export const getBotFlows = async (botId) => {
    const flows = await BotFlow.find({ botId });
    return flows;
};

export const createDeployment = async (deploymentData) => {
    const deployment = await Deployment.create(deploymentData);
    return deployment;
};

export const getMessagesForBot = async (botId) => {
    const messages = await Message.find({ botId });
    return messages;
};