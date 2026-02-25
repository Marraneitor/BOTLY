export interface UserCredentials {
    email: string;
    password: string;
}

export interface UserRegistration {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
}

export interface AuthResponse {
    token: string;
    user: {
        id: string;
        name: string;
        email: string;
    };
}