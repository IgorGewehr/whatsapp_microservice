# 🚀 WhatsApp Microservice

Microserviço robusto para integração WhatsApp usando Baileys, projetado para DigitalOcean e aplicações que necessitam de sessões persistentes e QR codes funcionais.

## 🎯 Visão Geral

Este microserviço resolve os principais problemas de integração WhatsApp em aplicações modernas:

- **❌ Limitações Serverless**: Baileys não funciona em Netlify/Vercel
- **❌ Sessões Perdidas**: Deploy destrói conexões ativas
- **❌ QR Codes Instáveis**: Geração inconsistente em ambientes efêmeros

### ✅ Nossa Solução

- **🔥 Baileys Nativo**: Funciona 100% em servidor dedicado
- **⚡ Sessões Persistentes**: Mantém conexões entre deploys
- **🎯 Multi-tenant**: Isolamento completo por cliente
- **🔄 QR Persistente**: Geração contínua e confiável
- **🎪 Webhooks Automáticos**: Integração real-time com sua aplicação

## 📊 Arquitetura

```
┌─────────────────┐    REST API     ┌──────────────────┐    Baileys    ┌─────────────┐
│   Sua App       │ ──────────────► │ WhatsApp Server  │ ────────────► │   WhatsApp  │
│ (Netlify/Web)   │                 │ (DigitalOcean)   │               │     Web     │
└─────────────────┘                 └──────────────────┘               └─────────────┘
                                            │
                                            ▼
                                    ┌──────────────────┐
                                    │   Persistent     │
                                    │   Sessions       │
                                    │   Storage        │
                                    └──────────────────┘
```

## 🚀 Deploy Rápido (5 minutos)

### 1. Criar Droplet DigitalOcean

```bash
# Escolher configuração:
# - Ubuntu 22.04 LTS
# - Basic $6/mês (1GB RAM)
# - Região mais próxima
```

### 2. Configurar Servidor

```bash
# Conectar via SSH
ssh root@your-droplet-ip

# Script de setup completo
curl -fsSL https://raw.githubusercontent.com/your-repo/whatsapp-microservice/main/scripts/setup.sh | bash
```

### 3. Deploy da Aplicação

```bash
# Clonar e configurar
git clone https://github.com/your-repo/whatsapp-microservice.git /opt/whatsapp-microservice
cd /opt/whatsapp-microservice

# Instalar dependências
npm install

# Configurar ambiente
cp .env.example .env
nano .env
```

### 4. Configurar Variáveis Críticas

```bash
# .env essencial
NODE_ENV=production
PORT=3000
BASE_URL=http://your-droplet-ip:3000

# SEGURANÇA - Gerar com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=sua-chave-super-segura-64-caracteres-minimo
API_KEY=sua-api-key-segura

# CORS - Permitir sua aplicação
ALLOWED_ORIGINS=https://sua-app.netlify.app,https://seu-dominio.com

# WEBHOOK - Para receber mensagens
LOCAI_WEBHOOK_URL=https://sua-app.netlify.app/api/webhook/whatsapp
LOCAI_WEBHOOK_SECRET=segredo-compartilhado
```

### 5. Iniciar Serviço

```bash
# Build e deploy
npm run build
npm run deploy:setup

# Verificar funcionamento
curl http://localhost:3000/health
pm2 logs whatsapp-microservice
```

## 📱 Uso da API

### Autenticação

Todas as chamadas precisam do header:
```
Authorization: Bearer sua-api-key
```

### Iniciar Sessão WhatsApp

```bash
POST /api/v1/sessions/{tenantId}/start
```

```json
{
  "success": true,
  "sessionId": "tenant123_1673024400000",
  "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSU..."
}
```

### Status da Sessão

```bash
GET /api/v1/sessions/{tenantId}/status
```

```json
{
  "connected": true,
  "status": "connected",
  "phoneNumber": "+5511999999999",
  "qrCode": null,
  "lastActivity": "2024-01-01T12:00:00.000Z"
}
```

### Enviar Mensagem

```bash
POST /api/v1/messages/{tenantId}/send
Content-Type: application/json

{
  "to": "+5511999999999",
  "message": "Olá! Esta é uma mensagem via API.",
  "type": "text"
}
```

### Enviar Imagem

```bash
POST /api/v1/messages/{tenantId}/send
Content-Type: application/json

{
  "to": "+5511999999999",
  "message": "Confira esta imagem",
  "type": "image",
  "mediaUrl": "https://example.com/image.jpg",
  "caption": "Legenda da imagem"
}
```

## 🔗 Integração com Sua Aplicação

### 1. Client HTTP (Recomendado)

```typescript
// lib/whatsapp-client.ts
class WhatsAppClient {
  private baseUrl = process.env.WHATSAPP_MICROSERVICE_URL;
  private apiKey = process.env.WHATSAPP_API_KEY;

  async startSession(tenantId: string) {
    const response = await fetch(`${this.baseUrl}/api/v1/sessions/${tenantId}/start`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    return response.json();
  }

  async sendMessage(tenantId: string, to: string, message: string) {
    const response = await fetch(`${this.baseUrl}/api/v1/messages/${tenantId}/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to, message, type: 'text' })
    });
    return response.json();
  }
}
```

### 2. Webhook para Mensagens Recebidas

```typescript
// app/api/webhook/whatsapp/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validar assinatura do webhook
    const signature = request.headers.get('X-Webhook-Signature');
    if (!validateSignature(body, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    
    // Processar mensagem recebida
    if (body.event === 'message') {
      await processIncomingMessage(body.tenantId, body.data);
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Webhook failed' }, { status: 500 });
  }
}
```

### 3. Configurar Variáveis na Sua App

```bash
# Netlify/Vercel Environment Variables
WHATSAPP_MICROSERVICE_URL=http://your-droplet-ip:3000
WHATSAPP_API_KEY=sua-api-key-segura
WHATSAPP_USE_EXTERNAL=true
```

## 🛠️ Recursos Avançados

### Multi-tenant por Design

```typescript
// Cada tenant tem sessão isolada
const client = new WhatsAppClient();
await client.startSession('tenant_empresa_a');
await client.startSession('tenant_empresa_b');
// Sessões completamente separadas
```

### QR Code Persistente

- **🔄 Regeneração automática** quando expira
- **💾 Persistência em cache** para performance
- **🎯 Integração com frontend** via polling ou SSE

### Webhooks Automáticos

- **📡 Auto-registro** quando sessão é criada
- **🔔 Eventos em tempo real** para sua aplicação
- **🔒 Validação de assinatura** para segurança

### Monitoramento Integrado

```bash
# Logs em tempo real
pm2 logs whatsapp-microservice

# Métricas de performance
pm2 monit

# Health check automático
curl http://localhost:3000/health
```

## 🚦 Comandos Essenciais

### Gerenciar Aplicação

```bash
# Ver logs
pm2 logs whatsapp-microservice

# Reiniciar
pm2 restart whatsapp-microservice

# Parar
pm2 stop whatsapp-microservice

# Status detalhado
pm2 show whatsapp-microservice
```

### Atualizações

```bash
# Atualizar código
cd /opt/whatsapp-microservice
git pull
npm install
npm run build
pm2 reload whatsapp-microservice
```

### Troubleshooting

```bash
# Verificar porta
netstat -tlnp | grep 3000

# Verificar conectividade externa
curl -I http://your-droplet-ip:3000/health

# Limpar sessões problemáticas
rm -rf /opt/whatsapp-microservice/sessions/*
pm2 restart whatsapp-microservice
```

## 🔒 Segurança

### Firewall Configurado

```bash
# Apenas portas essenciais abertas
ufw allow ssh
ufw allow 3000
ufw enable
```

### Autenticação Obrigatória

- **🔑 API Key** para todas as chamadas
- **🔐 JWT Secret** para tokens internos
- **🛡️ Rate limiting** contra abuso

### CORS Restritivo

- **✅ Apenas domínios autorizados**
- **❌ Bloqueio de origens não confiáveis**

## 📈 Performance

### Otimizações Implementadas

- **⚡ Cache NodeCache** para QR codes
- **🔄 Conexões persistentes** com Baileys
- **📦 Build otimizado** para produção
- **🎯 PM2 clustering** quando necessário

### Capacidade

- **👥 Múltiplos tenants** simultâneos
- **📱 +100 mensagens/min** por tenant
- **💾 1GB RAM** suporta 10-20 sessões ativas

## 🎁 Recursos Extras

### Docker Support

```bash
# Build da imagem
docker build -t whatsapp-microservice .

# Executar container
docker run -d \
  --name whatsapp-service \
  -p 3000:3000 \
  -v $(pwd)/sessions:/app/sessions \
  -v $(pwd)/.env:/app/.env \
  whatsapp-microservice
```

### Deploy Automatizado

```bash
# PM2 ecosystem configurado
pm2 deploy production setup
pm2 deploy production
```

### Backup de Sessões

```bash
# Backup automático das sessões
0 2 * * * tar -czf /backup/sessions-$(date +\%Y\%m\%d).tar.gz /opt/whatsapp-microservice/sessions/
```

## 🏆 Casos de Uso

### ✅ E-commerce
- Confirmação de pedidos
- Status de entrega
- Suporte ao cliente

### ✅ SaaS/LocAI
- Notificações de usuários
- Relatórios automáticos
- Alertas de sistema

### ✅ Marketing
- Campanhas direcionadas
- Follow-up de leads
- Newsletter via WhatsApp

### ✅ Atendimento
- Chatbots inteligentes
- Triagem automática
- Escalamento para humanos

## 📚 Stack Tecnológica

### Core

- **Node.js 20+** - Runtime moderno
- **TypeScript** - Tipagem estática
- **Express.js** - Framework web
- **Baileys** - WhatsApp Web API

### Segurança

- **Helmet** - Cabeçalhos de segurança
- **CORS** - Controle de origem
- **Rate Limiting** - Proteção DDoS
- **JWT** - Autenticação

### Infraestrutura

- **PM2** - Process manager
- **Pino** - Logging estruturado
- **NodeCache** - Cache em memória
- **Docker** - Containerização

## 🤝 Suporte

### Documentação

- **📖 API Docs**: `GET /docs`
- **💚 Health Check**: `GET /health`
- **📊 Status**: `GET /api/v1/sessions/{tenantId}/status`

### Logs Estruturados

```bash
# Todos os eventos importantes são logados
{
  "level": "info",
  "time": "2024-01-01T12:00:00.000Z",
  "msg": "WhatsApp connected successfully",
  "tenantId": "tenant123***",
  "phone": "+5511***"
}
```

## 🚀 Próximos Passos

1. **✅ Deploy inicial** seguindo o guia acima
2. **✅ Testar QR codes** e conexão
3. **✅ Integrar com sua aplicação** via REST API
4. **✅ Configurar webhooks** para mensagens
5. **✅ Monitorar produção** com PM2
6. **✅ Configurar backups** das sessões

---

**🎉 Resultado**: Sua aplicação terá WhatsApp funcionando 100% de forma nativa, persistente e escalável!