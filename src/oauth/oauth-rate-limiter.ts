export class OAuthRateLimiter {
    private requests = new Map<string, number[]>();

    constructor(
        private maxRequests = 30,
        private readonly windowMs = 60_000,
    ) {}

    setMaxRequests(maxRequests: number): void {
        this.maxRequests = maxRequests;
    }

    allow(
        key: string,
        now = Date.now(),
    ): {
        allowed: boolean;
        retryAfterSeconds: number;
    } {
        if (this.maxRequests <= 0) {
            return { allowed: true, retryAfterSeconds: 0 };
        }

        const cutoff = now - this.windowMs;
        const timestamps = (this.requests.get(key) ?? []).filter(
            (t) => t > cutoff,
        );

        if (timestamps.length >= this.maxRequests) {
            const oldest = timestamps[0] ?? now;
            const retryAfterSeconds = Math.max(
                1,
                Math.ceil((oldest + this.windowMs - now) / 1000),
            );
            this.requests.set(key, timestamps);
            return { allowed: false, retryAfterSeconds };
        }

        timestamps.push(now);
        this.requests.set(key, timestamps);
        return { allowed: true, retryAfterSeconds: 0 };
    }

    reset(): void {
        this.requests.clear();
    }
}
