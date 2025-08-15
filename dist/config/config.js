"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const zod_1 = require("zod");
dotenv_1.default.config();
const configSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    PORT: zod_1.z.coerce.number().default(3000),
    HOST: zod_1.z.string().default('0.0.0.0'),
    BASE_URL: zod_1.z.string().default('http://localhost:3000'),
    JWT_SECRET: zod_1.z.string().min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres'),
    API_KEY: zod_1.z.string().min(16, 'API_KEY deve ter pelo menos 16 caracteres'),
    REQUIRE_AUTH: zod_1.z.coerce.boolean().default(true),
    ALLOWED_ORIGINS: zod_1.z.string().default('*'),
    LOG_LEVEL: zod_1.z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    WHATSAPP_SESSION_DIR: zod_1.z.string().default('./sessions'),
    WHATSAPP_TIMEOUT: zod_1.z.coerce.number().default(60000),
    QR_TIMEOUT: zod_1.z.coerce.number().default(120000),
    MAX_RECONNECT_ATTEMPTS: zod_1.z.coerce.number().default(5),
    LOCAI_WEBHOOK_URL: zod_1.z.string().url().optional(),
    LOCAI_WEBHOOK_SECRET: zod_1.z.string().optional(),
    RATE_LIMIT_WINDOW: zod_1.z.coerce.number().default(15 * 60 * 1000),
    RATE_LIMIT_MAX: zod_1.z.coerce.number().default(100),
    MAX_FILE_SIZE: zod_1.z.coerce.number().default(10 * 1024 * 1024),
    UPLOAD_DIR: zod_1.z.string().default('./uploads'),
    ENABLE_METRICS: zod_1.z.coerce.boolean().default(true),
    METRICS_PORT: zod_1.z.coerce.number().default(9090),
    CACHE_TTL: zod_1.z.coerce.number().default(300),
    DATABASE_URL: zod_1.z.string().optional(),
    DO_SPACES_ENDPOINT: zod_1.z.string().optional(),
    DO_SPACES_ACCESS_KEY: zod_1.z.string().optional(),
    DO_SPACES_SECRET_KEY: zod_1.z.string().optional(),
    DO_SPACES_BUCKET: zod_1.z.string().optional(),
});
const rawConfig = {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    HOST: process.env.HOST,
    BASE_URL: process.env.BASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    API_KEY: process.env.API_KEY || process.env.WHATSAPP_API_KEY,
    REQUIRE_AUTH: process.env.REQUIRE_AUTH,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    LOG_LEVEL: process.env.LOG_LEVEL,
    WHATSAPP_SESSION_DIR: process.env.WHATSAPP_SESSION_DIR,
    WHATSAPP_TIMEOUT: process.env.WHATSAPP_TIMEOUT,
    QR_TIMEOUT: process.env.QR_TIMEOUT,
    MAX_RECONNECT_ATTEMPTS: process.env.MAX_RECONNECT_ATTEMPTS,
    LOCAI_WEBHOOK_URL: process.env.LOCAI_WEBHOOK_URL,
    LOCAI_WEBHOOK_SECRET: process.env.LOCAI_WEBHOOK_SECRET,
    RATE_LIMIT_WINDOW: process.env.RATE_LIMIT_WINDOW,
    RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX,
    MAX_FILE_SIZE: process.env.MAX_FILE_SIZE,
    UPLOAD_DIR: process.env.UPLOAD_DIR,
    ENABLE_METRICS: process.env.ENABLE_METRICS,
    METRICS_PORT: process.env.METRICS_PORT,
    CACHE_TTL: process.env.CACHE_TTL,
    DATABASE_URL: process.env.DATABASE_URL,
    DO_SPACES_ENDPOINT: process.env.DO_SPACES_ENDPOINT,
    DO_SPACES_ACCESS_KEY: process.env.DO_SPACES_ACCESS_KEY,
    DO_SPACES_SECRET_KEY: process.env.DO_SPACES_SECRET_KEY,
    DO_SPACES_BUCKET: process.env.DO_SPACES_BUCKET,
};
let parsedConfig;
try {
    parsedConfig = configSchema.parse(rawConfig);
}
catch (error) {
    console.error('❌ Erro na configuração de environment variables:');
    if (error instanceof zod_1.z.ZodError) {
        error.errors.forEach((err) => {
            console.error(`  - ${err.path.join('.')}: ${err.message}`);
        });
    }
    else {
        console.error(error);
    }
    process.exit(1);
}
const allowedOrigins = parsedConfig.ALLOWED_ORIGINS === '*'
    ? true
    : parsedConfig.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
exports.config = {
    ...parsedConfig,
    ALLOWED_ORIGINS: allowedOrigins,
    IS_PRODUCTION: parsedConfig.NODE_ENV === 'production',
    IS_DEVELOPMENT: parsedConfig.NODE_ENV === 'development',
    BAILEYS_CONFIG: {
        connectTimeoutMs: parsedConfig.WHATSAPP_TIMEOUT,
        qrTimeout: parsedConfig.QR_TIMEOUT,
        defaultQueryTimeoutMs: 30000,
        keepAliveIntervalMs: 30000,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        printQRInTerminal: false,
        browser: ['LocAI WhatsApp Service', 'Chrome', '120.0.0'],
    }
};
if (exports.config.IS_PRODUCTION) {
    const criticalConfigs = ['JWT_SECRET', 'API_KEY'];
    const missing = criticalConfigs.filter(key => !exports.config[key]);
    if (missing.length > 0) {
        console.error(`❌ Configurações críticas faltando para produção: ${missing.join(', ')}`);
        process.exit(1);
    }
    if (exports.config.JWT_SECRET.length < 64) {
        console.error('❌ JWT_SECRET deve ter pelo menos 64 caracteres em produção');
        process.exit(1);
    }
}
console.log('✅ Configurações carregadas com sucesso');
console.log(`🌍 Environment: ${exports.config.NODE_ENV}`);
console.log(`🚀 Server: ${exports.config.HOST}:${exports.config.PORT}`);
console.log(`🔐 Auth required: ${exports.config.REQUIRE_AUTH ? 'Yes' : 'No'}`);
console.log(`📁 Sessions dir: ${exports.config.WHATSAPP_SESSION_DIR}`);
