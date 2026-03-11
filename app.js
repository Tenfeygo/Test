const fileInput = document.getElementById("fileInput");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const placeholder = document.getElementById("placeholder");
const chooseBtn = document.getElementById("chooseBtn");
const downloadBtn = document.getElementById("downloadBtn");
const resetBtn = document.getElementById("resetBtn");
const dropzone = document.getElementById("dropzone");

const statusValue = document.getElementById("statusValue");
const sizeValue = document.getElementById("sizeValue");
const ratioValue = document.getElementById("ratioValue");
const brightnessValue = document.getElementById("brightnessValue");
const contrastValue = document.getElementById("contrastValue");
const dominantValue = document.getElementById("dominantValue");
const edgeValue = document.getElementById("edgeValue");
const labelValue = document.getElementById("labelValue");
const aiValue = document.getElementById("aiValue");
const ocrValue = document.getElementById("ocrValue");

let lastAnalysis = null;

const updateMetric = (el, value) => {
  el.textContent = value;
};

const resetUI = () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  placeholder.style.display = "block";
  statusValue.textContent = "未上传";
  sizeValue.textContent = "-";
  ratioValue.textContent = "-";
  brightnessValue.textContent = "-";
  contrastValue.textContent = "-";
  dominantValue.textContent = "-";
  edgeValue.textContent = "-";
  labelValue.textContent = "-";
  aiValue.textContent = "-";
  ocrValue.textContent = "-";
  downloadBtn.disabled = true;
  resetBtn.disabled = true;
  lastAnalysis = null;
};

const computeMetrics = (imageData, width, height) => {
  const data = imageData.data;
  let totalBrightness = 0;
  let totalBrightnessSq = 0;
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let edgeCount = 0;
  const threshold = 30;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;

      totalBrightness += brightness;
      totalBrightnessSq += brightness * brightness;
      totalR += r;
      totalG += g;
      totalB += b;

      const idxLeft = (y * width + (x - 1)) * 4;
      const idxRight = (y * width + (x + 1)) * 4;
      const idxUp = ((y - 1) * width + x) * 4;
      const idxDown = ((y + 1) * width + x) * 4;
      const brightnessLeft = 0.299 * data[idxLeft] + 0.587 * data[idxLeft + 1] + 0.114 * data[idxLeft + 2];
      const brightnessRight = 0.299 * data[idxRight] + 0.587 * data[idxRight + 1] + 0.114 * data[idxRight + 2];
      const brightnessUp = 0.299 * data[idxUp] + 0.587 * data[idxUp + 1] + 0.114 * data[idxUp + 2];
      const brightnessDown = 0.299 * data[idxDown] + 0.587 * data[idxDown + 1] + 0.114 * data[idxDown + 2];

      const gradient = Math.abs(brightnessRight - brightnessLeft) + Math.abs(brightnessDown - brightnessUp);
      if (gradient > threshold) {
        edgeCount += 1;
      }
    }
  }

  const pixelCount = width * height;
  const avgBrightness = totalBrightness / pixelCount;
  const variance = totalBrightnessSq / pixelCount - avgBrightness * avgBrightness;
  const contrast = Math.sqrt(Math.max(variance, 0));

  const avgR = totalR / pixelCount;
  const avgG = totalG / pixelCount;
  const avgB = totalB / pixelCount;

  const dominant = rgbToHex(avgR, avgG, avgB);
  const edgeDensity = edgeCount / ((width - 2) * (height - 2));

  const label = classifyScene(avgBrightness, contrast, edgeDensity);

  return {
    avgBrightness,
    contrast,
    dominant,
    edgeDensity,
    label,
  };
};

const classifyScene = (brightness, contrast, edgeDensity) => {
  if (brightness > 180 && edgeDensity < 0.08) {
    return "高亮 / 低纹理";
  }
  if (brightness < 90 && edgeDensity > 0.12) {
    return "低光 / 高纹理";
  }
  if (contrast > 60) {
    return "强对比";
  }
  return "中性场景";
};

const rgbToHex = (r, g, b) => {
  const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
  const toHex = (value) => clamp(value).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
};

const formatNumber = (value, digits = 2) => Number.parseFloat(value).toFixed(digits);

const handleImage = (file) => {
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = async (event) => {
    const img = new Image();
    img.onload = async () => {
      const maxWidth = 900;
      const scale = Math.min(maxWidth / img.width, 1);
      const drawWidth = Math.round(img.width * scale);
      const drawHeight = Math.round(img.height * scale);

      canvas.width = drawWidth;
      canvas.height = drawHeight;
      ctx.drawImage(img, 0, 0, drawWidth, drawHeight);
      placeholder.style.display = "none";

      const imageData = ctx.getImageData(0, 0, drawWidth, drawHeight);
      const metrics = computeMetrics(imageData, drawWidth, drawHeight);

      updateMetric(statusValue, "已完成");
      updateMetric(sizeValue, `${img.width} x ${img.height}`);
      updateMetric(ratioValue, formatNumber(img.width / img.height));
      updateMetric(brightnessValue, formatNumber(metrics.avgBrightness));
      updateMetric(contrastValue, formatNumber(metrics.contrast));
      updateMetric(dominantValue, metrics.dominant);
      updateMetric(edgeValue, `${formatNumber(metrics.edgeDensity * 100)}%`);
      updateMetric(labelValue, metrics.label);
      updateMetric(aiValue, "识别中...");

      lastAnalysis = {
        fileName: file.name,
        fileSize: file.size,
        width: img.width,
        height: img.height,
        ratio: Number.parseFloat((img.width / img.height).toFixed(4)),
        averageBrightness: Number.parseFloat(metrics.avgBrightness.toFixed(3)),
        contrast: Number.parseFloat(metrics.contrast.toFixed(3)),
        dominantColor: metrics.dominant,
        edgeDensity: Number.parseFloat(metrics.edgeDensity.toFixed(4)),
        classification: metrics.label,
        analyzedAt: new Date().toISOString(),
      };

      downloadBtn.disabled = false;
      resetBtn.disabled = false;

      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      try {
        const aiResult = await requestAiAnalysis(dataUrl);
        updateMetric(aiValue, aiResult.summaryText || "未获得识别结果");
        updateMetric(ocrValue, aiResult.ocrText || "未识别到文字");
        lastAnalysis.aiAnalysis = aiResult.summaryText || "";
        lastAnalysis.ocrText = aiResult.ocrText || "";
        lastAnalysis.aiStructured = aiResult.data || null;
      } catch (error) {
        const message = `识别失败: ${error.message || "未知错误"}`;
        updateMetric(aiValue, message);
        updateMetric(ocrValue, message);
        lastAnalysis.aiError = message;
      }
    };

    img.src = event.target.result;
  };

  reader.readAsDataURL(file);
};

fileInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  handleImage(file);
});

chooseBtn.addEventListener("click", (event) => {
  event.preventDefault();
  fileInput.click();
});

resetBtn.addEventListener("click", () => {
  fileInput.value = "";
  resetUI();
});

const preventDefaults = (event) => {
  event.preventDefault();
  event.stopPropagation();
};

["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, preventDefaults, false);
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(
    eventName,
    () => {
      dropzone.style.borderColor = "#c4512d";
    },
    false
  );
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(
    eventName,
    () => {
      dropzone.style.borderColor = "#d7b39c";
    },
    false
  );
});

dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  handleImage(file);
});

downloadBtn.addEventListener("click", () => {
  if (!lastAnalysis) {
    return;
  }
  const blob = new Blob([JSON.stringify(lastAnalysis, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "image-analysis.json";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

const requestAiAnalysis = async (imageDataUrl) => {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ imageDataUrl }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "API 请求失败");
  }

  const data = await response.json();
  const payload = data.data || null;
  if (!payload) {
    return { summaryText: "", ocrText: "", data: null };
  }

  const description = payload.description ? `描述: ${payload.description}` : "";
  const tags = Array.isArray(payload.tags) ? `标签: ${payload.tags.join(", ")}` : "";
  const scene = payload.scene ? `场景: ${payload.scene}` : "";
  const summaryText = [description, tags, scene].filter(Boolean).join("\n");
  const ocrText = Array.isArray(payload.ocr_lines) && payload.ocr_lines.length > 0
    ? payload.ocr_lines.join("\n")
    : payload.ocr || "";

  return {
    summaryText,
    ocrText,
    data: payload,
  };
};

resetUI();
