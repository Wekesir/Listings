const fs = require("fs");
const path = require("path");
const multer = require("multer");
const sharp = require("sharp");

const UPLOAD_ROOT = path.join(__dirname, "../../uploads/properties");
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
const WATERMARK_TEXT = String(process.env.PROPERTY_IMAGE_WATERMARK_TEXT || "KenReal Estates");
const WATERMARK_OPACITY = Number(process.env.PROPERTY_IMAGE_WATERMARK_OPACITY || 0.16);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_ROOT);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = ext || "";
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${safeExt}`);
  }
});

function fileFilter(req, file, cb) {
  const fieldName = String(file.fieldname || "");
  const mimeType = String(file.mimetype || "").toLowerCase();

  if (fieldName === "images") {
    if (!mimeType.startsWith("image/")) {
      return cb(new Error("Only image files are allowed for listing images."));
    }
    return cb(null, true);
  }

  if (fieldName === "video") {
    if (!mimeType.startsWith("video/")) {
      return cb(new Error("Only video files are allowed for listing video."));
    }
    return cb(null, true);
  }

  return cb(new Error("Unexpected upload field."));
}

function escapeSvgText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildWatermarkSvg({ width, height, text, opacity }) {
  const safeText = escapeSvgText(text);
  const watermarkOpacity = clamp(Number(opacity), 0.05, 0.4);
  const dotSize = Math.round(height * 0.16);
  const titleSize = Math.round(height * 0.26);
  const subtitleSize = Math.round(height * 0.13);

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <g opacity="${watermarkOpacity}">
        <rect x="0" y="0" width="${width}" height="${height}" rx="${Math.round(height * 0.16)}" fill="rgba(0,0,0,0.18)" />
        <text x="50%" y="46%" text-anchor="middle" dominant-baseline="middle" fill="white"
          font-family="Inter, Segoe UI, Arial, sans-serif" font-size="${titleSize}" font-weight="700" letter-spacing="0.8">
          ${safeText}
        </text>
        <circle cx="50%" cy="58%" r="${dotSize}" fill="#E8A020" />
        <text x="50%" y="76%" text-anchor="middle" dominant-baseline="middle" fill="white"
          font-family="Inter, Segoe UI, Arial, sans-serif" font-size="${subtitleSize}" font-weight="600" letter-spacing="1.2">
          PROPERTY PLATFORM
        </text>
      </g>
    </svg>
  `;
}

async function applyCenteredWatermark(filePath) {
  const image = sharp(filePath, { failOn: "none" });
  const metadata = await image.metadata();
  const imageWidth = Number(metadata.width || 0);
  const imageHeight = Number(metadata.height || 0);

  if (imageWidth <= 0 || imageHeight <= 0) {
    return;
  }

  const watermarkWidth = clamp(Math.round(imageWidth * 0.48), 180, 820);
  const watermarkHeight = clamp(Math.round(watermarkWidth * 0.30), 70, 280);
  const overlaySvg = buildWatermarkSvg({
    width: watermarkWidth,
    height: watermarkHeight,
    text: WATERMARK_TEXT,
    opacity: WATERMARK_OPACITY
  });
  const format = metadata.format && ["jpeg", "jpg", "png", "webp", "avif", "tiff"].includes(metadata.format)
    ? metadata.format
    : null;
  const tmpOutputPath = `${filePath}.wm`;

  let transformed = sharp(filePath).rotate().composite([
    {
      input: Buffer.from(overlaySvg),
      gravity: "center"
    }
  ]);
  if (format) {
    transformed = transformed.toFormat(format);
  }
  await transformed.toFile(tmpOutputPath);
  await fs.promises.rename(tmpOutputPath, filePath);
}

function getAllUploadedFiles(req) {
  const images = Array.isArray(req.files?.images) ? req.files.images : [];
  const video = Array.isArray(req.files?.video) ? req.files.video : [];
  return [...images, ...video];
}

async function cleanupUploadedFiles(req) {
  const allFiles = getAllUploadedFiles(req);
  await Promise.allSettled(
    allFiles.map((file) => {
      const filePath = String(file?.path || "").trim();
      if (!filePath) return Promise.resolve();
      return fs.promises.unlink(filePath);
    })
  );
}

async function watermarkUploadedPropertyImages(req) {
  const images = Array.isArray(req.files?.images) ? req.files.images : [];
  for (const file of images) {
    const filePath = String(file?.path || "").trim();
    if (!filePath) continue;
    await applyCenteredWatermark(filePath);
  }
}

const propertyUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50 MB per file
  }
});

const uploadPropertyMediaFields = propertyUpload.fields([
  { name: "images", maxCount: 12 },
  { name: "video", maxCount: 1 }
]);
const propertyMediaUpload = (req, res, next) => {
  uploadPropertyMediaFields(req, res, async (error) => {
    if (error) {
      return next(error);
    }
    try {
      await watermarkUploadedPropertyImages(req);
      return next();
    } catch (_error) {
      await cleanupUploadedFiles(req);
      return next(new Error("Failed to process uploaded listing images."));
    }
  });
};

module.exports = {
  propertyMediaUpload
};
