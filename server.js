import "dotenv/config";
import express from "express";
import OpenAI from "openai";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "12mb" }));
app.use(express.static("."));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/analyze", async (req, res) => {
  try {
    const { imageDataUrl } = req.body;
    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return res.status(400).json({ error: "imageDataUrl is required" });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not set" });
    }

    const baseInput = [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "请识别图片内容，给出简洁描述、3-6个标签、可能的场景/对象，并提取图片中的可读文字(如无文字请返回空字符串)。" +
              "OCR需尽量保持原始换行、数字/单位/标点，不要纠正拼写。输出中文。",
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
          },
        ],
      },
    ];

    const structuredPayload = {
      model: "gpt-4.1-mini",
      text: {
        format: {
          type: "json_schema",
          json_schema: {
            name: "image_analysis",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                description: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                scene: { type: "string" },
                ocr: { type: "string" },
                ocr_lines: { type: "array", items: { type: "string" } },
              },
              required: ["description", "tags", "scene", "ocr", "ocr_lines"],
            },
          },
        },
      },
      input: baseInput,
    };

    let response = null;
    try {
      response = await openai.responses.create(structuredPayload);
    } catch (error) {
      response = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: baseInput,
      });
    }

    const text = response?.output_text ?? "";
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = {
        description: text || "",
        tags: [],
        scene: "",
        ocr: "",
        ocr_lines: [],
      };
    }
    res.json({ data });
  } catch (error) {
    const message = error?.message || "Unknown error";
    res.status(500).json({ error: message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
