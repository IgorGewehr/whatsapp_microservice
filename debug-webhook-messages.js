// Script para debugar por que mensagens não chegam no webhook
// Execute: node debug-webhook-messages.js

const fetch = require('node-fetch');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'your-api-key';
const TENANT_ID = process.env.TENANT_ID || 'test-tenant-123';

async function debugWebhookMessages() {
  console.log('🔍 Debug: Por que mensagens não chegam no webhook?');
  console.log('=' .repeat(60));
  
  const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    console.log('\n1. 📊 Verificando status geral...');
    const statusResponse = await fetch(`${BASE_URL}/api/v1/debug/status`, { headers });
    const statusData = await statusResponse.json();
    
    if (statusData.success) {
      console.log('✅ Sistema funcionando');
      console.log('📱 Sessões ativas:', statusData.data.whatsapp.activeSessions);
      console.log('🔗 Webhook URL configurada:', !!process.env.LOCAI_WEBHOOK_URL);
    }

    console.log('\n2. 📱 Verificando status da sessão...');
    const sessionResponse = await fetch(`${BASE_URL}/api/v1/sessions/${TENANT_ID}/status`, { headers });
    const sessionData = await sessionResponse.json();
    
    if (sessionData.success) {
      console.log('📍 Status da sessão:', sessionData.data.status);
      console.log('🔗 Conectada:', sessionData.data.connected);
      console.log('📱 Telefone:', sessionData.data.phoneNumber || 'N/A');
      
      if (sessionData.data.status !== 'connected') {
        console.log('❌ PROBLEMA: Sessão não está conectada!');
        console.log('💡 Solução: Escaneie o QR Code primeiro');
        return;
      }
    }

    console.log('\n3. 🔗 Verificando webhooks registrados...');
    const webhooksResponse = await fetch(`${BASE_URL}/api/v1/webhooks/${TENANT_ID}`, { headers });
    const webhooksData = await webhooksResponse.json();
    
    if (webhooksData.success) {
      const webhooks = webhooksData.data.webhooks || [];
      console.log('📊 Webhooks registrados:', webhooks.length);
      
      if (webhooks.length === 0) {
        console.log('❌ PROBLEMA: Nenhum webhook registrado!');
        console.log('💡 Possíveis causas:');
        console.log('   - LOCAI_WEBHOOK_URL não configurada no .env');
        console.log('   - Auto-registro falhou');
        console.log('   - Sessão foi criada antes da configuração');
      } else {
        webhooks.forEach(webhook => {
          console.log('✅ Webhook encontrado:', {
            url: webhook.url.substring(0, 50) + '...',
            active: webhook.active,
            events: webhook.events,
            successCount: webhook.successCount || 0,
            errorCount: webhook.errorCount || 0
          });
        });
      }
    }

    console.log('\n4. 🧪 Testando envio de webhook...');
    const testResponse = await fetch(`${BASE_URL}/api/v1/debug/webhook/test/${TENANT_ID}`, { headers });
    const testData = await testResponse.json();
    
    if (testData.success) {
      console.log('✅ Teste de webhook enviado');
      console.log('📤 Status da resposta:', testData.data.response.status);
      console.log('✔️ Sucesso HTTP:', testData.data.response.ok);
      
      if (!testData.data.response.ok) {
        console.log('❌ PROBLEMA: Webhook retornou erro HTTP');
        console.log('📝 Resposta:', testData.data.response.body?.substring(0, 200));
      }
    } else {
      console.log('❌ Erro no teste:', testData.error);
      if (testData.hint) {
        console.log('💡 Dica:', testData.hint);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎯 CHECKLIST PARA RECEBER MENSAGENS:');
    console.log('');
    console.log('1. ✅ Sessão WhatsApp conectada (QR escaneado)');
    console.log('2. 🔗 Webhook registrado com URL válida');
    console.log('3. 🌐 Endpoint do webhook respondendo (200 OK)');
    console.log('4. 📱 Cliente enviou mensagem real pelo WhatsApp');
    console.log('5. ⏱️ Aguardar até 12s (debounce de mensagens)');
    console.log('');
    console.log('📋 COMANDOS ÚTEIS NO SERVIDOR:');
    console.log('- pm2 logs whatsapp-microservice --follow');
    console.log('- curl -X POST -H "Authorization: Bearer ' + API_KEY + '" \\');
    console.log('  ' + BASE_URL + '/api/v1/debug/webhook/test/' + TENANT_ID);

  } catch (error) {
    console.log('❌ Erro durante debug:', error.message);
    console.log('\n💡 Verifique:');
    console.log('- Servidor está rodando?');
    console.log('- Variáveis BASE_URL, API_KEY, TENANT_ID corretas?');
  }
}

// Executar debug
debugWebhookMessages();