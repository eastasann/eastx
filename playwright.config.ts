import { defineConfig, devices } from '@playwright/test'

// make e2e がビルドしてから実行する。webServer はビルド済みの Worker を workerd で動かす
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bunx vite preview --port 3000 --strictPort',
    // 起動検知は IPv6 ループバックで行う。127.0.0.1:3000 を別のプロセス（Docker など）が
    // 使っていると vite は ::1 だけで起動し、localhost の検知が別プロセスに当たり続けるため
    url: 'http://[::1]:3000/ja',
    reuseExistingServer: !process.env.CI,
  },
})
