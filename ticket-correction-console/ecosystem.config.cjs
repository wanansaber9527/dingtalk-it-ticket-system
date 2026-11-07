module.exports = {
  apps: [
    {
      name: "ticket-correction-console",
      cwd: __dirname,
      script: "scripts/start-production.mjs",
      interpreter: process.execPath,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: "31023"
      }
    }
  ]
};
