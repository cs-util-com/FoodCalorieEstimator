import { test, expect } from '@playwright/test';

test.describe('index.html smoke test', () => {
  test('loads without console warnings or errors', async ({ page }) => {
    const consoleIssues = [];
    const pageErrors = [];
    const allowedWarningPatterns = [
      /cdn\.tailwindcss\.com should not be used in production/i,
    ];

    page.on('console', (message) => {
      const type = message.type();
      const text = message.text();

      if (type === 'error') {
        consoleIssues.push({ type, text });
      } else if (type === 'warning') {
        const isAllowed = allowedWarningPatterns.some((pattern) =>
          pattern.test(text)
        );

        if (!isAllowed) {
          consoleIssues.push({ type, text });
        }
      }
    });

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    const response = await page.goto('/');

    await expect(response, 'Expected to receive a valid response when loading /').not.toBeNull();

    if (response) {
      expect.soft(
        response.status(),
        `Expected a successful status code for index.html but received ${response.status()} ${response.statusText()}`
      ).toBeLessThan(400);
    }

    // Using 'load' avoids timeouts seen when parallel browsers wait for 'networkidle'.
    await page.waitForLoadState('load');

    const navigation = page.getByRole('navigation', { name: /main navigation/i });
    await expect(navigation).toBeVisible();

    const cameraTab = page.getByRole('button', { name: 'Camera' });
    await expect(cameraTab).toHaveAttribute('aria-current', 'page');

    const cameraView = page.locator('#camera-view');
    await expect(cameraView).toBeVisible();

    const emptyStateHeading = page.getByRole('heading', {
      level: 2,
      name: /estimate calories from a single photo/i,
    });
    await expect(emptyStateHeading).toBeVisible();

  const captureCta = page.locator('label[for="file-input"][role="button"]');
    await expect(captureCta).toBeVisible();

  const fileInput = page.getByLabel('Select or take a photo');
  await expect(fileInput).toHaveAttribute('type', 'file');
  await expect(fileInput).toHaveAttribute('accept', /image\/*/i);

    const canvasWrapper = page.locator('#canvas-wrapper');
    await expect(canvasWrapper).toBeHidden();

    expect(consoleIssues, 'Console warning/error detected while loading index.html').toEqual([]);
    expect(pageErrors, 'Unhandled page errors detected while loading index.html').toEqual([]);
  });
});
