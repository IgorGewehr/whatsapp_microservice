# 🚀 WhatsApp Microservice para DigitalOcean

Microserviço dedicado para WhatsApp usando Baileys, projetado para funcionar perfeitamente no DigitalOcean e integrar com aplicações Next.js como o LocAI.

## 🎯 **Por que este microserviço?**

### ❌ **Problemas com Serverless (Netlify/Vercel)**
- Baileys não funciona em ambientes serverless
- Sessões perdidas a cada deploy
- WebSockets não persistem
- File system efêmero

### ✅ **Solução: Servidor Dedicado**
- Baileys funciona 100% nativo
- Sessões persistentes
- WebSockets mantidos vivos
- File system real
- Multi-tenant robusto

## 🏗️ **Arquitetura**

```
┌─────────────────┐    HTTP/REST    ┌──────────────────┐    Baileys    ┌─────────────┐
│   LocAI App     │ ────────────► │ WhatsApp Server  │ ────────────► │   WhatsApp  │
│  (Netlify)      │               │ (DigitalOcean)   │               │     Web     │
└─────────────────┘               └──────────────────┘               └─────────────┘
                                          │
                                          ▼
                                  ┌──────────────────┐
                                  │   Persistent     │
                                  │   Sessions       │
                                  │  (.sessions/)    │
                                  └──────────────────┘
```

## 🚀 **Deploy no DigitalOcean (Guia Completo)**

### **Passo 1: Criar Droplet**

1. **Acesse DigitalOcean** → Create → Droplets
2. **Escolha imagem**: Ubuntu 22.04 (LTS) x64
3. **Tamanho**: Basic ($6/mês - 1GB RAM, 25GB SSD)
4. **Região**: Escolha mais próxima do seu usuário
5. **SSH Key**: Configure ou use password
6. **Nome**: `whatsapp-microservice`
7. **Create Droplet**

### **Passo 2: Configurar Servidor**

```bash
# Conectar via SSH
ssh root@your-droplet-ip

# Atualizar sistema
apt update && apt upgrade -y

# Instalar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt-get install -y nodejs

# Verificar instalação
node --version  # v20.x.x
npm --version   # 10.x.x

# Instalar PM2 (Process Manager)
npm install -g pm2

# Instalar dependências do sistema para Baileys
apt-get install -y python3 make g++ libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev

# Criar diretório da aplicação
mkdir -p /opt/whatsapp-microservice
cd /opt/whatsapp-microservice

# Configurar firewall
ufw enable
ufw allow ssh
ufw allow 3000
ufw allow 80
ufw allow 443
```

### **Passo 3: Deploy da Aplicação**

```bash
# Clonar o projeto (ou fazer upload)
# Opção 1: Git (recomendado)
git clone https://github.com/your-repo/whatsapp-microservice.git .

# Opção 2: Upload via SCP
# No seu computador local:
# scp -r ./whatsapp-microservice root@your-droplet-ip:/opt/whatsapp-microservice

# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env
nano .env
```

### **Passo 4: Configurar .env (CRÍTICO)**

```bash
# Editar arquivo .env
nano .env
```

```bash
# ===== CONFIGURAÇÃO PARA DIGITALOCEAN =====
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
BASE_URL=http://your-droplet-ip:3000

# ===== SEGURANÇA (GERAR NOVAS!) =====
JWT_SECRET=generate-a-super-secure-secret-64-chars-minimum-for-production
API_KEY=generate-a-secure-api-key-for-your-locai-integration

# ===== CORS (PERMITIR SEU LOCAI) =====
ALLOWED_ORIGINS=https://your-locai-domain.netlify.app,https://your-custom-domain.com

# ===== LOCAI INTEGRATION =====
LOCAI_WEBHOOK_URL=https://your-locai-domain.netlify.app/api/webhook/whatsapp-web
LOCAI_WEBHOOK_SECRET=shared-secret-with-your-locai-app

# ===== OUTRAS CONFIGURAÇÕES =====
LOG_LEVEL=info
REQUIRE_AUTH=true
WHATSAPP_SESSION_DIR=/opt/whatsapp-microservice/sessions
MAX_FILE_SIZE=10485760
UPLOAD_DIR=/opt/whatsapp-microservice/uploads
```

### **Passo 5: Build e Iniciar**

```bash
# Build da aplicação
npm run build

# Criar diretórios necessários
mkdir -p sessions uploads logs
chmod 755 sessions uploads logs

# Iniciar com PM2
pm2 start ecosystem.config.js

# Configurar PM2 para iniciar automaticamente
pm2 startup
pm2 save

# Verificar status
pm2 status
pm2 logs whatsapp-microservice
```

### **Passo 6: Testar Funcionamento**

```bash
# Health check
curl http://localhost:3000/health
# Deve retornar: {"status":"healthy",...}

# Documentação da API
curl http://localhost:3000/docs

# Testar externamente
curl http://your-droplet-ip:3000/health
```

## 🔗 **Integração com LocAI**

### **1. Configurar Client no LocAI**

```typescript
// No seu LocAI, adicionar em lib/whatsapp/whatsapp-client-factory.ts
import { ExternalClientAdapter } from './external-client-adapter';

export function createWhatsAppClient(tenantId: string) {
  // Se microserviço está configurado, usar client externo
  if (process.env.WHATSAPP_MICROSERVICE_URL) {
    return new ExternalClientAdapter(tenantId);
  }
  
  // Fallback para implementação local (se disponível)
  return new WhatsAppClient(tenantId);
}
```

### **2. Configurar Variáveis no Netlify**

No painel do Netlify → Site settings → Environment variables:

```bash
WHATSAPP_MICROSERVICE_URL=http://your-droplet-ip:3000
WHATSAPP_MICROSERVICE_API_KEY=your-secure-api-key-from-microservice
WHATSAPP_USE_EXTERNAL=true
```

### **3. Configurar Webhook no LocAI**

```typescript
// app/api/webhook/whatsapp-microservice/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { processIncomingWhatsAppMessage } from '@/lib/whatsapp/message-processor';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validar assinatura do webhook
    const signature = request.headers.get('X-Webhook-Signature');
    if (!validateWebhookSignature(body, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    
    // Processar evento do WhatsApp
    if (body.event === 'message') {
      await processIncomingWhatsAppMessage(body.tenantId, body.data);
    } else if (body.event === 'status_change') {
      // Atualizar status da conexão
      await updateConnectionStatus(body.tenantId, body.data);
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Webhook failed' }, { status: 500 });
  }
}
```

## 🔧 **Comandos Úteis**

### **Gerenciar Aplicação**
```bash
# Ver logs em tempo real
pm2 logs whatsapp-microservice

# Reiniciar aplicação
pm2 restart whatsapp-microservice

# Parar aplicação
pm2 stop whatsapp-microservice

# Ver status detalhado
pm2 show whatsapp-microservice

# Monitorar recursos
pm2 monit
```

### **Manutenção**
```bash
# Limpar logs antigos
pm2 flush whatsapp-microservice

# Atualizar aplicação
cd /opt/whatsapp-microservice
git pull
npm install
npm run build
pm2 reload whatsapp-microservice

# Ver uso de recursos
df -h  # Disk usage
free -h  # Memory usage
htop  # CPU usage
```

### **Troubleshooting**
```bash
# Verificar portas
netstat -tlnp | grep 3000

# Verificar processo
ps aux | grep node

# Verificar logs do sistema
tail -f /var/log/syslog

# Verificar conectividade
curl -I http://localhost:3000/health
```

## 📊 **Endpoints da API**

### **Sessões**
```bash
# Iniciar sessão
POST /api/v1/sessions/{tenantId}/start
Authorization: Bearer {api_key}

# Status da sessão
GET /api/v1/sessions/{tenantId}/status

# QR Code
GET /api/v1/sessions/{tenantId}/qr

# Desconectar
DELETE /api/v1/sessions/{tenantId}

# Reiniciar
POST /api/v1/sessions/{tenantId}/restart
```

### **Mensagens**
```bash
# Enviar mensagem de texto
POST /api/v1/messages/{tenantId}/send
{
  "to": "+5511999999999",
  "message": "Olá!",
  "type": "text"
}

# Enviar imagem
POST /api/v1/messages/{tenantId}/send
{
  "to": "+5511999999999",
  "message": "Confira esta imagem",
  "type": "image",
  "mediaUrl": "https://example.com/image.jpg"
}
```

### **Webhooks**
```bash
# Registrar webhook
POST /api/v1/webhooks/register/{tenantId}
{
  "url": "https://your-locai.netlify.app/api/webhook/whatsapp",
  "secret": "shared-secret",
  "events": ["message", "status"]
}
```

## 🔒 **Segurança**

### **Firewall**
```bash
# Configurar UFW
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 3000
ufw enable
```

### **SSL/TLS (Opcional com Nginx)**
```bash
# Instalar Nginx
apt install nginx certbot python3-certbot-nginx

# Configurar proxy reverso
nano /etc/nginx/sites-available/whatsapp-microservice

# Obter certificado SSL
certbot --nginx -d your-domain.com
```

## 📈 **Monitoramento**

### **PM2 Monitoring**
```bash
# Instalar PM2 Plus (opcional)
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### **Health Checks**
```bash
# Adicionar ao cron para health check
crontab -e
# Adicionar linha:
# */5 * * * * curl -f http://localhost:3000/health || systemctl restart whatsapp-microservice
```

## 🚀 **Próximos Passos**

1. **Deploy inicial** → Seguir guia acima
2. **Testar QR codes** → Verificar geração funcionando
3. **Integrar com LocAI** → Configurar client externo
4. **Configurar webhooks** → Receber mensagens
5. **Monitorar produção** → Acompanhar logs e métricas
6. **Backup sessões** → Configurar backup das sessões

## ✅ **Resultado Final**

Após a implementação completa:
- ✅ **QR codes funcionando** nativamente
- ✅ **Sessões persistentes** entre deploys
- ✅ **Multi-tenant** com isolamento total
- ✅ **API REST** completa e documentada
- ✅ **Webhooks** para integração real-time
- ✅ **Monitoramento** com PM2 e logs
- ✅ **Segurança** com autenticação e firewall
- ✅ **Escalabilidade** horizontal disponível

**O seu LocAI finalmente terá WhatsApp funcionando 100%! 🎉**