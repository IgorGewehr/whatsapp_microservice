// Script para testar a API de transcrição OpenAI
// Execute com: node test-transcription.js

const FormData = require('form-data');
const fs = require('fs');
const fetch = require('node-fetch');

// Configurações
const OPENAI_API_KEY = process.env.TRANSCRIPTION_API_KEY || 'your-api-key-here';
const AUDIO_FILE = './test-audio.ogg'; // Coloque um arquivo de áudio aqui para testar

async function testTranscription() {
  if (!fs.existsSync(AUDIO_FILE)) {
    console.log('❌ Arquivo de áudio não encontrado:', AUDIO_FILE);
    console.log('Por favor, coloque um arquivo de áudio .ogg, .mp3 ou .m4a neste diretório');
    return;
  }

  if (OPENAI_API_KEY === 'your-api-key-here') {
    console.log('❌ Por favor, configure a API Key da OpenAI');
    console.log('Execute: export TRANSCRIPTION_API_KEY="sua-chave-aqui"');
    return;
  }

  console.log('🎤 Testando transcrição com OpenAI Whisper...');
  console.log('📁 Arquivo:', AUDIO_FILE);
  console.log('🔑 API Key:', OPENAI_API_KEY.substring(0, 10) + '...');

  try {
    const audioBuffer = fs.readFileSync(AUDIO_FILE);
    const formData = new FormData();
    
    formData.append('file', audioBuffer, {
      filename: 'audio.ogg',
      contentType: 'audio/ogg'
    });
    formData.append('model', 'whisper-1');
    formData.append('language', 'pt');
    formData.append('response_format', 'json');

    console.log('\n📤 Enviando áudio para transcrição...');
    const startTime = Date.now();

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const error = await response.text();
      console.log('❌ Erro na API:', response.status);
      console.log('Detalhes:', error);
      return;
    }

    const result = await response.json();
    
    console.log('\n✅ Transcrição concluída!');
    console.log('⏱️ Tempo:', duration, 'ms');
    console.log('📝 Texto transcrito:');
    console.log('---');
    console.log(result.text);
    console.log('---');
    
    // Calcular custo estimado
    const audioSize = audioBuffer.length / 1024 / 1024; // MB
    const estimatedDuration = audioSize * 60; // Estimativa grosseira: 1MB ≈ 1 minuto
    const cost = estimatedDuration * 0.006;
    
    console.log('\n💰 Custo estimado: $', cost.toFixed(4));
    console.log('📊 Tamanho do arquivo:', audioSize.toFixed(2), 'MB');

  } catch (error) {
    console.log('❌ Erro durante o teste:', error.message);
  }
}

// Executar teste
testTranscription();