import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const demoURL='http://127.0.0.1:5185/';
async function open(page:Page){
  await page.goto(demoURL);
  await expect(page.locator('.stat-card').first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang','fa');
  await page.getByLabel('Language / اللغة / زبان').selectOption('en');
}

test('standalone preview runs without an API and supports exact costs, approval, CSV and customer roles',async({page})=>{
  const errors:string[]=[],network:string[]=[];
  page.on('pageerror',err=>errors.push(err.message));
  page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.isNavigationRequest())network.push(request.url());});
  await open(page);
  await expect(page.locator('.browser-demo-controls')).toContainText('sample data only');
  await expect(page.locator('.stat-value').first()).toContainText('18.45');
  await page.getByRole('button',{name:'Add cost record',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Reference',{exact:true}).fill('BROWSER-INV-001');
  await dialog.getByLabel('Description',{exact:true}).fill('Sample concrete quality tests');
  await dialog.getByLabel('Supplier / payee').fill('Sample testing laboratory');
  await dialog.getByLabel('Quantity',{exact:true}).fill('3');
  await dialog.getByLabel('Unit price',{exact:true}).fill('100.10');
  await dialog.getByLabel('Retention (%)',{exact:true}).fill('10');
  await dialog.getByRole('button',{name:'Submit for approval'}).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:/^Approvals/}).click();
  let card=page.locator('.approval-card').filter({hasText:'BROWSER-INV-001'});
  await expect(card).toContainText('315.32');
  await expect(card).toContainText('Another approver must review');
  await page.getByRole('combobox',{name:'Try a stakeholder role'}).selectOption('ceo');
  await expect(page.locator('.stat-card').first()).toBeVisible();
  await page.getByRole('button',{name:/^Approvals/}).click();
  card=page.locator('.approval-card').filter({hasText:'BROWSER-INV-001'});
  await card.getByRole('button',{name:'Approve',exact:true}).click();
  await page.getByLabel('Decision note').fill('Checked sample testing certificate');
  await page.getByRole('dialog').getByRole('button',{name:'Approve',exact:true}).click();
  await expect(card).not.toBeVisible();
  await page.getByRole('button',{name:'Audit trail',exact:true}).click();
  const event=page.locator('.audit-event').filter({hasText:'BROWSER-INV-001'}).first();
  await event.locator('summary').click();
  await expect(event).toContainText('Checked sample testing certificate');
  await page.getByRole('button',{name:'Reports',exact:true}).click();
  const downloading=page.waitForEvent('download');
  await page.getByRole('link',{name:'Download report'}).click();
  const downloaded=await downloading;
  expect(downloaded.suggestedFilename()).toBe('civproj-demo-report.csv');
  const report=await readFile((await downloaded.path())!,'utf8');
  expect(report).toContain('BROWSER-INV-001');expect(report).toContain('315.32');
  await page.getByRole('combobox',{name:'Try a stakeholder role'}).selectOption('customer');
  await expect(page.locator('#project-select option')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Cost register',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Reports',exact:true}).click();
  const customerDownloading=page.waitForEvent('download');
  await page.getByRole('link',{name:'Download report'}).click();
  const customerReport=await readFile((await(await customerDownloading).path())!,'utf8');
  expect(customerReport).not.toContain('Sample testing laboratory');
  await page.getByRole('button',{name:'Reset demonstration'}).click();
  await expect(page.locator('.stat-card').first()).toBeVisible();
  await page.getByRole('button',{name:'Cost register',exact:true}).click();
  await page.getByPlaceholder('Search references, suppliers, descriptions…').fill('BROWSER-INV-001');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  expect(errors).toEqual([]);expect(network).toEqual([]);
});

test('preview can create a project, revise its budget, and reset sample state',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'Projects',exact:true}).click();
  await page.getByRole('button',{name:'New project',exact:true}).click();
  await page.getByLabel('Project name').fill('Sample airport works');
  await page.getByLabel('Customer',{exact:true}).fill('Sample airport authority');
  await page.getByLabel('Location').fill('Dubai');
  await page.getByRole('button',{name:'Create project',exact:true}).click();
  await expect(page.locator('.project-card')).toHaveCount(4);
  await page.getByRole('button',{name:/Sample airport works/}).click();
  await page.getByRole('button',{name:'Revise budget',exact:true}).click();
  await page.getByLabel('Budget amount (AED)').fill('250000.50');
  await page.getByLabel('Reason / note').fill('Sample initial budget allocation');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.stat-value').first()).toHaveAttribute('title','AED\u00a0250,000.50');
});

test('preview supports Arabic and mobile Farsi layouts',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await open(page);
  for(const language of ['ar','fa']){
    await page.getByLabel('Language / اللغة / زبان').selectOption(language);
    await expect(page.locator('html')).toHaveAttribute('dir','rtl');
    await expect(page.locator('.stat-card').first()).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  }
});
