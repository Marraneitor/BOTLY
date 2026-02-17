export interface WhatsAppConfig {
    apiKey: string;
    phoneNumber: string;
    webhookUrl: string;
    messageTemplate: string;
    language: string;
}

export interface WhatsAppMessage {
    to: string;
    from: string;
    body: string;
    timestamp: Date;
}

export interface WhatsAppResponse {
    status: string;
    messageId: string;
    error?: string;
}