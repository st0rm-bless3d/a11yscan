export declare function getConfig(): {
    llm: {
        baseUrl: string;
        apiKey: string;
        model: string;
        timeoutMs: number;
        concurrency: number;
        maxRules: number;
        maxResponseBytes: number;
    };
    scan: {
        timeoutMs: number;
        userAgent: string;
    };
};
export type Config = ReturnType<typeof getConfig>;
