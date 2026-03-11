import "dotenv/config";
import express from "express";
import multer from "multer";
import OpenAI from "openai";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import xlsx from "xlsx";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "12mb" }));
app.use(express.static("."));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : null;
const fetchWithProxy = proxyAgent
  ? (url, options = {}) => undiciFetch(url, { ...options, dispatcher: proxyAgent })
  : undefined;

const provider = (process.env.AI_PROVIDER || "").toLowerCase() || (process.env.GEMINI_API_KEY ? "gemini" : "openai");
const geminiModel = process.env.GEMINI_MODEL || "";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 60000,
  fetch: fetchWithProxy,
  baseURL: "https://api.openai.com/v1",
});

const formatProviderError = (error, label) => {
  return {
    provider: label,
    message: error?.message || "Unknown error",
    name: error?.name,
    status: error?.status,
    cause: error?.cause ? String(error.cause) : undefined,
  };
};

const extractOutputText = (json) => {
  if (!json || typeof json !== "object") {
    return "";
  }
  if (typeof json.output_text === "string") {
    return json.output_text;
  }
  if (Array.isArray(json.output)) {
    for (const item of json.output) {
      if (Array.isArray(item?.content)) {
        for (const part of item.content) {
          if (part?.type === "output_text" && typeof part.text === "string") {
            return part.text;
          }
        }
      }
    }
  }
  return "";
};

const extractJsonFromText = (text) => {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
};

const listGeminiModels = async () => {
  const response = await undiciFetch("https://generativelanguage.googleapis.com/v1beta/models", {
    method: "GET",
    dispatcher: proxyAgent || undefined,
    headers: {
      "x-goog-api-key": process.env.GEMINI_API_KEY,
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json?.error?.message || `Gemini HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return json?.models || [];
};

const pickDefaultGeminiModel = async () => {
  const models = await listGeminiModels();
  const match = models.find(
    (model) =>
      Array.isArray(model?.supportedGenerationMethods) &&
      model.supportedGenerationMethods.includes("generateContent")
  );
  return match?.name || "";
};

const normalizeGeminiModel = (name) => {
  if (!name) {
    return "";
  }
  return name.startsWith("models/") ? name.slice("models/".length) : name;
};

const callGemini = async (parts) => {
  let modelToUse = normalizeGeminiModel(geminiModel);
  if (!modelToUse) {
    modelToUse = normalizeGeminiModel(await pickDefaultGeminiModel());
  }

  const response = await undiciFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent`,
    {
      method: "POST",
      dispatcher: proxyAgent || undefined,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts,
          },
        ],
      }),
    }
  );

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 404) {
      const fallbackModel = normalizeGeminiModel(await pickDefaultGeminiModel());
      if (fallbackModel && fallbackModel !== modelToUse) {
        return callGemini(parts);
      }
    }
    const message = json?.error?.message || `Gemini HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  const text = (json?.candidates?.[0]?.content?.parts || [])
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
  return { text, raw: json };
};

const callOpenAIResponses = async (payload) => {
  const response = await undiciFetch("https://api.openai.com/v1/responses", {
    method: "POST",
    dispatcher: proxyAgent || undefined,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json?.error?.message || `OpenAI HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return json;
};

const toDataUrl = (buffer, mime) => {
  const base64 = buffer.toString("base64");
  return `data:${mime};base64,${base64}`;
};

const tableToMarkdown = (rows, maxRows = 50) => {
  if (!rows || rows.length === 0) {
    return "";
  }
  const header = rows[0].map((cell) => String(cell ?? ""));
  const body = rows.slice(1, maxRows + 1).map((row) => row.map((cell) => String(cell ?? "")));
  const headerLine = `| ${header.join(" | ")} |`;
  const divider = `| ${header.map(() => "---").join(" | ")} |`;
  const bodyLines = body.map((row) => `| ${row.join(" | ")} |`);
  return [headerLine, divider, ...bodyLines].join("\n");
};

const analyzeImage = async (imageDataUrl) => {
  const prompt =
    "你是一位直播间数据分析专家。请基于图片内容（可能是直播数据图表/看板/截图）做分析，输出严格JSON。" +
    "字段：summary, highlights(数组), issues(数组), recommendations(数组), ocr, ocr_lines。只输出JSON。";

  let text = "";
  if (provider === "gemini") {
    const base64 = imageDataUrl.split(",")[1] || "";
    const { text: gemText } = await callGemini([
      { text: prompt },
      { inline_data: { mime_type: "image/jpeg", data: base64 } },
    ]);
    text = gemText;
  } else {
    const baseInput = [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: imageDataUrl },
        ],
      },
    ];
    const structuredPayload = {
      model: "gpt-4.1-mini",
      text: {
        format: {
          type: "json_schema",
          name: "live_stream_image_analysis",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              highlights: { type: "array", items: { type: "string" } },
              issues: { type: "array", items: { type: "string" } },
              recommendations: { type: "array", items: { type: "string" } },
              ocr: { type: "string" },
              ocr_lines: { type: "array", items: { type: "string" } },
            },
            required: ["summary", "highlights", "issues", "recommendations", "ocr", "ocr_lines"],
          },
        },
      },
      input: baseInput,
    };

    try {
      const response = await openai.responses.create(structuredPayload);
      text = response?.output_text ?? "";
    } catch {
      try {
        const response = await openai.responses.create({ model: "gpt-4.1-mini", input: baseInput });
        text = response?.output_text ?? "";
      } catch {
        const raw = await callOpenAIResponses(structuredPayload);
        text = extractOutputText(raw);
      }
    }
  }

  const parsed = extractJsonFromText(text);
  if (parsed) {
    return parsed;
  }
  return {
    summary: text || "",
    highlights: [],
    issues: [],
    recommendations: [],
    ocr: "",
    ocr_lines: [],
  };
};

const analyzeTable = async (markdownTable, rowCount, columnCount) => {
  const prompt =
    "你是一位绝佳的直播间数据分析师。以下是直播间数据表格，请输出严格JSON分析：" +
    "summary, highlights(数组), issues(数组), recommendations(数组), " +
    "audience_insights(数组), conversion_insights(数组), content_insights(数组), risks(数组), " +
    "followup_questions(数组)。输出中文。\n" +
    `表格规模：${rowCount} 行，${columnCount} 列。\n` +
    "表格内容(最多50行)：\n" +
    markdownTable +
    "\n只输出JSON。";

  let text = "";
  if (provider === "gemini") {
    const { text: gemText } = await callGemini([{ text: prompt }]);
    text = gemText;
  } else {
    const baseInput = [
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ];

    const structuredPayload = {
      model: "gpt-4.1-mini",
      text: {
        format: {
          type: "json_schema",
          name: "live_stream_table_analysis",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              highlights: { type: "array", items: { type: "string" } },
              issues: { type: "array", items: { type: "string" } },
              recommendations: { type: "array", items: { type: "string" } },
              audience_insights: { type: "array", items: { type: "string" } },
              conversion_insights: { type: "array", items: { type: "string" } },
              content_insights: { type: "array", items: { type: "string" } },
              risks: { type: "array", items: { type: "string" } },
              followup_questions: { type: "array", items: { type: "string" } },
            },
            required: [
              "summary",
              "highlights",
              "issues",
              "recommendations",
              "audience_insights",
              "conversion_insights",
              "content_insights",
              "risks",
              "followup_questions",
            ],
          },
        },
      },
      input: baseInput,
    };

    try {
      const response = await openai.responses.create(structuredPayload);
      text = response?.output_text ?? "";
    } catch {
      try {
        const response = await openai.responses.create({ model: "gpt-4.1-mini", input: baseInput });
        text = response?.output_text ?? "";
      } catch {
        const raw = await callOpenAIResponses(structuredPayload);
        text = extractOutputText(raw);
      }
    }
  }

  const parsed = extractJsonFromText(text);
  if (parsed) {
    return parsed;
  }
  return {
    summary: text || "",
    highlights: [],
    issues: [],
    recommendations: [],
    audience_insights: [],
    conversion_insights: [],
    content_insights: [],
    risks: [],
    followup_questions: [],
  };
};

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/proxy-test", async (req, res) => {
  try {
    const response = await undiciFetch("https://api.openai.com/v1/models", {
      method: "HEAD",
      dispatcher: proxyAgent || undefined,
    });
    res.json({ ok: true, status: response.status });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatProviderError(error, "openai") });
  }
});

app.get("/api/openai-auth-test", async (req, res) => {
  try {
    const response = await undiciFetch("https://api.openai.com/v1/models", {
      method: "GET",
      dispatcher: proxyAgent || undefined,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    });
    const json = await response.json().catch(() => ({}));
    res.json({ ok: response.ok, status: response.status, sample: json?.data?.[0]?.id || null });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatProviderError(error, "openai") });
  }
});

app.get("/api/gemini-models", async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not set" });
    }
    const models = await listGeminiModels();
    res.json({ models });
  } catch (error) {
    res.status(500).json({ error: formatProviderError(error, "gemini") });
  }
});

app.post("/api/analyze", async (req, res) => {
  try {
    const { imageDataUrl } = req.body;
    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return res.status(400).json({ error: "imageDataUrl is required" });
    }
    if (provider === "gemini" && !process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not set" });
    }
    if (provider === "openai" && !process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not set" });
    }
    const data = await analyzeImage(imageDataUrl);
    res.json({ data });
  } catch (error) {
    const detail = formatProviderError(error, provider);
    res.status(500).json({ error: "AI request failed", detail });
  }
});

app.post("/api/analyze-file", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "file is required" });
    }
    if (provider === "gemini" && !process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not set" });
    }
    if (provider === "openai" && !process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not set" });
    }

    const { mimetype, originalname, buffer } = req.file;
    const lowerName = originalname.toLowerCase();

    if (mimetype.startsWith("image/")) {
      const dataUrl = toDataUrl(buffer, mimetype);
      const data = await analyzeImage(dataUrl);
      return res.json({ type: "image", data });
    }

    if (
      mimetype === "text/csv" ||
      lowerName.endsWith(".csv") ||
      lowerName.endsWith(".xlsx") ||
      lowerName.endsWith(".xls")
    ) {
      const workbook = xlsx.read(buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true });
      const rowCount = rows.length;
      const columnCount = rows[0] ? rows[0].length : 0;
      const markdownTable = tableToMarkdown(rows);
      const data = await analyzeTable(markdownTable, rowCount, columnCount);
      return res.json({ type: "table", data });
    }

    return res.status(400).json({ error: "Unsupported file type" });
  } catch (error) {
    const detail = formatProviderError(error, provider);
    res.status(500).json({ error: "AI request failed", detail });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
