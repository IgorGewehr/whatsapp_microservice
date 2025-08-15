"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatusService = void 0;
const fs_1 = require("fs");
const os_1 = __importDefault(require("os"));
class StatusService {
    constructor(logger) {
        this.logger = logger.child({ service: 'StatusService' });
        this.startTime = Date.now();
    }
    async getSystemHealth() {
        const services = await this.checkServices();
        const system = await this.getSystemMetrics();
        const serviceStatuses = Object.values(services).map(s => s.status);
        let overallStatus;
        if (serviceStatuses.every(s => s === 'up')) {
            overallStatus = 'healthy';
        }
        else if (serviceStatuses.some(s => s === 'up')) {
            overallStatus = 'degraded';
        }
        else {
            overallStatus = 'unhealthy';
        }
        if (system.memory.percentage > 90 || system.disk.percentage > 95) {
            overallStatus = overallStatus === 'healthy' ? 'degraded' : 'unhealthy';
        }
        return {
            status: overallStatus,
            timestamp: new Date().toISOString(),
            uptime: Date.now() - this.startTime,
            version: process.env.npm_package_version || '1.0.0',
            environment: process.env.NODE_ENV || 'development',
            services,
            system
        };
    }
    async checkServices() {
        const services = {};
        const now = new Date().toISOString();
        try {
            const startTime = Date.now();
            const baileys = await Promise.resolve().then(() => __importStar(require('@whiskeysockets/baileys')));
            const responseTime = Date.now() - startTime;
            services.baileys = {
                status: baileys ? 'up' : 'down',
                responseTime,
                lastCheck: now,
                details: {
                    version: baileys.version || 'unknown',
                    loaded: !!baileys.default
                }
            };
        }
        catch (error) {
            const err = error;
            services.baileys = {
                status: 'down',
                lastCheck: now,
                details: { error: err.message }
            };
        }
        try {
            const startTime = Date.now();
            const qrcode = require('qrcode');
            const responseTime = Date.now() - startTime;
            services.qrcode = {
                status: qrcode && typeof qrcode.toDataURL === 'function' ? 'up' : 'down',
                responseTime,
                lastCheck: now,
                details: {
                    hasToDataURL: typeof qrcode.toDataURL === 'function'
                }
            };
        }
        catch (error) {
            const err = error;
            services.qrcode = {
                status: 'down',
                lastCheck: now,
                details: { error: err.message }
            };
        }
        try {
            const startTime = Date.now();
            const testPath = './sessions';
            await fs_1.promises.mkdir(testPath, { recursive: true });
            const testFile = `${testPath}/.health-check`;
            await fs_1.promises.writeFile(testFile, 'health-check');
            await fs_1.promises.unlink(testFile);
            const responseTime = Date.now() - startTime;
            services.filesystem = {
                status: 'up',
                responseTime,
                lastCheck: now,
                details: { path: testPath }
            };
        }
        catch (error) {
            const err = error;
            services.filesystem = {
                status: 'down',
                lastCheck: now,
                details: { error: err.message }
            };
        }
        return services;
    }
    async getSystemMetrics() {
        const memInfo = process.memoryUsage();
        const totalMem = os_1.default.totalmem();
        const freeMem = os_1.default.freemem();
        const usedMem = totalMem - freeMem;
        const cpuUsage = process.cpuUsage();
        const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000;
        let diskUsed = 0;
        let diskTotal = 0;
        try {
            const stats = await fs_1.promises.stat(process.cwd());
            diskTotal = 1000000000;
            diskUsed = stats.size || 0;
        }
        catch (error) {
        }
        return {
            memory: {
                used: usedMem,
                total: totalMem,
                percentage: Math.round((usedMem / totalMem) * 100)
            },
            cpu: {
                usage: Math.round(cpuPercent)
            },
            disk: {
                used: diskUsed,
                total: diskTotal,
                percentage: diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0
            }
        };
    }
    async getDetailedStatus() {
        const health = await this.getSystemHealth();
        return {
            health,
            process: {
                pid: process.pid,
                uptime: process.uptime(),
                nodeVersion: process.version,
                platform: os_1.default.platform(),
                arch: os_1.default.arch()
            },
            environment: {
                NODE_ENV: process.env.NODE_ENV,
                PORT: process.env.PORT,
                HOST: process.env.HOST,
                LOG_LEVEL: process.env.LOG_LEVEL
            }
        };
    }
    getUptime() {
        return Date.now() - this.startTime;
    }
    isHealthy() {
        return this.getSystemHealth().then(health => health.status === 'healthy');
    }
}
exports.StatusService = StatusService;
