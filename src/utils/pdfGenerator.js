const puppeteer = require('puppeteer');
const { buildPuppeteerLaunchOptions } = require('../security/puppeteerLaunchPolicy');

const generatePDF = async (html) => {
  const browser = await puppeteer.launch(buildPuppeteerLaunchOptions({
    environment: process.env.APP_ENVIRONMENT || process.env.NODE_ENV || 'development',
    allowNoSandbox: process.env.PUPPETEER_ALLOW_NO_SANDBOX,
  }));
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        bottom: '20px',
        left: '20px',
        right: '20px'
      }
    });
    return pdf;
  } finally {
    await browser.close();
  }
};

module.exports = { generatePDF };
