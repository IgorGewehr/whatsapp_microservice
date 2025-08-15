// PM2 Ecosystem Configuration for Production
module.exports = {
  apps: [
    {
      name: 'whatsapp-microservice',
      script: './dist/server.js',
      instances: 1, // Baileys não suporta múltiplas instâncias do mesmo tenant
      autorestart: true,
      watch: false, // Não usar watch em produção
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0'
      },
      // Configurações avançadas para produção
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
      // Restart delay para evitar restart loops
      restart_delay: 4000,
      // Exponential backoff restart delay
      exp_backoff_restart_delay: 100,
      // Maximum number of restart retries
      max_restarts: 10,
      // Minimum uptime before considering restart successful
      min_uptime: '10s',
      // Health check
      health_check_grace_period: 3000,
      // Force kill after this timeout
      kill_timeout: 5000,
      // Listen timeout for app initialization
      listen_timeout: 3000,
      // Merge logs from all instances
      merge_logs: true,
      // Log date format
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Environment specific settings
      node_args: '--max-old-space-size=1024'
    }
  ],

  // Deployment configuration
  deploy: {
    production: {
      user: 'root', // ou seu usuário SSH
      host: ['your-digitalocean-ip'], // IP do seu droplet
      ref: 'origin/main',
      repo: 'https://github.com/your-username/whatsapp-microservice.git',
      path: '/opt/whatsapp-microservice',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': 'git clone https://github.com/your-username/whatsapp-microservice.git /opt/whatsapp-microservice'
    }
  }
};