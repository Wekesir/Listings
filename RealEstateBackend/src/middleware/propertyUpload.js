const fs = require("fs");
const path = require("path");
const multer = require("multer");

const UPLOAD_ROOT = path.join(__dirname, "../../uploads/properties");
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

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

const propertyUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50 MB per file
  }
});

const propertyMediaUpload = propertyUpload.fields([
  { name: "images", maxCount: 12 },
  { name: "video", maxCount: 1 }
]);

module.exports = {
  propertyMediaUpload
};
