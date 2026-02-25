export type User = {
    id: string;
    username: string;
    password: string;
    email: string;
    createdAt: Date;
    updatedAt: Date;
};

export type Business = {
    id: string;
    userId: string;
    name: string;
    description: string;
    createdAt: Date;
    updatedAt: Date;
};

export type Bot = {
    id: string;
    businessId: string;
    name: string;
    configuration: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
};

export type BotFlow = {
    id: string;
    botId: string;
    flowData: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
};

export type Deployment = {
    id: string;
    botId: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
};

export type Message = {
    id: string;
    botId: string;
    content: string;
    createdAt: Date;
};

export type Subscription = {
    id: string;
    userId: string;
    plan: string;
    startDate: Date;
    endDate: Date;
};