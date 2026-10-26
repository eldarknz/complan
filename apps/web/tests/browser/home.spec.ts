import { expect, test } from '@playwright/test';

test('Главная создаёт проект, сохраняет сцену и открывает её из карточки', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Мои проекты.' })).toBeVisible();
  await page.getByRole('button', { name: '＋ Новый проект' }).click();
  await expect(page.locator('#viewport canvas')).toHaveCount(1);
  await page.locator('[data-type-id="pipe-50"]').click();
  await expect(page.locator('#object-count')).toHaveText('Элементов: 2');
  await page.locator('.brand').click();
  await page.getByRole('link', { name: /Проект 1/ }).click();
  await expect(page.locator('#object-count')).toHaveText('Элементов: 2');
  await page.locator('.brand').click();
  await page.getByRole('button', { name: /Пользователь/ }).click();
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByLabel('Имя пользователя').fill('Алексей');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /Алексей/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Выход', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Алексей/ }).click();
  await page.getByRole('button', { name: 'Выход', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Работа завершена' })).toBeVisible();
  await page.getByRole('button', { name: 'Вернуться к проектам' }).click();
  await expect(page.getByRole('link', { name: /Проект 1/ })).toBeVisible();
});
