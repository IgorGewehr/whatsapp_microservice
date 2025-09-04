import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Schema de validação para variáveis de ambiente
const configSchema = z.object({
  // Configurações básicas do servidor
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  BASE_URL: z.string().default('http://localhost:3000'),
  
  // Autenticação
  JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres'),
  API_KEY: z.string().min(16, 'API_KEY deve ter pelo menos 16 caracteres'),
  REQUIRE_AUTH: z.coerce.boolean().default(true),
  
  // CORS
  ALLOWED_ORIGINS: z.string().default('*'),
  
  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  
  // WhatsApp/Baileys configurações
  WHATSAPP_SESSION_DIR: z.string().default('./sessions'),
  WHATSAPP_TIMEOUT: z.coerce.number().default(60000), // 60 segundos
  QR_TIMEOUT: z.coerce.number().default(120000), // 2 minutos
  MAX_RECONNECT_ATTEMPTS: z.coerce.number().default(5),
  
  // Webhooks para notificar o LocAI
  LOCAI_WEBHOOK_URL: z.string().url().optional(),
  LOCAI_WEBHOOK_SECRET: z.string().optional(),
  
  // Rate limiting
  RATE_LIMIT_WINDOW: z.coerce.number().default(15 * 60 * 1000), // 15 minutos
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  
  // File upload
  MAX_FILE_SIZE: z.coerce.number().default(10 * 1024 * 1024), // 10MB
  UPLOAD_DIR: z.string().default('./uploads'),
  
  // Monitoring
  ENABLE_METRICS: z.coerce.boolean().default(true),
  METRICS_PORT: z.coerce.number().default(9090),
  
  // Cache
  CACHE_TTL: z.coerce.number().default(300), // 5 minutos
  
  // Database (opcional, para persistir dados)
  DATABASE_URL: z.string().optional(),
  
  // DigitalOcean específico
  DO_SPACES_ENDPOINT: z.string().optional(),
  DO_SPACES_ACCESS_KEY: z.string().optional(),
  DO_SPACES_SECRET_KEY: z.string().optional(),
  DO_SPACES_BUCKET: z.string().optional(),
  
  // Transcrição de áudio
  TRANSCRIPTION_ENABLED: z.coerce.boolean().default(false),
  TRANSCRIPTION_PROVIDER: z.enum(['openai', 'google', 'local']).default('openai'),
  TRANSCRIPTION_API_KEY: z.string().optional(),
  TRANSCRIPTION_MODEL: z.string().default('whisper-1'),
  TRANSCRIPTION_LANGUAGE: z.string().default('pt'),
});

// Validar e carregar configurações
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
  
  TRANSCRIPTION_ENABLED: process.env.TRANSCRIPTION_ENABLED,
  TRANSCRIPTION_PROVIDER: process.env.TRANSCRIPTION_PROVIDER,
  TRANSCRIPTION_API_KEY: process.env.TRANSCRIPTION_API_KEY,
  TRANSCRIPTION_MODEL: process.env.TRANSCRIPTION_MODEL,
  TRANSCRIPTION_LANGUAGE: process.env.TRANSCRIPTION_LANGUAGE,
};

// Parsear e validar configurações
let parsedConfig: z.infer<typeof configSchema>;

try {
  parsedConfig = configSchema.parse(rawConfig);
} catch (error) {
  console.error('❌ Erro na configuração de environment variables:');
  if (error instanceof z.ZodError) {
    error.errors.forEach((err) => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`);
    });
  } else {
    console.error(error);
  }
  process.exit(1);
}

// Processar ALLOWED_ORIGINS
const allowedOrigins = parsedConfig.ALLOWED_ORIGINS === '*' 
  ? true 
  : parsedConfig.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());

// Exportar configuração final
export const config = {
  ...parsedConfig,
  ALLOWED_ORIGINS: allowedOrigins,
  
  // Configurações derivadas
  IS_PRODUCTION: parsedConfig.NODE_ENV === 'production',
  IS_DEVELOPMENT: parsedConfig.NODE_ENV === 'development',
  
  // Configurações de Baileys otimizadas para DigitalOcean
  BAILEYS_CONFIG: {
    connectTimeoutMs: parsedConfig.WHATSAPP_TIMEOUT,
    qrTimeout: parsedConfig.QR_TIMEOUT,
    defaultQueryTimeoutMs: 30000,
    keepAliveIntervalMs: 30000,
    markOnlineOnConnect: true,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    printQRInTerminal: false,
    browser: ['LocAI WhatsApp Service', 'Chrome', '120.0.0'] as [string, string, string],
  }
};

// Validar configurações críticas no ambiente de produção
if (config.IS_PRODUCTION) {
  const criticalConfigs = ['JWT_SECRET', 'API_KEY'];
  const missing = criticalConfigs.filter(key => !config[key as keyof typeof config]);
  
  if (missing.length > 0) {
    console.error(`❌ Configurações críticas faltando para produção: ${missing.join(', ')}`);
    process.exit(1);
  }
  
  if (config.JWT_SECRET.length < 64) {
    console.error('❌ JWT_SECRET deve ter pelo menos 64 caracteres em produção');
    process.exit(1);
  }
}

console.log('✅ Configurações carregadas com sucesso');
console.log(`🌍 Environment: ${config.NODE_ENV}`);
console.log(`🚀 Server: ${config.HOST}:${config.PORT}`);
console.log(`🔐 Auth required: ${config.REQUIRE_AUTH ? 'Yes' : 'No'}`);
console.log(`📁 Sessions dir: ${config.WHATSAPP_SESSION_DIR}`);

export type Config = typeof config;