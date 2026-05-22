import { toast } from "react-toastify";

const PROGRESS_COLOURS = {
  success: "#27ae60",
  danger: "#e74c3c",
  error: "#e74c3c",
  warning: "#e8a020",
  info: "#2d5a8e"
};

function getToastType(feedbackType) {
  if (feedbackType === "danger" || feedbackType === "error") return "error";
  if (feedbackType === "warning") return "warning";
  if (feedbackType === "info") return "info";
  return "success";
}

export function notify(message, feedbackType = "success") {
  const type = getToastType(feedbackType);
  const colour = PROGRESS_COLOURS[feedbackType] || PROGRESS_COLOURS[type];

  toast(message, {
    type,
    style: {
      "--toastify-color-progress-bar": colour
    },
    progressStyle: {
      background: colour
    }
  });
}
