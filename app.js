const fileInput = document.getElementById("fileInput");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const placeholder = document.getElementById("placeholder");
const chooseBtn = document.getElementById("chooseBtn");
const downloadBtn = document.getElementById("downloadBtn");
const resetBtn = document.getElementById("resetBtn");
const dropzone = document.getElementById("dropzone");

const statusValue = document.getElementById("statusValue");
const typeValue = document.getElementById("typeValue");
const ocrValue = document.getElementById("ocrValue");
const summaryValue = document.getElementById("summaryValue");
const highlightsList = document.getElementById("highlightsList");
const issuesList = document.getElementById("issuesList");
const recommendationsList = document.getElementById("recommendationsList");
const audienceList = document.getElementById("audienceList");
const conversionList = document.getElementById("conversionList");
const contentList = document.getElementById("contentList");
const risksList = document.getElementById("risksList");
const questionsList = document.getElementById("questionsList");

let lastAnalysis = null;

const updateMetric = (el, value) => {
  el.textContent = value;
};

const renderList = (el, items) => {
  el.innerHTML = "";
  if (!items || items.length === 0) {
    const li = document.createElement("li");
    li.textContent = "无";
    el.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    el.appendChild(li);
  });
};

const resetUI = () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  placeholder.style.display = "block";
  placeholder.textContent = "等待上传";
  statusValue.textContent = "未上传";
  typeValue.textContent = "-";
  ocrValue.textContent = "-";
  summaryValue.textContent = "-";
  renderList(highlightsList, []);
  renderList(issuesList, []);
  renderList(recommendationsList, []);
  renderList(audienceList, []);
  renderList(conversionList, []);
  renderList(contentList, []);
  renderList(risksList, []);
  renderList(questionsList, []);
  downloadBtn.disabled = true;
  resetBtn.disabled = true;
  lastAnalysis = null;
};

const handleFile = async (file) => {
  if (!file) {
    return;
  }

  updateMetric(statusValue, "分析中...");
  updateMetric(typeValue, "-");
  updateMetric(ocrValue, "-");
  summaryValue.textContent = "生成分析中...";
  renderList(highlightsList, []);
  renderList(issuesList, []);
  renderList(recommendationsList, []);
  renderList(audienceList, []);
  renderList(conversionList, []);
  renderList(contentList, []);
  renderList(risksList, []);
  renderList(questionsList, []);

  const isImage = file.type.startsWith("image/");
  if (isImage) {
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

        updateMetric(typeValue, "图片/截图");

        lastAnalysis = {
          fileName: file.name,
          fileSize: file.size,
          analyzedAt: new Date().toISOString(),
        };
      };

      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    placeholder.style.display = "block";
    placeholder.textContent = "已上传表格";
    updateMetric(typeValue, "表格文件");
    lastAnalysis = {
      fileName: file.name,
      fileSize: file.size,
      analyzedAt: new Date().toISOString(),
    };
  }

  downloadBtn.disabled = false;
  resetBtn.disabled = false;

  try {
    const aiResult = await requestAiAnalysis(file);
    applyAiResult(aiResult);
    if (aiResult?.type) {
      lastAnalysis.dataType = aiResult.type;
    }
    updateMetric(statusValue, "已完成");
  } catch (error) {
    const message = `识别失败: ${error.message || "未知错误"}`;
    updateMetric(statusValue, "失败");
    updateMetric(ocrValue, message);
    summaryValue.textContent = message;
    lastAnalysis.aiError = message;
  }
};

fileInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  handleFile(file);
});

chooseBtn.addEventListener("click", () => {
  fileInput.click();
});

dropzone.addEventListener("click", (event) => {
  const isInteractive = event.target === chooseBtn || event.target.closest(".dropzone-content");
  if (isInteractive) {
    fileInput.click();
  }
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
  handleFile(file);
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
  link.download = "live-room-analysis.json";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

const applyAiResult = (result) => {
  const payload = result?.data || null;
  if (!payload) {
    updateMetric(ocrValue, "未识别到文字");
    summaryValue.textContent = "-";
    renderList(highlightsList, []);
    renderList(issuesList, []);
    renderList(recommendationsList, []);
    renderList(audienceList, []);
    renderList(conversionList, []);
    renderList(contentList, []);
    renderList(risksList, []);
    renderList(questionsList, []);
    return;
  }

  const summary = payload.summary || "";
  const highlights = payload.highlights || [];
  const issues = payload.issues || [];
  const recommendations = payload.recommendations || [];
  const audience = payload.audience_insights || [];
  const conversion = payload.conversion_insights || [];
  const content = payload.content_insights || [];
  const risks = payload.risks || [];
  const questions = payload.followup_questions || [];
  const ocrLines = Array.isArray(payload.ocr_lines) && payload.ocr_lines.length > 0
    ? payload.ocr_lines.join("\n")
    : payload.ocr || "";

  updateMetric(ocrValue, ocrLines || "未识别到文字");
  summaryValue.textContent = summary || "-";
  renderList(highlightsList, highlights);
  renderList(issuesList, issues);
  renderList(recommendationsList, recommendations);
  renderList(audienceList, audience);
  renderList(conversionList, conversion);
  renderList(contentList, content);
  renderList(risksList, risks);
  renderList(questionsList, questions);

  lastAnalysis.aiAnalysis = summary || "";
  lastAnalysis.ocrText = ocrLines || "";
  lastAnalysis.aiStructured = payload;
};

const requestAiAnalysis = async (file) => {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/analyze-file", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "API 请求失败");
  }

  const data = await response.json();
  return data;
};

resetUI();
