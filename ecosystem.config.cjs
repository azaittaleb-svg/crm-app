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
  ],
};
