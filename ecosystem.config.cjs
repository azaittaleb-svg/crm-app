module.exports = {
  apps: [
    {
      name: 'crm-app',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'server.ts',
      cwd: 'C:/Users/Foxconn/Documents/Project React/crm-20(2)25-08',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      max_memory_restart: '800M',
      autorestart: true,
      watch: false,
    },
    {
      name: 'openwa',
      script: './dist/main.js',
      cwd: 'C:/Users/Foxconn/Documents/Project React/crm-20(2)25-08/openwa',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      restart_delay: 3000,
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      name: 'openwa-tunnel',
      script: './scripts/tunnel-service.js',
      cwd: 'C:/Users/Foxconn/Documents/Project React/crm-20(2)25-08/openwa',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
};
