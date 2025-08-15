"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CircuitBreaker = void 0;
exports.handleAsync = handleAsync;
exports.withTimeout = withTimeout;
exports.withRetry = withRetry;
exports.withConcurrencyLimit = withConcurrencyLimit;
exports.debounce = debounce;
exports.throttle = throttle;
function handleAsync(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
function withTimeout(promise, timeoutMs) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Operation timeout after ${timeoutMs}ms`)), timeoutMs))
    ]);
}
async function withRetry(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            if (attempt === maxRetries) {
                throw error;
            }
            const delay = baseDelay * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}
async function withConcurrencyLimit(items, fn, limit = 5) {
    const results = [];
    for (let i = 0; i < items.length; i += limit) {
        const batch = items.slice(i, i + limit);
        const batchPromises = batch.map(fn);
        const batchResults = await Promise.allSettled(batchPromises);
        batchResults.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                results.push(result.value);
            }
            else {
                console.error(`Item ${i + index} failed:`, result.reason);
            }
        });
    }
    return results;
}
function debounce(func, waitMs) {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(null, args), waitMs);
    };
}
function throttle(func, limitMs) {
    let lastRun = 0;
    return (...args) => {
        if (Date.now() - lastRun >= limitMs) {
            func.apply(null, args);
            lastRun = Date.now();
        }
    };
}
class CircuitBreaker {
    constructor(fn, options) {
        this.fn = fn;
        this.options = options;
        this.failures = 0;
        this.lastFailTime = 0;
        this.state = 'CLOSED';
    }
    async execute(...args) {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailTime > this.options.retryTimeout) {
                this.state = 'HALF_OPEN';
            }
            else {
                throw new Error('Circuit breaker is OPEN');
            }
        }
        try {
            const result = await withTimeout(this.fn(...args), this.options.timeout);
            this.reset();
            return result;
        }
        catch (error) {
            this.recordFailure();
            throw error;
        }
    }
    recordFailure() {
        this.failures++;
        this.lastFailTime = Date.now();
        if (this.failures >= this.options.failureThreshold) {
            this.state = 'OPEN';
        }
    }
    reset() {
        this.failures = 0;
        this.state = 'CLOSED';
    }
    getState() {
        return this.state;
    }
    getFailures() {
        return this.failures;
    }
}
exports.CircuitBreaker = CircuitBreaker;
