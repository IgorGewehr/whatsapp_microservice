// Script rápido para debug do sistema de transcrição
// Execute com: node debug-audio.js

const fetch = require('node-fetch');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'your-api-key';
const TENANT_ID = process.env.TENANT_ID || 'test-tenant-123';

async function runDebug() {
  console.log('🔍 Debug de Transcrição de Áudio');
  console.log('='.repeat(50));
  
  const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    // 1. Status geral do sistema
    console.log('\n1. 📊 Status do Sistema...');
    const statusResponse = await fetch(`${BASE_URL}/api/v1/debug/status`, { headers });
    const statusData = await statusResponse.json();
    
    if (statusData.success) {
      console.log('✅ Sistema rodando');
      console.log('📱 Sessões ativas:', statusData.data.whatsapp.activeSessions);
      console.log('🎤 Transcrição habilitada:', statusData.data.transcription.enabled);
      console.log('🔑 API Key configurada:', statusData.data.transcription.hasApiKey);
      console.log('🤖 Provider:', statusData.data.transcription.provider);
    } else {
      console.log('❌ Erro no status:', statusData.error);
    }

    // 2. Testar configuração de transcrição
    console.log('\n2. 🎤 Testando Transcrição...');
    const transcriptionResponse = await fetch(`${BASE_URL}/api/v1/debug/transcription/test/${TENANT_ID}`, {
      method: 'POST',
      headers
    });
    const transcriptionData = await transcriptionResponse.json();
    
    if (transcriptionData.success) {
      console.log('✅ Configuração de transcrição OK');
      console.log('📱 Status da sessão:', transcriptionData.data.sessionStatus);
      console.log('🔗 Conectado:', transcriptionData.data.sessionConnected);
    } else {
      console.log('❌ Erro na transcrição:', transcriptionData.error);
      if (transcriptionData.hint) {
        console.log('💡 Dica:', transcriptionData.hint);
      }
    }

    // 3. Testar webhook
    console.log('\n3. 🔗 Testando Webhook...');
    const webhookResponse = await fetch(`${BASE_URL}/api/v1/debug/webhook/test/${TENANT_ID}`, { headers });
    const webhookData = await webhookResponse.json();
    
    if (webhookData.success) {
      console.log('✅ Teste de webhook enviado');
      console.log('🌐 URL:', webhookData.data.webhookUrl);
      console.log('📤 Status da resposta:', webhookData.data.response.status);
      console.log('✔️ Sucesso:', webhookData.data.response.ok);
    } else {
      console.log('❌ Erro no webhook:', webhookData.error);
      if (webhookData.data) {
        console.log('🌐 URL:', webhookData.data.webhookUrl);
      }
    }

    // 4. Status da sessão específica
    console.log('\n4. 📱 Status da Sessão...');
    const sessionResponse = await fetch(`${BASE_URL}/api/v1/sessions/${TENANT_ID}/status`, { headers });
    const sessionData = await sessionResponse.json();
    
    if (sessionData.success) {
      console.log('✅ Sessão encontrada');
      console.log('🔗 Status:', sessionData.data.status);
      console.log('📞 Conectado:', sessionData.data.connected);
      console.log('📱 Telefone:', sessionData.data.phoneNumber || 'N/A');
    } else {
      console.log('❌ Erro na sessão:', sessionData.error);
    }

    // 5. Instruções finais
    console.log('\n' + '='.repeat(50));
    console.log('🎯 PRÓXIMOS PASSOS:');
    console.log('1. Verifique se a sessão está CONECTADA');
    console.log('2. Envie um áudio pelo WhatsApp');
    console.log('3. Monitore os logs: pm2 logs whatsapp-microservice');
    console.log('4. Verifique se o webhook recebeu a mensagem');
    console.log('\n📋 COMANDOS ÚTEIS:');
    console.log('- pm2 logs whatsapp-microservice --lines 50');
    console.log('- pm2 restart whatsapp-microservice');
    console.log('- curl -H "Authorization: Bearer ' + API_KEY + '" ' + BASE_URL + '/api/v1/debug/status');

  } catch (error) {
    console.log('❌ Erro durante o debug:', error.message);
    console.log('\n💡 Verifique:');
    console.log('- Se o servidor está rodando');
    console.log('- Se as variáveis BASE_URL, API_KEY e TENANT_ID estão corretas');
    console.log('- Se as rotas de debug foram implementadas');
  }
}

// Executar debug
runDebug();