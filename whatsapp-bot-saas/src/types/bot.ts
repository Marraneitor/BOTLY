export interface BotConfig {
    botName: string;
    webhookUrl: string;
    greetingMessage: string;
    fallbackMessage: string;
    language: string;
    enabled: boolean;
}

export interface Bot {
    id: string;
    userId: string;
    config: BotConfig;
    createdAt: Date;
    updatedAt: Date;
}