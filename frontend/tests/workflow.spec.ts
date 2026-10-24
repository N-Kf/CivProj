import {expect,test} from '@playwright/test';
import type {Page} from '@playwright/test';

async function demo(page:Page,role='cfo') {
  await page.goto('/');
  await page.getByLabel('Demo role').selectOption(role);
  await page.getByRole('button',{name:'Explore the demo'}).click();
  await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
  await expect(page.locator('.stat-card').first()).toBeVisible();
}

test('dashboard, financial register, report download and both RTL languages',async({page})=>{
  const errors:string[]=[];page.on('pageerror',err=>errors.push(err.message));
  await demo(page);
  await expect(page.locator('.stat-value').first()).toContainText('18.45');
  await expect(page.locator('.chart-month')).toHaveCount(6);
  await page.getByRole('button',{name:'Cost register',exact:true}).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByPlaceholder('Search references, suppliers, descriptions…').fill('Skyline');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.locator('.record-ref').click();
  await expect(page.getByRole('dialog')).toContainText('Skyline Equipment');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Reports',exact:true}).click();
  const downloadEvent=page.waitForEvent('download');
  await page.getByRole('link',{name:'Download report'}).click();
  expect((await downloadEvent).suggestedFilename()).toBe('civproj-cost-report.csv');
  for (const locale of ['ar','fa']) {
    await page.getByLabel('Language / اللغة / زبان').selectOption(locale);
    await expect(page.locator('html')).toHaveAttribute('dir','rtl');
    await expect(page.locator('html')).toHaveAttribute('lang',locale);
    await expect(page.locator('.report-panel')).toBeVisible();
  }
  await page.screenshot({path:'test-results/civproj-farsi.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('submit a detailed invoice and approve it using a different person',async({page})=>{
  await demo(page,'manager');
  const reference=`E2E-${Date.now()}`;
  await page.getByRole('button',{name:'Add cost record',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Reference',{exact:true}).fill(reference);
  await dialog.getByLabel('Description',{exact:true}).fill('Concrete cube testing service');
  await dialog.getByLabel('Supplier / payee').fill('QA Lab');
  await dialog.getByLabel('Quantity',{exact:true}).fill('3');
  await dialog.getByLabel('Unit price',{exact:true}).fill('100.10');
  await dialog.getByLabel('Retention (%)',{exact:true}).fill('10');
  await dialog.getByRole('button',{name:'Submit for approval'}).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'Sign out'}).click();
  await page.getByLabel('Demo role').selectOption('cfo');
  await page.getByRole('button',{name:'Explore the demo'}).click();
  await page.getByRole('button',{name:/^Approvals/}).click();
  const card=page.locator('.approval-card').filter({hasText:reference});
  await expect(card).toContainText('315.32');
  await card.getByRole('button',{name:'Approve',exact:true}).click();
  await page.getByLabel('Decision note').fill('Verified lab certificate and invoice');
  await page.getByRole('dialog').getByRole('button',{name:'Approve',exact:true}).click();
  await expect(card).not.toBeVisible();
  await page.getByRole('button',{name:'Audit trail',exact:true}).click();
  const event=page.locator('.audit-event').filter({hasText:reference}).first();
  await event.locator('summary').click();
  await expect(event).toContainText('Verified lab certificate and invoice');
});

test('customer sees only assigned project summaries',async({page})=>{
  await demo(page,'customer');
  await expect(page.locator('#project-select option')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Cost register',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Audit trail',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Reports',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Project cost report'})).toBeVisible();
});

test('create an organization and project, allocate budget, and grant an existing user access',async({page})=>{
  const stamp=Date.now();
  await page.goto('/');
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();
  await page.getByLabel('Full name').fill('Workspace Owner');
  await page.getByLabel('Organization',{exact:true}).fill(`E2E Org ${stamp}`);
  await page.getByLabel('Email address').fill(`owner-${stamp}@example.test`);
  await page.getByLabel('Password',{exact:true}).fill('testing-workspace-password');
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();
  await page.getByRole('button',{name:'New project',exact:true}).click();
  await page.getByLabel('Project name').fill('New test development');
  await page.getByLabel('Customer',{exact:true}).fill('Test customer');
  await page.getByLabel('Location').fill('Dubai');
  await page.getByRole('button',{name:'Create project',exact:true}).click();
  await expect(page.locator('.stat-card').first()).toBeVisible();
  await page.getByRole('button',{name:'Revise budget',exact:true}).click();
  await page.getByLabel('Budget amount (AED)').fill('100000');
  await page.getByLabel('Reason / note').fill('Initial site preparation budget');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.stat-value').first()).toContainText('100');
  await page.getByRole('button',{name:'People & access',exact:true}).click();
  await page.getByRole('button',{name:'Add member',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Email address').fill('cfo@civproj.demo');
  await page.getByRole('dialog').getByLabel('Role',{exact:true}).selectOption('cfo');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('tbody')).toContainText('cfo@civproj.demo');
});

test('mobile layout supports Farsi without page overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await demo(page);
  await page.getByLabel('Language / اللغة / زبان').selectOption('fa');
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  await expect(page.locator('.sidebar')).toHaveClass(/is-open/);
  await page.screenshot({path:'test-results/civproj-mobile.png',fullPage:true});
});
