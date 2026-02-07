import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";

export type RestClientConfig = {
    baseUrl: string;
    auth: "ON" | "OFF";
    password?: string;
    timeoutMs: number;
    keepAlive: boolean;
    maxSockets: number;
};

export type RestResponse = {
    status: number;
    data: unknown;
    headers: Record<string, string | string[] | undefined>;
    latencyMs: number;
    correlationId: string;
};

export class RestClient {
    private readonly client: AxiosInstance;
    private readonly auth: "ON" | "OFF";
    private readonly password?: string;

    constructor(config: RestClientConfig) {
        const httpAgent = new http.Agent({ keepAlive: config.keepAlive, maxSockets: config.maxSockets });
        const httpsAgent = new https.Agent({ keepAlive: config.keepAlive, maxSockets: config.maxSockets });

        this.client = axios.create({
            baseURL: config.baseUrl,
            timeout: config.timeoutMs,
            httpAgent,
            httpsAgent,
            validateStatus: () => true
        });
        this.auth = config.auth;
        this.password = config.password;
    }

    async request(config: AxiosRequestConfig): Promise<RestResponse> {
        const correlationId = randomUUID();
        const headers: Record<string, string> = {
            ...(config.headers as Record<string, string> | undefined),
            "X-Correlation-Id": correlationId
        };
        if (this.auth === "ON" && this.password) {
            headers["X-Password"] = this.password;
        }
        const start = Date.now();
        const response = await this.client.request({
            ...config,
            headers
        });
        const latencyMs = Date.now() - start;
        return {
            status: response.status,
            data: response.data,
            headers: response.headers,
            latencyMs,
            correlationId
        };
    }
}
