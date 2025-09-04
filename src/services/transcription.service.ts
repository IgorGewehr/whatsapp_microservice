import { Logger } from 'pino';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';
import fetch from 'node-fetch';
import { config } from '../config/config';

export interface TranscriptionResult {
  success: boolean;
  text?: string;
  error?: string;
  duration?: number;
  language?: string;
}

export class TranscriptionService {
  private logger: Logger;
  private apiKey: string;
  private provider: 'openai' | 'google' | 'local';
  private model: string;
  private language: string;

  constructor(logger: Logger) {
    this.logger = (logger as any).child({ service: 'TranscriptionService' });
    this.apiKey = config.TRANSCRIPTION_API_KEY || '';
    this.provider = (config.TRANSCRIPTION_PROVIDER as 'openai' | 'google' | 'local') || 'openai';
    this.model = config.TRANSCRIPTION_MODEL || 'whisper-1';
    this.language = config.TRANSCRIPTION_LANGUAGE || 'pt';
    
    if (this.provider === 'openai' && !this.apiKey) {
      console.log('⚠️ [Transcription] OpenAI API key not configured');
    }
    
    console.log(`✅ [Transcription] Service initialized (provider: ${this.provider}, model: ${this.model}, language: ${this.language})`);
  }

  async transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<TranscriptionResult> {
    const startTime = Date.now();
    
    try {
      console.log('🎤 [Transcription] Starting audio transcription', {
        provider: this.provider,
        bufferSize: audioBuffer.length,
        mimeType
      });

      let result: TranscriptionResult;

      switch (this.provider) {
        case 'openai':
          result = await this.transcribeWithOpenAI(audioBuffer, mimeType);
          break;
        case 'google':
          result = await this.transcribeWithGoogle(audioBuffer, mimeType);
          break;
        case 'local':
          result = await this.transcribeWithLocalWhisper(audioBuffer, mimeType);
          break;
        default:
          throw new Error(`Unsupported transcription provider: ${this.provider}`);
      }

      const duration = Date.now() - startTime;
      result.duration = duration;

      if (result.success) {
        console.log('✅ [Transcription] Audio transcribed successfully', {
          provider: this.provider,
          duration: `${duration}ms`,
          textLength: result.text?.length || 0
        });
      } else {
        console.log('❌ [Transcription] Transcription failed', {
          provider: this.provider,
          error: result.error,
          duration: `${duration}ms`
        });
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.log('❌ [Transcription] Error during transcription', {
        provider: this.provider,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: `${duration}ms`
      });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown transcription error',
        duration
      };
    }
  }

  private async transcribeWithOpenAI(audioBuffer: Buffer, mimeType: string): Promise<TranscriptionResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'OpenAI API key not configured'
      };
    }

    try {
      // Determinar extensão do arquivo baseado no mimeType
      const extension = this.getFileExtension(mimeType);
      
      // Criar FormData para enviar o áudio
      const formData = new FormData();
      formData.append('file', audioBuffer, {
        filename: `audio.${extension}`,
        contentType: mimeType
      });
      formData.append('model', this.model);
      formData.append('language', this.language);
      formData.append('response_format', 'json');

      // Fazer requisição para OpenAI
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...formData.getHeaders()
        },
        body: formData
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
      }

      const result = await response.json() as { text: string };
      
      return {
        success: true,
        text: result.text,
        language: this.language
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OpenAI transcription failed'
      };
    }
  }

  private async transcribeWithGoogle(audioBuffer: Buffer, mimeType: string): Promise<TranscriptionResult> {
    // Implementação para Google Cloud Speech-to-Text
    // Requer configuração adicional do Google Cloud SDK
    
    return {
      success: false,
      error: 'Google Cloud Speech-to-Text not implemented yet'
    };
  }

  private async transcribeWithLocalWhisper(audioBuffer: Buffer, mimeType: string): Promise<TranscriptionResult> {
    // Implementação para Whisper local
    // Requer instalação do whisper.cpp ou whisper Python
    
    return {
      success: false,
      error: 'Local Whisper not implemented yet'
    };
  }

  private getFileExtension(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      'audio/ogg': 'ogg',
      'audio/ogg; codecs=opus': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/wav': 'wav',
      'audio/webm': 'webm',
      'audio/amr': 'amr',
      'audio/aac': 'aac'
    };
    
    return mimeToExt[mimeType] || 'ogg';
  }

  isEnabled(): boolean {
    if (this.provider === 'openai') {
      return !!this.apiKey;
    }
    return true;
  }

  getConfig(): {
    provider: string;
    model: string;
    language: string;
    enabled: boolean;
  } {
    return {
      provider: this.provider,
      model: this.model,
      language: this.language,
      enabled: this.isEnabled()
    };
  }
}