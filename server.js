
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "30mb" }));

const PORT = process.env.PORT || 10000;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const API_KEY = process.env.GEMINI_API_KEY;

const AGENTS = [
  ["سكالب بوت ألفا","حلل الزخم قصير الأجل من 15M، مع الاستفادة من 1H عند الحاجة."],
  ["سويينج بوت برو","حلل الاتجاه الأكبر من 1D و4H و1H، وحدد ما إذا كان الاتجاه متسقًا."],
  ["زون مابر","حدد مناطق الدعم والمقاومة الظاهرة فقط، ولا تخترع أسعارًا غير مقروءة."],
  ["تريد واتش AI","حلل هيكل السوق: HH/HL/LH/LL، الكسور وإعادة الاختبار إن كانت واضحة."],
  ["ستيمينت بوت","استنتج سلوك المشاركين من حركة السعر والشمعات فقط، دون ادعاء معرفة مشاعر السوق الحقيقية."],
  ["ريسك جارد","ركز على شروط إبطال الفكرة، جودة البيانات، ومخاطر الدخول المتأخر."],
  ["نيوز فيلتر","لا تدّعِ معرفة أخبار خارج الصور. إذا لم توجد أخبار مرفقة، قل إن الأخبار غير متاحة."],
  ["فولتليتي AI","حلل التذبذب واتساع الحركة من الشارتات، وهل البيئة هادئة أم سريعة."],
  ["باترن بوت","ابحث عن الأنماط والاختراقات وإعادة الاختبار الظاهرة فقط."],
  ["ديڤرجنس AI","افحص RSI/MACD فقط إذا ظهرت بوضوح، واذكر عدم القابلية للتحقق إن لم تظهر."],
  ["ليكويدتي بوت","حلل السيولة المحتملة حول القمم والقيعان الواضحة، دون اختلاق مستويات."],
  ["كومبلاينس AI","تحقق من اكتمال الأطر الأربعة والتعارض بينها وجودة الصورة قبل القرار."]
];

function imageParts(frames) {
  return ["1D","4H","1H","15M"].map(tf => ({
    inlineData: {
      mimeType: frames[tf].mimeType,
      data: frames[tf].data
    }
  }));
}

function safeJson(text) {
  try { return JSON.parse(text); } catch {}
  const match = String(text).match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return {
    bias: "غير قابل للتحقق",
    confidence: 0,
    evidence: [],
    levels: {},
    invalidation: "",
    data_quality: "فشل تحليل JSON"
  };
}

async function askGemini(parts, prompt) {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [...parts, { text: prompt }],
    config: {
      responseMimeType: "application/json",
      temperature: 0.2
    }
  });
  return safeJson(response.text);
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: "Google Gemini API",
    model: MODEL,
    configured: Boolean(API_KEY)
  });
});

app.post("/api/analyze", async (req, res) => {
  if (!API_KEY) {
    return res.status(503).json({ error: "GEMINI_API_KEY غير مضبوط على الخادم." });
  }

  const frames = req.body?.frames;
  if (!frames || !["1D","4H","1H","15M"].every(k => frames[k]?.data && frames[k]?.mimeType)) {
    return res.status(400).json({ error: "يجب رفع صور 1D و4H و1H و15M قبل التحليل." });
  }

  const base = imageParts(frames);
  const results = await Promise.all(AGENTS.map(async ([name, role]) => {
    const prompt = `
أنت الوكيل "${name}" في نظام TRADLI.
دورك: ${role}

قواعد صارمة:
- حلل ما يظهر في الصور فقط.
- لا تخترع سعرًا أو مستوى أو مؤشرًا غير واضح.
- إذا لم تستطع قراءة مستوى، اكتب "غير قابل للتحقق".
- لا تضمن الربح ولا تدّعي التنبؤ المؤكد.
- هذه أداة تحليل تعليمية، والتنفيذ إن وُجد يكون يدويًا فقط.
- ركز على جودة الأدلة والتعارض بين الأطر.

أعد JSON فقط بهذا الشكل:
{
  "agent":"${name}",
  "bias":"شراء|بيع|محايد|غير قابل للتحقق",
  "confidence":0,
  "evidence":["..."],
  "levels":{"support":[],"resistance":[]},
  "invalidation":"...",
  "data_quality":"عالية|متوسطة|ضعيفة|غير قابلة للتحقق"
}
`;
    try {
      return await askGemini(base, prompt);
    } catch (e) {
      return { agent: name, bias: "غير قابل للتحقق", confidence: 0, evidence: [String(e.message || e)], levels: {}, invalidation: "", data_quality: "خطأ اتصال" };
    }
  }));

  const consensusPrompt = `
أنت طبقة الإجماع النهائية في TRADLI.
لديك صور 1D و4H و1H و15M ونتائج 12 وكيلًا أدناه.

نتائج الوكلاء:
${JSON.stringify(results, null, 2)}

مهمتك دمج الأدلة دون اختلاق أرقام.
إذا كانت الصور غير واضحة أو يوجد تعارض قوي، اختر "التريث".
القرار المسموح: شراء | بيع | شراء معلق | بيع معلق | التريث.
لا تضمن الربح. أي Entry/SL/TP يجب أن يكون مستندًا إلى مستوى ظاهر وقابل للقراءة؛ وإلا اتركه فارغًا.
التنفيذ يدوي فقط.

أعد JSON فقط:
{
  "decision":"شراء|بيع|شراء معلق|بيع معلق|التريث",
  "confidence":0,
  "entry_zone":"",
  "stop_loss":"",
  "tp1":"",
  "tp2":"",
  "tp3":"",
  "rr":"",
  "reasons":["..."],
  "cancel_condition":"...",
  "data_quality":"عالية|متوسطة|ضعيفة|غير قابلة للتحقق"
}
`;

  let final;
  try {
    final = await askGemini(base, consensusPrompt);
  } catch (e) {
    final = {
      decision: "التريث",
      confidence: 0,
      entry_zone: "",
      stop_loss: "",
      tp1: "",
      tp2: "",
      tp3: "",
      rr: "",
      reasons: ["تعذر الوصول إلى طبقة الإجماع."],
      cancel_condition: "",
      data_quality: "خطأ اتصال"
    };
  }

  res.json({
    provider: "Google Gemini API",
    model: MODEL,
    decision: final,
    agents: results,
    manual_only: true
  });
});

app.use(express.static("public"));
app.use((_req, res) => res.sendFile(process.cwd() + "/public/index.html"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TRADLI Gemini V13 listening on ${PORT}`);
});
