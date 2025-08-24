#!/bin/bash

# Script para atualizar o microservice WhatsApp
echo "🚀 Atualizando WhatsApp Microservice..."

# Parar o serviço
echo "⏹️ Parando microservice..."
pm2 stop whatsapp-microservice || echo "Service não estava rodando"

# Fazer backup das sessões (se existirem)
if [ -d "/opt/whatsapp-microservice/sessions" ]; then
    echo "💾 Fazendo backup das sessões..."
    cp -r /opt/whatsapp-microservice/sessions /opt/whatsapp-microservice/sessions.backup.$(date +%Y%m%d_%H%M%S)
fi

# Atualizar dependências
echo "📦 Atualizando dependências..."
npm install

# Rebuild do projeto
echo "🔨 Rebuilding projeto..."
npm run build

# Reiniciar o serviço
echo "🔄 Reiniciando microservice..."
pm2 start ecosystem.config.js

# Verificar status
echo "✅ Verificando status..."
pm2 status whatsapp-microservice

# Verificar logs recentes
echo "📋 Logs recentes:"
pm2 logs whatsapp-microservice --lines 10

echo "🏁 Atualização concluída!"
echo ""
echo "📝 Principais melhorias aplicadas:"
echo "   - Baileys atualizado de 6.7.18 para 6.17.16"
echo "   - Sistema anti-duplicação no processamento de mensagens"
echo "   - Filtros melhorados para mensagens vazias"
echo "   - Logs mais detalhados para debug"
echo "   - Cache de mensagens processadas"
echo ""
echo "🧪 Para testar, envie uma mensagem via WhatsApp e monitore os logs:"
echo "   pm2 logs whatsapp-microservice --follow"