declare namespace Express {
    interface Request {
        user?: {
            id: string;
            name: string;
            role: string;
            firstTime: boolean;
            iat?: number;
            exp?: number;
            sub?: string;
        };
    }
}
