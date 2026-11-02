import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import config from '../config/env.js';
import { AppError } from '../utils/errors.js';

const POINTS_PER_MM = 72 / 25.4;
const MIN_QR_SIZE_MM = 18;
const CLEARANCE_MM = 1.5;
const MAX_RENDER_PIXELS = 8_000_000;

function nonWhiteIntegral(data, width, height) {
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));
  for (let y = 1; y <= height; y++) {
    let row = 0;
    for (let x = 1; x <= width; x++) {
      const pixel = ((y - 1) * width + x - 1) * 4;
      if (data[pixel] < 245 || data[pixel + 1] < 245 || data[pixel + 2] < 245) row++;
      integral[y * stride + x] = integral[(y - 1) * stride + x] + row;
    }
  }
  return integral;
}

function findWhiteSquare(integral, width, height, size, margin, clearance, corner) {
  const stride = width + 1;
  const footprint = size + clearance * 2;
  const areaHasInk = (x, y) =>
    integral[(y + footprint) * stride + x + footprint] -
      integral[y * stride + x + footprint] -
      integral[(y + footprint) * stride + x] +
      integral[y * stride + x] >
    0;
  const fromLeft = corner.endsWith('left');
  const fromTop = corner.startsWith('top');
  const horizontalSpan = Math.ceil(Math.max(width * 0.25, footprint + margin));
  const verticalSpan = Math.ceil(Math.max(height * 0.28, footprint + margin));
  const minX = fromLeft ? margin : Math.max(0, width - horizontalSpan);
  const maxX = fromLeft ? Math.min(width - footprint, horizontalSpan - footprint) : width - margin - footprint;
  const minY = fromTop ? margin : Math.max(0, height - verticalSpan);
  const maxY = fromTop ? Math.min(height - footprint, verticalSpan - footprint) : height - margin - footprint;
  let best = null;
  let bestScore = -Infinity;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (areaHasInk(x, y)) continue;
      const score = (fromLeft ? width - x - footprint : x) + (fromTop ? height - y - footprint : y);
      if (score > bestScore) {
        best = { x, y };
        bestScore = score;
      }
    }
  }
  return best && { ...best, size, footprint };
}

/**
 * Renders the selected page and places the QR only where the complete square and
 * its outer clearance are blank. This follows the actual printed corner artwork
 * (including angled borders) instead of assuming a fixed offset from the page edge.
 */
export async function findQrPosition(
  pdfBuffer,
  pageNumber = config.PDF_QR_PAGE,
  { sizeMm = config.PDF_QR_SIZE_MM, marginMm = config.PDF_QR_MARGIN_MM, corner = config.PDF_QR_CORNER } = {}
) {
  if (!['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(corner)) {
    throw new AppError(500, 'INVALID_PDF_QR_CORNER', 'PDF_QR_CORNER must select one of the four page corners.');
  }

  const loadingTask = getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true });
  let canvas;
  try {
    const document = await loadingTask.promise;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.numPages) {
      throw new AppError(422, 'PDF_PAGE_NOT_FOUND', `PDF_QR_PAGE (${pageNumber}) exceeds the number of pages in this PDF.`);
    }

    const page = await document.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(1, Math.sqrt(MAX_RENDER_PIXELS / (baseViewport.width * baseViewport.height)));
    const viewport = page.getViewport({ scale });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;

    const pixels = context.getImageData(0, 0, width, height).data;
    const integral = nonWhiteIntegral(pixels, width, height);
    const minSize = Math.ceil(MIN_QR_SIZE_MM * POINTS_PER_MM * scale);
    const maxSize = Math.floor(sizeMm * POINTS_PER_MM * scale);
    const edgeMargin = Math.ceil(marginMm * POINTS_PER_MM * scale);
    const clearance = Math.ceil(CLEARANCE_MM * POINTS_PER_MM * scale);

    for (let size = maxSize; size >= minSize; size--) {
      const placement = findWhiteSquare(integral, width, height, size, edgeMargin, clearance, corner);
      if (!placement) continue;

      const x = placement.x + clearance;
      const y = placement.y + clearance;
      const qrSize = placement.size;
      const points = [
        viewport.convertToPdfPoint(x, y),
        viewport.convertToPdfPoint(x + qrSize, y),
        viewport.convertToPdfPoint(x, y + qrSize),
        viewport.convertToPdfPoint(x + qrSize, y + qrSize),
      ];
      return {
        x: Math.min(...points.map(([px]) => px)),
        y: Math.min(...points.map(([, py]) => py)),
        size: qrSize / scale,
        sizeMm: (qrSize / scale) / POINTS_PER_MM,
      };
    }
    throw new AppError(
      422,
      'PDF_QR_SPACE_NOT_FOUND',
      `No clear space of at least ${MIN_QR_SIZE_MM} mm was found in the selected page's ${corner} corner. Use a PDF with an unobstructed corner area or choose another page.`
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('[pdf] failed to analyze QR placement area', error.message);
    throw new AppError(
      422,
      'PDF_RENDER_FAILED',
      'The selected PDF page could not be analyzed for a safe QR placement. Export it as a standard, unencrypted PDF and try again.'
    );
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    await loadingTask.destroy();
  }
}

/**
 * Draws the QR image over the requested page without changing page dimensions or other pages.
 * The QR raster includes its own white quiet zone.
 */
export async function embedQrInPdf(pdfBuffer, qrBuffer) {
  if (/\/ByteRange\s*\[/.test(pdfBuffer.toString('latin1'))) {
    throw new AppError(
      422,
      'DIGITALLY_SIGNED_PDF_UNSUPPORTED',
      "Embedding a QR code would invalidate this PDF's digital signature. Add the QR code before applying a digital signature."
    );
  }

  let document;
  let pages;
  try {
    document = await PDFDocument.load(pdfBuffer, { updateMetadata: false });
    pages = document.getPages();
  } catch (error) {
    const encrypted = /encrypt/i.test(error?.message || '');
    throw new AppError(
      400,
      'INVALID_PDF',
      encrypted
        ? 'Encrypted PDFs are not supported. Remove the password protection and upload the PDF again.'
        : 'The uploaded file is not a valid, supported PDF. Check that it is not corrupt and try exporting it again.'
    );
  }

  const page = pages[config.PDF_QR_PAGE - 1];
  if (!page) {
    throw new AppError(422, 'PDF_PAGE_NOT_FOUND', `PDF_QR_PAGE (${config.PDF_QR_PAGE}) exceeds the number of pages in this PDF.`);
  }
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotation)) {
    throw new AppError(422, 'PDF_ROTATION_UNSUPPORTED', 'The selected PDF page has an unsupported rotation.');
  }
  const placement = await findQrPosition(pdfBuffer);

  try {
    const qr = await document.embedPng(qrBuffer);
    page.drawImage(qr, { x: placement.x, y: placement.y, width: placement.size, height: placement.size });
    return Buffer.from(await document.save());
  } catch (error) {
    console.error('[pdf] failed to write QR-embedded PDF', error.message);
    throw new AppError(
      422,
      'PDF_PROCESSING_FAILED',
      'The QR code could not be embedded in this PDF. Export it as a standard, unencrypted PDF and try again.'
    );
  }
}
