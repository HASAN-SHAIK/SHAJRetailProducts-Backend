const loadPdfParse = async () => {
  const mod = await import('pdf-parse');
  return mod.default || mod;
};
const loadTesseract = async () => {
  const mod = await import('tesseract.js');
  return mod.default || mod;
};
const loadPdfPoppler = async () => {
  const mod = await import('pdf-poppler');
  return mod.default || mod;
};
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const pool = require('../db');
const { resolveGstPercentage, upsertHsnGst } = require('./hsnGst.service');

const getRequestPool = (req) => req.tenantPool || pool;

const normalizeNumber = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeOptionalText = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const toCompactTimestamp = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
};

const buildAutoBatchNumber = (productId, index) =>
  `PB-${productId}-${toCompactTimestamp()}-${index + 1}`;

const ensureUniqueBatchNumber = async (client, productId, branchId, requestedBatchNumber) => {
  let candidate = String(requestedBatchNumber || '').trim();
  if (!candidate) return null;
  let suffix = 1;
  while (true) {
    const duplicateRes = await client.query(
      `SELECT id
       FROM batches
       WHERE product_id = $1
         AND is_deleted = FALSE
         AND batch_number = $2
         AND (
           ($3::uuid IS NULL AND branch_id IS NULL) OR
           branch_id = $3::uuid
         )
       LIMIT 1`,
      [productId, candidate, branchId || null]
    );
    if (duplicateRes.rowCount === 0) {
      return candidate;
    }
    candidate = `${requestedBatchNumber}-${suffix}`;
    suffix += 1;
  }
};

const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const normalizeText = (text) => String(text || '').replace(/\s+/g, ' ').trim();

const normalizeMergedLine = (line) => {
  if (!line) return '';
  let fixed = String(line);
  // Insert spaces between digits and letters (both directions)
  fixed = fixed.replace(/(\d)([A-Za-z])/g, '$1 $2');
  fixed = fixed.replace(/([A-Za-z])(\d)/g, '$1 $2');
  // Separate percent from numbers if stuck
  fixed = fixed.replace(/(\d)%/g, '$1 %');
  // Separate slashed dates stuck to text/numbers
  fixed = fixed.replace(/([A-Za-z])(\d{1,2}\/\d{2,4})/g, '$1 $2');
  fixed = fixed.replace(/(\d{1,2}\/\d{2,4})([A-Za-z])/g, '$1 $2');
  // Collapse extra spaces
  fixed = fixed.replace(/\s+/g, ' ').trim();
  return fixed;
};

const isTextWeak = (text) => {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return true;
  if (cleaned.length < 50) return true;
  const alpha = cleaned.replace(/[^a-zA-Z0-9]/g, '');
  if (alpha.length / Math.max(cleaned.length, 1) < 0.15) return true;
  return false;
};

const confidenceFromParsed = (parsed) => {
  if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) return 0.1;
  const expectedFields = ['product_name', 'quantity', 'purchase_price', 'gst_percent', 'total', 'batch_number', 'expiry_date'];
  let totalPossible = 0;
  let totalFound = 0;
  for (const item of parsed.items) {
    totalPossible += expectedFields.length;
    expectedFields.forEach((field) => {
      const value = item?.[field];
      if (value !== null && value !== undefined && value !== '') {
        totalFound += 1;
      }
    });
  }
  const ratio = totalPossible > 0 ? totalFound / totalPossible : 0.1;
  if (ratio >= 0.8) return 0.9;
  if (ratio >= 0.6) return 0.75;
  if (ratio >= 0.4) return 0.6;
  if (ratio >= 0.2) return 0.4;
  return 0.2;
};

const parseDelimitedLine = (line) => {
  if (line.includes('|')) {
    return line.split('|').map((part) => part.trim());
  }
  if (line.includes('\t')) {
    return line.split('\t').map((part) => part.trim());
  }
  return line.split(/\s{2,}/).map((part) => part.trim());
};

const standardizeHeaderToken = (token) => {
  const t = token.toLowerCase();
  if (t.includes('qty')) return 'qty';
  if (t.includes('quantity')) return 'qty';
  if (t.includes('rate') || t.includes('price')) return 'price';
  if (t.includes('amount') || t.includes('total')) return 'amount';
  if (t.includes('hsn')) return 'hsn';
  if (t.includes('gst')) return 'gst';
  if (t.includes('product') || t.includes('item') || t.includes('name')) return 'name';
  if (t.includes('batch')) return 'batch';
  if (t.includes('expiry') || t.includes('exp')) return 'expiry';
  return t;
};

const parseDateToIso = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  const monthMap = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };
  const match = raw.match(/(\d{1,2})[-/ ]([A-Za-z]{3}|\d{1,2})[-/ ](\d{2,4})/);
  if (!match) return raw;
  const day = match[1].padStart(2, '0');
  const monRaw = match[2].toLowerCase();
  const month = monthMap[monRaw] || monRaw.padStart(2, '0');
  if (/^\d+$/.test(month) && Number(month) > 12) return raw;
  let year = match[3];
  if (year.length === 2) year = `20${year}`;
  return `${year}-${month}-${day}`;
};

const extractHeader = (lines) => {
  const text = lines.join('\n');
  const gstMatch = text.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z0-9][A-Z0-9]\b/);
  const mobileMatch = text.match(/mobile[:\-]?\s*([0-9+\- ]{8,})/i) || text.match(/phone[:\-]?\s*([0-9+\- ]{8,})/i);
  const labelOrder = [
    { key: 'invoice_number', re: /invoice\s*number|invoice\s*no/i },
    { key: 'invoice_date', re: /invoice\s*date/i },
    { key: 'due_date', re: /due\s*date/i },
    { key: 'place_of_supply', re: /place\s*of\s*supply/i },
    { key: 'reverse_charge', re: /reverse\s*charge/i }
  ];

  const extractLabeledBlock = () => {
    const found = [];
    let cursor = 0;
    for (const label of labelOrder) {
      let hitIndex = -1;
      for (let i = cursor; i < lines.length; i += 1) {
        const line = lines[i];
        const next = lines[i + 1] || '';
        const combined = `${line} ${next}`.trim();
        if (label.re.test(line) || label.re.test(combined)) {
          hitIndex = i;
          cursor = i + 1;
          found.push({ key: label.key, index: i });
          break;
        }
      }
      if (hitIndex === -1) break;
    }
    if (found.length < 2) return null;
    const lastLabelIndex = found[found.length - 1].index;
    const values = [];
    for (let j = lastLabelIndex + 1; j < lines.length; j += 1) {
      const line = lines[j].trim();
      if (!line) continue;
      if (line.startsWith(':')) {
        values.push(line.slice(1).trim());
      } else if (/^\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4}$/.test(line) || /^[A-Za-z0-9].+/.test(line)) {
        values.push(line.trim());
      }
      if (values.length >= found.length) break;
    }
    if (values.length < 2) return null;
    const map = {};
    found.forEach((label, idx) => {
      map[label.key] = values[idx] ?? null;
    });
    return map;
  };

  const blockValues = extractLabeledBlock() || {};

  const getValueAfterLabel = (labelRegex) => {
    const otherLabelRe = /(invoice|due|place|reverse|billing|gstin|number|date|supply|charge)/i;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const next = lines[i + 1] || '';
      const combined = `${line} ${next}`.trim();
      const matchesHere = labelRegex.test(line) || labelRegex.test(combined);
      if (!matchesHere) continue;

      const splitTarget = line.includes(':') ? line : combined.includes(':') ? combined : line;
      const sameLine = splitTarget.split(':');
      if (sameLine.length > 1) {
        const value = sameLine.slice(1).join(':').trim();
        if (value) return value;
      }
      // check next 1-3 lines for value or prefixed with ':'
      const startIdx = labelRegex.test(line) ? i + 1 : i + 2;
      for (let j = startIdx; j <= i + 3 && j < lines.length; j += 1) {
        const nextLine = lines[j].trim();
        if (!nextLine) continue;
        if (nextLine.startsWith(':')) {
          const val = nextLine.slice(1).trim();
          if (val) return val;
        } else if (!labelRegex.test(nextLine) && !otherLabelRe.test(nextLine)) {
          return nextLine;
        }
      }
    }
    return null;
  };

  const invoiceNumber = getValueAfterLabel(/invoice\s*number/i) || getValueAfterLabel(/invoice\s*no/i);
  const invoiceDate = getValueAfterLabel(/invoice\s*date/i);
  const dueDate = getValueAfterLabel(/due\s*date/i);
  const placeOfSupply = getValueAfterLabel(/place\s*of\s*supply/i);
  const reverseCharge = getValueAfterLabel(/reverse\s*charge/i);

  const headerLines = lines.slice(0, Math.min(lines.length, 14));
  const ignoreRe = /(invoice|tax|gstin|page\s*no|original\s*copy|billing\s*details|number|due\s*date|place\s*of\s*supply|reverse\s*charge)/i;
  const sellerName =
    headerLines.find((line) => line && !ignoreRe.test(line)) || null;
  const addressLines = headerLines.filter((line) => line !== sellerName && !ignoreRe.test(line));

  const gstFallback = text.match(/gstin\s*[-:]?\s*([A-Z0-9]{15})/i);
  const gstValue = gstMatch ? gstMatch[0] : gstFallback ? gstFallback[1] : null;

  return {
    invoice_number: blockValues.invoice_number ? blockValues.invoice_number.trim() : invoiceNumber ? invoiceNumber.trim() : null,
    invoice_date: blockValues.invoice_date ? parseDateToIso(blockValues.invoice_date) : invoiceDate ? parseDateToIso(invoiceDate) : null,
    due_date: blockValues.due_date ? parseDateToIso(blockValues.due_date) : dueDate ? parseDateToIso(dueDate) : null,
    place_of_supply: blockValues.place_of_supply ? blockValues.place_of_supply.trim() : placeOfSupply ? placeOfSupply.trim() : null,
    reverse_charge: blockValues.reverse_charge
      ? blockValues.reverse_charge.toLowerCase().includes('yes')
      : reverseCharge
        ? reverseCharge.toLowerCase().includes('yes')
        : null,
    seller: {
      name: sellerName ? sellerName.trim() : null,
      address: addressLines.length ? addressLines.join(', ') : null,
      gstin: gstValue,
      mobile: mobileMatch ? mobileMatch[1].trim() : null
    }
  };
};

const extractTotals = (lines) => {
  const text = lines.join(' ');
  const totalMatch = text.match(/grand\s*total[:\-]?\s*([0-9]+(?:\.[0-9]{1,2})?)/i) ||
    text.match(/\btotal[:\-]?\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  const cgstMatch = text.match(/cgst[:\-]?\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  const sgstMatch = text.match(/sgst[:\-]?\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  const subtotalMatch = text.match(/sub\s*total[:\-]?\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  const totalTax = (normalizeNumber(cgstMatch?.[1]) || 0) + (normalizeNumber(sgstMatch?.[1]) || 0);
  return {
    subtotal: normalizeNumber(subtotalMatch?.[1]),
    cgst: normalizeNumber(cgstMatch?.[1]),
    sgst: normalizeNumber(sgstMatch?.[1]),
    total_tax: totalTax || null,
    grand_total: normalizeNumber(totalMatch?.[1])
  };
};

const extractBank = (lines) => {
  const text = lines.join('\n');
  let accountMatch = text.match(/account\s*(?:no|number)[:\-]?\s*([0-9]+)/i);
  if (!accountMatch) {
    for (let i = 0; i < lines.length - 1; i += 1) {
      if (/account\s*(?:no|number)/i.test(lines[i])) {
        const nextLine = lines[i + 1]?.trim();
        if (nextLine && /^\d{6,}$/.test(nextLine)) {
          accountMatch = [nextLine, nextLine];
          break;
        }
      }
    }
  }
  const ifscMatch = text.match(/ifsc[:\-]?\s*([A-Z0-9]+)/i);
  const bankMatch = text.match(/bank[:\-]?\s*([A-Za-z ]+)/i);
  const holderMatch = text.match(/account\s*holder[:\-]?\s*(.+)/i);
  return {
    account_number: accountMatch ? accountMatch[1] : null,
    ifsc: ifscMatch ? ifscMatch[1] : null,
    bank_name: bankMatch ? bankMatch[1].trim() : null,
    account_holder: holderMatch ? holderMatch[1].trim() : null
  };
};

const extractItems = (lines) => {
  const mergedRows = [];
  const headerHint = /(sr\.?|s\.?\s*no|item|description|hsn|batch|expiry|qty|amount)/i;
  for (const raw of lines) {
    const line = normalizeMergedLine(raw);
    if (!line) continue;

    if (/^\d+\.?\s+/.test(line)) {
      mergedRows.push(line);
      continue;
    }

    // Handle header + first item on same line
    if (headerHint.test(line) && /\b\d+\.?\s+[A-Za-z]/.test(line)) {
      const parts = line.split(/(?=\b\d+\.?\s+)/).map((part) => part.trim()).filter(Boolean);
      parts.forEach((part) => {
        if (/^\d+\.?\s+/.test(part)) {
          mergedRows.push(part);
        }
      });
      continue;
    }

    if (mergedRows.length) {
      mergedRows[mergedRows.length - 1] = `${mergedRows[mergedRows.length - 1]} ${line}`.trim();
    }
  }

  const items = [];
  for (const rawRow of mergedRows) {
    let row = normalizeMergedLine(rawRow);
    const lower = row.toLowerCase();
    if (lower.includes('invoice') || lower.includes('gstin')) continue;

    const serialMatch = row.match(/^\d+\.?\s+/);
    if (serialMatch) {
      row = row.slice(serialMatch[0].length).trim();
    }

    const extractLastMatch = (regex) => {
      const match = row.match(regex);
      if (!match) return null;
      row = row.replace(match[0], '').trim();
      return match;
    };

    const amountMatch = extractLastMatch(/(\d+(?:\.\d{1,2})?)\s*$/);
    const gstPercentMatch = extractLastMatch(/(\d{1,2}(?:\.\d{1,2})?)\s*%?\s*$/);
    const discountMatch = extractLastMatch(/(\d+(?:\.\d{1,2})?)\s*$/);
    const unitPriceMatch = extractLastMatch(/(\d+(?:\.\d{1,2})?)\s*$/);
    const qtyMatch = extractLastMatch(/(\d+(?:\.\d+)?|\d+\.)\s*$/);

    const expiryMatch = row.match(/\b\d{1,2}\/\d{2,4}\b/);
    if (expiryMatch) {
      row = row.replace(expiryMatch[0], '').trim();
    }

    const batchMatch = row.match(/\b[A-Z]{1,4}[0-9]{2,}\b/i);
    if (batchMatch) {
      row = row.replace(batchMatch[0], '').trim();
    }

    const hsnMatch = row.match(/\b\d{4,8}\b/);
    if (hsnMatch) {
      row = row.replace(hsnMatch[0], '').trim();
    }

    const productName = row.replace(/\s+/g, ' ').trim();
    const quantity = normalizeNumber(qtyMatch?.[1] ? qtyMatch[1].replace(/\.$/, '') : null);
    const purchase_price = normalizeNumber(unitPriceMatch?.[1]);
    const gst_percent = normalizeNumber(gstPercentMatch?.[1]);
    const total = normalizeNumber(amountMatch?.[1]);

    if (!productName || !quantity || !purchase_price) continue;

    items.push({
      product_name: productName,
      quantity,
      purchase_price,
      gst_percent,
      total,
      batch_number: batchMatch ? batchMatch[0] : null,
      expiry_date: expiryMatch ? expiryMatch[0] : null
    });
  }
  return items;
};

const parseInvoiceText = (text) => {
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    return {
      invoice_number: null,
      invoice_date: null,
      due_date: null,
      place_of_supply: null,
      reverse_charge: null,
      seller: { name: null, address: null, gstin: null, mobile: null },
      items: [],
      totals: { subtotal: null, cgst: null, sgst: null, total_tax: null, grand_total: null },
      bank_details: { account_number: null, ifsc: null, bank_name: null, account_holder: null }
    };
  }

  const rawLines = cleanText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const normalizedLines = rawLines.map(normalizeMergedLine);

  // Step 1: isolate item section
  const startIdx = normalizedLines.findIndex((line) => {
    const lower = line.toLowerCase();
    return lower.includes('s.no') || lower.includes('sno') || lower.startsWith('1 ');
  });
  let endIdx = normalizedLines.findIndex((line) => {
    const lower = line.toLowerCase();
    return lower.includes('grand total') || lower.startsWith('total') || lower.includes('total:');
  });
  if (endIdx === -1) endIdx = normalizedLines.length;
  const itemSection = normalizedLines.slice(startIdx === -1 ? 0 : startIdx, endIdx);
  const header = extractHeader(normalizedLines);
  const items = extractItems(itemSection);
  const totals = extractTotals(normalizedLines);
  const bank = extractBank(normalizedLines);

  const computedSum = items.reduce((sum, item) => {
    const qty = normalizeNumber(item.quantity);
    const price = normalizeNumber(item.purchase_price);
    const lineTotal = normalizeNumber(item.total);
    if (Number.isFinite(lineTotal)) return sum + lineTotal;
    if (Number.isFinite(qty) && Number.isFinite(price)) return sum + qty * price;
    return sum;
  }, 0);
  if (totals.grand_total === null && computedSum > 0) {
    totals.grand_total = Number(computedSum.toFixed(2));
  }

  return {
    invoice_number: header.invoice_number,
    invoice_date: header.invoice_date,
    due_date: header.due_date,
    place_of_supply: header.place_of_supply,
    reverse_charge: header.reverse_charge,
    seller: header.seller,
    items,
    totals,
    bank_details: bank
  };
};

const extractTextFromDocument = async (file) => {
  if (!file) {
    const error = new Error('file is required');
    error.status = 400;
    throw error;
  }
  const filename = String(file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();
  const warnings = [];

  if (!file.buffer || file.buffer.length === 0) {
    const error = new Error('file is empty');
    error.status = 400;
    throw error;
  }

  const isPdf = mime.includes('pdf') || filename.endsWith('.pdf');
  const isImage = mime.includes('png') || mime.includes('jpeg') || filename.match(/\.(png|jpg|jpeg)$/);

  if (!isPdf && !isImage) {
    const error = new Error('Unsupported file type');
    error.status = 400;
    throw error;
  }

  if (isPdf) {
    try {
      const pdfParse = await loadPdfParse();
      const data = await pdfParse(file.buffer);
      const text = String(data.text || '').trim();
      if (!isTextWeak(text)) {
        return { text, method: 'pdf-text', warnings };
      }
      warnings.push('text_extraction_weak');
    } catch (err) {
      warnings.push('pdf_text_failed');
    }

    // OCR fallback for PDFs
    try {
      const pdfPoppler = await loadPdfPoppler();
      const tempDir = path.join(os.tmpdir(), `invoice-${crypto.randomUUID()}`);
      fs.mkdirSync(tempDir, { recursive: true });
      const pdfPath = path.join(tempDir, 'input.pdf');
      fs.writeFileSync(pdfPath, file.buffer);
      const outputPrefix = path.join(tempDir, 'page');
      await pdfPoppler.convert(pdfPath, {
        format: 'png',
        out_dir: tempDir,
        out_prefix: 'page',
        page: null
      });
      const files = fs.readdirSync(tempDir).filter((f) => f.startsWith('page') && f.endsWith('.png'));
      const tesseract = await loadTesseract();
      let combined = '';
      for (const img of files) {
        const imgPath = path.join(tempDir, img);
        const { data } = await tesseract.recognize(imgPath);
        combined += `\n${data?.text || ''}`;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
      return { text: combined.trim(), method: 'ocr-pdf', warnings };
    } catch (err) {
      warnings.push('ocr_pdf_failed');
    }
  }

  if (isImage) {
    try {
      const tesseract = await loadTesseract();
      const { data } = await tesseract.recognize(file.buffer);
      return { text: String(data?.text || '').trim(), method: 'ocr-image', warnings };
    } catch (err) {
      warnings.push('ocr_image_failed');
    }
  }

  return { text: '', method: 'none', warnings };
};

const parseInvoice = async (req, file) => {
  if (!file) {
    const error = new Error('file is required');
    error.status = 400;
    throw error;
  }
  const start = Date.now();
  const result = await extractTextFromDocument(file);
  const rawText = result.text || '';
  const parsed = parseInvoiceText(rawText);
  const confidence = confidenceFromParsed(parsed);
  const extractionMethod = result.method || 'none';
  const warnings = [...(result.warnings || [])];

  const durationMs = Date.now() - start;
  console.log('[invoice-parse]', {
    extraction_method: extractionMethod,
    confidence_score: confidence,
    parsing_time_ms: durationMs
  });

  return {
    raw_text: rawText,
    parsed_data: parsed,
    confidence_score: confidence,
    extraction_method: extractionMethod,
    warnings
  };
};

const resolveGstMode = (req) => {
  const raw = req?.tenant?.gst_mode || req?.tenant?.gstMode || null;
  const mode = String(raw || 'INCLUSIVE').trim().toUpperCase();
  return mode === 'EXCLUSIVE' ? 'EXCLUSIVE' : 'INCLUSIVE';
};

const matchProducts = async (req, items = [], branchId = null) => {
  const requestPool = getRequestPool(req);
  const results = [];
  for (const item of items) {
    const name = String(item.product_name || item.name || '').trim();
    const barcode = item.barcode ? String(item.barcode).trim() : null;
    let match = null;
    let matchType = null;

    if (barcode) {
      const res = await requestPool.query(
        `SELECT id, name, barcode
         FROM products
         WHERE barcode = $1
           AND is_deleted = FALSE
           AND ($2::uuid IS NULL OR branch_id = $2)
         LIMIT 1`,
        [barcode, branchId]
      );
      if (res.rowCount > 0) {
        match = res.rows[0];
        matchType = 'barcode';
      }
    }

    if (!match && name) {
      const exactRes = await requestPool.query(
        `SELECT id, name
         FROM products
         WHERE LOWER(name) = LOWER($1)
           AND is_deleted = FALSE
           AND ($2::uuid IS NULL OR branch_id = $2)
         ORDER BY id ASC
         LIMIT 1`,
        [name, branchId]
      );
      if (exactRes.rowCount > 0) {
        match = exactRes.rows[0];
        matchType = 'exact';
      }
    }

    if (!match && name) {
      try {
        const fuzzyRes = await requestPool.query(
          `SELECT id, name, similarity(name, $1) AS score
           FROM products
           WHERE is_deleted = FALSE
             AND ($2::uuid IS NULL OR branch_id = $2)
             AND similarity(name, $1) > 0.6
           ORDER BY score DESC
           LIMIT 1`,
          [name, branchId]
        );
        if (fuzzyRes.rowCount > 0) {
          match = fuzzyRes.rows[0];
          matchType = 'fuzzy';
        }
      } catch {
        const fallbackRes = await requestPool.query(
          `SELECT id, name
           FROM products
           WHERE name ILIKE $1
             AND is_deleted = FALSE
             AND ($2::uuid IS NULL OR branch_id = $2)
           ORDER BY id ASC
           LIMIT 1`,
          [`%${name}%`, branchId]
        );
        if (fallbackRes.rowCount > 0) {
          match = fallbackRes.rows[0];
          matchType = 'contains';
        }
      }
    }

    results.push({
      ...item,
      product_id: match ? match.id : null,
      match_type: matchType,
      match_status: match ? 'MATCHED' : 'NEW_PRODUCT'
    });
  }
  return results;
};

const savePurchase = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) {
    const error = new Error('items must be a non-empty array');
    error.status = 400;
    throw error;
  }

  const branchId = payload.branch_id;
  if (branchId && !isUuid(branchId)) {
    const error = new Error('branch_id is invalid');
    error.status = 400;
    throw error;
  }
  const supplierId = normalizeNumber(payload.supplier_id);
  if (!Number.isFinite(supplierId)) {
    const error = new Error('supplier_id is required');
    error.status = 400;
    throw error;
  }
  const invoiceNumber = normalizeOptionalText(payload.invoice_number || payload.invoiceNumber || null);

  const client = await requestPool.connect();
  try {
    await client.query('BEGIN');
    const supplierRes = await client.query('SELECT id FROM suppliers WHERE id = $1 AND is_deleted = FALSE', [supplierId]);
    if (supplierRes.rowCount === 0) {
      const error = new Error('supplier not found');
      error.status = 400;
      throw error;
    }
    if (invoiceNumber) {
      const dupRes = await client.query(
        `SELECT id FROM orders
         WHERE supplier_id = $1
           AND transaction_type = 'purchase'
           AND invoice_number = $2
         LIMIT 1`,
        [supplierId, invoiceNumber]
      );
      if (dupRes.rowCount > 0) {
        const error = new Error('duplicate invoice_number for supplier');
        error.status = 400;
        throw error;
      }
    }
    const results = [];
    const gstMode = resolveGstMode(req);
    const paymentMode = normalizeOptionalText(payload.payment_mode || payload.paymentMode || null);

    const orderRes = await client.query(
      `INSERT INTO orders (supplier_id, branch_id, total_price, payment_mode, transaction_type, gst_mode, is_gst_enabled, invoice_number)
       VALUES ($1, $2, 0, $3, 'purchase', $4, TRUE, $5)
       RETURNING id`,
      [supplierId, branchId || null, paymentMode, gstMode, invoiceNumber]
    );
    const orderId = orderRes.rows[0].id;

    let totalPrice = 0;
    let batchIndex = 1;

    for (const item of items) {
      const name = String(item.product_name || item.name || '').trim();
      const qty = normalizeNumber(item.qty ?? item.quantity);
      const purchase_price = normalizeNumber(item.purchase_price);
      if (!name || !qty || !purchase_price) {
        continue;
      }
      const hsn = item.hsn ? String(item.hsn).trim() : null;
      let gst_percent = normalizeNumber(item.gst_percent ?? item.gstPercent);
      if (gst_percent === null) {
        gst_percent = await resolveGstPercentage({ tenantPool: client }, hsn);
      } else if (hsn) {
        await upsertHsnGst(client, hsn, gst_percent);
      }
      const batch_number = item.batch_number ? String(item.batch_number).trim() : '';
      const expiry_date = item.expiry_date ? new Date(item.expiry_date) : null;
      const selling_price = normalizeNumber(item.selling_price);

      let productId = normalizeNumber(item.product_id);
      let existingSelling = null;

      if (productId) {
        const existingRes = await client.query(
          `SELECT id, selling_price FROM products WHERE id = $1 AND is_deleted = FALSE`,
          [productId]
        );
        if (existingRes.rowCount === 0) {
          productId = null;
        } else {
          existingSelling = existingRes.rows[0].selling_price;
        }
      }

      if (!productId) {
        const byNameRes = await client.query(
          `SELECT id, selling_price FROM products
           WHERE LOWER(name) = LOWER($1) AND is_deleted = FALSE
           ORDER BY id ASC
           LIMIT 1`,
          [name]
        );
        if (byNameRes.rowCount > 0) {
          productId = byNameRes.rows[0].id;
          existingSelling = byNameRes.rows[0].selling_price;
        }
      }

      if (!productId) {
        const insertRes = await client.query(
          `INSERT INTO products
            (name, category, selling_price, mrp, purchase_price, hsn_code, gst_percentage, stock_quantity, branch_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8)
           RETURNING id, selling_price`,
          [
            name,
            item.category || null,
            selling_price || purchase_price,
            normalizeNumber(item.mrp),
            purchase_price,
            hsn,
            gst_percent,
            branchId || null
          ]
        );
        productId = insertRes.rows[0].id;
        existingSelling = insertRes.rows[0].selling_price;
      }

      const generatedBatch = buildAutoBatchNumber(productId, batchIndex);
      const resolvedBatch = await ensureUniqueBatchNumber(
        client,
        productId,
        branchId || null,
        batch_number || generatedBatch
      );

      const batchInsertRes = await client.query(
        `INSERT INTO batches (product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, quantity, quantity_remaining, purchase_order_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)
         RETURNING id`,
        [
          productId,
          branchId || null,
          resolvedBatch,
          expiry_date && !Number.isNaN(expiry_date.getTime()) ? expiry_date : null,
          purchase_price,
          selling_price || existingSelling || null,
          qty,
          orderId
        ]
      );

      await client.query(
        `INSERT INTO order_items (order_id, product_id, batch_id, quantity, selling_price, purchase_price_snapshot, gst_percent)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          orderId,
          productId,
          batchInsertRes.rows[0].id,
          qty,
          selling_price || existingSelling || null,
          purchase_price,
          gst_percent || 0
        ]
      );

      const updateValues = [qty, purchase_price, productId];
      let updateSql =
        'UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + $1, purchase_price = $2, purchase_price = $2';
      if (selling_price) {
        updateSql += ', selling_price = $4';
        updateValues.push(selling_price);
      }
      updateSql += ' WHERE id = $3';

      await client.query(updateSql, updateValues);

      const base = qty * purchase_price;
      const gstAmount = gstMode === 'EXCLUSIVE' ? (base * (gst_percent || 0)) / 100 : 0;
      totalPrice += base + gstAmount;

      results.push({ product_id: productId, qty, purchase_price, selling_price: selling_price || null });
      batchIndex += 1;
    }

    await client.query(
      `UPDATE orders
       SET total_price = $1
       WHERE id = $2`,
      [totalPrice, orderId]
    );

    if (String(paymentMode || '').toLowerCase() === 'credit') {
      await client.query(
        `UPDATE suppliers
         SET current_balance = COALESCE(current_balance, 0) + $1
         WHERE id = $2`,
        [totalPrice, supplierId]
      );
    }

    const requestId = normalizeNumber(payload.purchase_request_id);
    if (Number.isFinite(requestId)) {
      await client.query(
        `UPDATE purchase_requests
         SET status = 'COMPLETED'
         WHERE id = $1`,
        [requestId]
      );
    }
    await client.query('COMMIT');
    return { order_id: orderId, total_price: totalPrice, items: results };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  extractTextFromDocument,
  parseInvoiceText,
  matchProducts,
  parseInvoice,
  savePurchase
};
