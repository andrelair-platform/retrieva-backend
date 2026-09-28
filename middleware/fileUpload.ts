import type { Request, Response, NextFunction } from "express";
import multer from 'multer';
import path from 'path';
import { AppError } from '../utils/index.js';

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  // Images (RTV-14 Phase 1) — OCR'd via Docling during ingestion.
  'image/png',
  'image/jpeg', // .jpg / .jpeg
  'image/tiff', // .tif / .tiff
  'image/bmp',
  'image/gif',
  'image/webp',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.xlsx',
  '.xls',
  '.docx',
  '.png',
  '.jpg',
  '.jpeg',
  '.tif',
  '.tiff',
  '.bmp',
  '.gif',
  '.webp',
]);

const MAX_FILE_SIZE_MB = 25;
const MAX_FILES_PER_UPLOAD = 5;

const storage = multer.memoryStorage();

function fileFilter(_req: any, file: any, cb: any) {
  const ext = path.extname(file.originalname).toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(
      new AppError(
        `Unsupported file type: ${ext}. Allowed: pdf, xlsx, xls, docx, png, jpg, tiff, bmp, gif, webp`,
        400
      )
    );
  }

  cb(null, true);
}

export const uploadAssessmentFiles = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    files: MAX_FILES_PER_UPLOAD,
  },
}).array('files', MAX_FILES_PER_UPLOAD);

// Single-file upload for AI-assisted intake (RTV-34) — one contract, field `contract`.
const uploadContract = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024, files: 1 },
}).single('contract');

/** Runs multer for a single `contract` file, converting MulterError → AppError. */
export function contractUploadMiddleware(req: Request, res: Response, next: NextFunction) {
  uploadContract(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(`File too large. Max size is ${MAX_FILE_SIZE_MB}MB`, 400));
      }
      return next(new AppError(`Upload error: ${err.message}`, 400));
    }
    if (err) return next(err);
    next();
  });
}

// Bulk estate import (RTV-69) — one CSV/XLSX/XLS spreadsheet, field `estate`. CSV is allowed here
// (it is not in the contract/assessment allow-lists) with its several real-world mime types.
const ESTATE_EXTENSIONS = new Set(['.csv', '.xlsx', '.xls']);
const ESTATE_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel', // browsers often send this for .csv too
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', // some clients label .csv as text/plain
  'application/octet-stream', // fallback some clients use
]);
const uploadEstate = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024, files: 1 },
  fileFilter(_req: any, file: any, cb: any) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ESTATE_EXTENSIONS.has(ext) || !ESTATE_MIME_TYPES.has(file.mimetype)) {
      return cb(
        new AppError(`Unsupported estate file: ${ext} (${file.mimetype}). Allowed: csv, xlsx, xls`, 400)
      );
    }
    cb(null, true);
  },
}).single('estate');

/** Runs multer for a single `estate` spreadsheet (csv/xlsx/xls), converting MulterError → AppError. */
export function estateUploadMiddleware(req: Request, res: Response, next: NextFunction) {
  uploadEstate(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(`File too large. Max size is ${MAX_FILE_SIZE_MB}MB`, 400));
      }
      return next(new AppError(`Upload error: ${err.message}`, 400));
    }
    if (err) return next(err);
    next();
  });
}

/**
 * Express middleware that runs multer and converts MulterError to AppError.
 * Place this in the route chain before validateBody and the controller.
 */
export function assessmentUploadMiddleware(req: Request, res: Response, next: NextFunction) {
  uploadAssessmentFiles(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(`File too large. Max size is ${MAX_FILE_SIZE_MB}MB`, 400));
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return next(
          new AppError(`Too many files. Max ${MAX_FILES_PER_UPLOAD} files per upload`, 400)
        );
      }
      return next(new AppError(`Upload error: ${err.message}`, 400));
    }
    if (err) return next(err);
    next();
  });
}
