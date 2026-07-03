/**
 * ========================================
 * 盐阜配送 - Yanfu Delivery
 * ========================================
 * © 中哥  All Rights Reserved
 * FP_UUID_31adb5871aea40b8b0c288773f094ab2|FP_AUTHOR_中哥_SN_20260531|FP_HASH_20260531B9F3|FP_ORIGIN_2026_AUTHOR_中哥
 * ========================================
 * 严禁未经授权转载、商用，商用需联系作者授权
 * 遵循开源协议，仅限项目内部使用，商用需联系本人授权
 * ========================================
 */

'use strict';

/**
 * 商家经营报表 PDF 导出
 * 使用标准 PDF 字体，支持中文桌面环境打印
 */
const PDFDocument = require('pdfkit');

function generateReportPDF(data, merchantName) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });

  // 使用标准字体（Helvetica），保证跨平台兼容
  const f = 'Helvetica';
  const fb = 'Helvetica-Bold';

  // 标题
  doc.fontSize(22).font(fb).text('Business Report', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11).font(f).text(merchantName, { align: 'center' });
  doc.fontSize(9).fillColor('#666').text('Period: ' + data.startDate + ' ~ ' + data.endDate, { align: 'center' });
  doc.fillColor('#000');
  doc.moveDown(0.8);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#ddd');
  doc.moveDown(0.8);

  // 概要面板
  const summaryY = doc.y;
  const totalDays = Math.max(1, (() => {
    if (!data.daily || data.daily.length === 0) return 1;
    const s = new Date(data.startDate);
    const e = new Date(data.endDate);
    return Math.ceil((e - s) / 86400000) + 1;
  })());

  const items = [
    { label: 'Total Orders', value: data.totalOrders + '' },
    { label: 'Total Income', value: '\u00a5' + data.totalRevenue.toFixed(2) },
    { label: 'Daily Avg', value: (data.totalOrders / totalDays).toFixed(1) },
  ];

  items.forEach((item, i) => {
    const x = 50 + i * 155;
    doc.rect(x, summaryY, 145, 58).fill('#f5f5f5').stroke('#ddd');
    doc.fillColor('#666').fontSize(9).font(f)
      .text(item.label, x + 10, summaryY + 6, { width: 125, align: 'center' });
    doc.fillColor('#000').fontSize(16).font(fb)
      .text(item.value, x + 10, summaryY + 24, { width: 125, align: 'center' });
  });

  doc.y = summaryY + 78;
  doc.moveDown(0.5);
  doc.fontSize(14).font(fb).text('Daily Breakdown');
  doc.moveDown(0.3);

  if (!data.daily || data.daily.length === 0) {
    doc.fontSize(11).font(f).fillColor('#999').text('No completed orders in this period.');
  } else {
    const tableTop = doc.y;
    const colX = [50, 180, 310, 440];
    const headers = ['Date', 'Orders', 'Income', 'Commission'];

    // Header row
    doc.rect(50, tableTop, 495, 24).fill('#f0f0f0').stroke('#ddd');
    doc.fillColor('#000').fontSize(10).font(fb);
    headers.forEach((h, i) => doc.text(h, colX[i] + 5, tableTop + 4, { width: 110, align: 'center' }));

    let rowY = tableTop + 24;
    data.daily.forEach((d, idx) => {
      if (rowY > 740) {
        doc.addPage();
        rowY = 50;
        doc.rect(50, rowY, 495, 24).fill('#f0f0f0').stroke('#ddd');
        doc.fillColor('#000').fontSize(10).font(fb);
        headers.forEach((h, i) => doc.text(h, colX[i] + 5, rowY + 4, { width: 110, align: 'center' }));
        rowY += 24;
      }
      doc.rect(50, rowY, 495, 22).fill(idx % 2 ? '#fafafa' : '#ffffff').stroke('#eee');
      doc.fillColor('#000').fontSize(9).font(f);
      doc.text(d.date, colX[0] + 5, rowY + 3, { width: 110, align: 'center' });
      doc.text(String(d.orderCount), colX[1] + 5, rowY + 3, { width: 110, align: 'center' });
      doc.text('\u00a5' + d.revenue.toFixed(2), colX[2] + 5, rowY + 3, { width: 110, align: 'center' });
      doc.text('\u00a5' + d.commission.toFixed(2), colX[3] + 5, rowY + 3, { width: 110, align: 'center' });
      rowY += 22;
    });
  }

  // 页脚
  doc.y = Math.max(doc.y || 60, 730);
  doc.moveDown(1.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#ddd');
  doc.moveDown(0.3);
  doc.fontSize(8).fillColor('#999').font(f)
    .text('Generated: ' + new Date().toISOString().slice(0, 10) + '  |  www.ycqinnan.cn', { align: 'center' });

  doc.end();
  return doc;
}

module.exports = { generateReportPDF };
