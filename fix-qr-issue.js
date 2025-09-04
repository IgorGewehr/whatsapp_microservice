// Script para testar se o problema do QR foi corrigido
// Execute com: node fix-qr-issue.js

const fetch = require('node-fetch');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'your-api-key';
const TENANT_ID = process.env.TENANT_ID || 'test-tenant-123';

async function testQRGeneration() {
  console.log('🔍 Testando geração de QR Code');
  console.log('='.repeat(40));
  
  const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    console.log('\n1. 🔄 Iniciando nova sessão...');
    const startResponse = await fetch(`${BASE_URL}/api/v1/sessions/${TENANT_ID}/start`, {
      method: 'POST',
      headers
    });
    
    const startData = await startResponse.json();
    
    if (startData.success) {
      console.log('✅ Sessão iniciada:', startData.data.message);
      if (startData.data.qrCode) {
        console.log('✅ QR Code gerado! Tamanho:', startData.data.qrCode.length);
        console.log('📱 QR Preview:', startData.data.qrCode.substring(0, 50) + '...');
      } else {
        console.log('⚠️ QR Code não encontrado na resposta');
      }
    } else {
      console.log('❌ Erro ao iniciar sessão:', startData.error);
    }

    console.log('\n2. 📊 Verificando status...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Aguardar 2s
    
    const statusResponse = await fetch(`${BASE_URL}/api/v1/sessions/${TENANT_ID}/status`, {
      headers
    });
    
    const statusData = await statusResponse.json();
    
    if (statusData.success) {
      console.log('📱 Status da sessão:', statusData.data.status);
      console.log('🔗 Conectado:', statusData.data.connected);
      if (statusData.data.qrCode) {
        console.log('✅ QR Code disponível! Tamanho:', statusData.data.qrCode.length);
      } else {
        console.log('⚠️ QR Code não disponível no status');
      }
    } else {
      console.log('❌ Erro ao verificar status:', statusData.error);
    }

    console.log('\n3. 🔍 Debug completo...');
    const debugResponse = await fetch(`${BASE_URL}/api/v1/debug/status`, { headers });
    const debugData = await debugResponse.json();
    
    if (debugData.success) {
      console.log('🚀 Sistema rodando normalmente');
      console.log('📊 Sessões ativas:', debugData.data.whatsapp.activeSessions);
      console.log('💾 Memória:', Math.round(debugData.data.server.memory.used / 1024 / 1024), 'MB');
    }

  } catch (error) {
    console.log('❌ Erro durante o teste:', error.message);
    console.log('\n💡 Possíveis causas:');
    console.log('- Erro de sintaxe no código (variável não declarada)');
    console.log('- Processo Node.js pode ter crashado');
    console.log('- Verifique os logs: pm2 logs whatsapp-microservice');
  }
}

// Executar teste
testQRGeneration();