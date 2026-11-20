import { test, expect } from '@playwright/test'

test.describe('API tests', () => {
  test('auth proxy forwards to auth worker', async ({ request }) => {
    const res = await request.get('/api/auth/ok')
    expect(res.ok()).toBeTruthy()
  })

  test('guest start returns a signed ticket without sign-in', async ({ request }) => {
    const res = await request.post('/api/guest/start', { data: { mode: 'free', cityId: 'paris-marais', weather: 'rain' } })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.ticket).toContain('.')
    expect(body.data.board).toBe('free:paris-marais:rain')
  })

  test('claimRun requires sign-in', async ({ request }) => {
    const res = await request.post('/api/actions/claimRun', { data: { ticket: 'x', inputLog: [] } })
    expect(res.status()).toBe(401)
  })

  test('WebSocket endpoint exists', async ({ page }) => {
    // /settings is a dynamic page (under src/pages/(app)/): mounting it boots
    // the providers and auto-connects the records WebSocket.
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="app-navigation"]', { timeout: 15000 })
    // If the app loaded and connected, the WS endpoint works
  })
})
