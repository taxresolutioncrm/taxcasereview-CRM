import { test, expect } from '@playwright/test'

test.setTimeout(45_000)

test('shared TCR and TaxRes production login renders and supports Spanish toggle', async ({page}) => {
  await page.goto('https://taxrescrm.app/login', {waitUntil:'domcontentloaded',timeout:30000})
  await expect(page.locator('#tcr-email')).toBeVisible()
  await expect(page.locator('#tcr-password')).toBeVisible()
  const spanish=page.getByRole('button',{name:'ES',exact:true})
  await spanish.click()
  await expect(spanish).toHaveClass(/active/)
  const english=page.getByRole('button',{name:'EN',exact:true})
  await english.click()
  await expect(english).toHaveClass(/active/)
})

test('Centurion production login is properly branded and interactive', async ({page}) => {
  await page.goto('https://centurionfirm.taxrescrm.app/login',{waitUntil:'domcontentloaded',timeout:30000})
  await expect(page.locator('svg[aria-label="Centurion Firm"]')).toBeVisible()
  await expect(page.locator('#tcr-email')).toBeVisible()
  await expect(page.locator('#tcr-password')).toBeVisible()
})

test('Centurion family password page is branded and rejects tokenless access', async ({page}) => {
  await page.goto('https://taxrescrm.app/family-password?office=centurion',{waitUntil:'domcontentloaded',timeout:30000})
  await expect(page.getByText('Set Up Your Centurion Firm CRM Password',{exact:true})).toBeVisible()
  await expect(page.getByText(/missing its employee authentication token/i)).toBeVisible()
})

test('Shared and Centurion login forms remain usable on mobile', async ({page}) => {
  await page.setViewportSize({width:390,height:844})
  for(const url of ['https://taxrescrm.app/login','https://centurionfirm.taxrescrm.app/login']) {
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000})
    await expect(page.locator('#tcr-email')).toBeVisible()
    await expect(page.locator('#tcr-password')).toBeVisible()
    await expect(page.locator('.tcr-login-btn2')).toBeVisible()
  }
})
