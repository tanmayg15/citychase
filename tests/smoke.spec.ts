import { test, expect } from '@playwright/test'
import { captureConsoleErrors } from './helpers/errors'

/**
 * Smoke tests covering both page kinds this template ships:
 *   - '/'      → the static landing (top level of src/pages/): no providers,
 *                so no auth fetch and no records WebSocket on load.
 *   - '/home'  → a dynamic page (under src/pages/(app)/): the providers mount,
 *                the nav shell renders, and the records WebSocket connects.
 *
 * The "static contract" test is the guardrail for the per-page opt-out: if
 * someone moves the providers back up into _app.tsx, it fails.
 */

/** Wait for the React app shell (present on every page). */
async function waitForApp(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 })
}

test.describe('Smoke tests', () => {
  test('static /about page loads without JS errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/about')
    await expect(page.getByRole('heading', { name: 'How City Chase works' })).toBeVisible()
    expect(errors).toEqual([])
  })

  test('lobby at / lets a signed-out visitor play (no sign-in gate)', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('play-daily')).toBeVisible()
    await expect(page.getByTestId('free-play')).toBeVisible()
    await expect(page.getByTestId('lobby-sign-in')).toBeVisible()
  })

  test('/home redirects to the lobby', async ({ page }) => {
    await page.goto('/home')
    await expect(page).toHaveURL(/\/$/)
  })

  test('app chrome mounts on non-game pages', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 15000 })
  })

  test('sign-in button visible when logged out', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByTestId('nav-sign-in-button')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('nav-user-name')).toHaveCount(0)
  })

  test('unknown route shows 404', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz')
    await waitForApp(page)
    await expect(page.locator('text=404')).toBeVisible()
  })
})
