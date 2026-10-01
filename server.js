import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 8080;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const client = process.env.OPENAI_API_KEY ? new OpenAI({apiKey: process.env.OPENAI_API_KEY}) : null;

app.use(cors());
app.use(express.json({limit:"30mb"}));

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
app.use(express.static(path.join(__dirname,"public")));

const AGENTS = [
 {name:"سكالب بوت ألفا", role:"حلل الزخم والحركة القصيرة على 15M، وابحث عن تأكيدات قابلة للتحقق، ولا تخترع سعراً."},
 {name:"سوينج بوت برو", role:"حلل الاتجاه الأكبر من 1D و4H و1H، وحدد بنية الاتجاه والسيناريو المسيطر."},
 {name:"زون مابر", role:"استخرج الدعم والمقاومة والمناطق السعرية الظاهرة فعلياً من الصور، مع ذكر الفريم ومبرر المنطقة."},
 {name:"تريد واتش AI", role:"حلل بنية السوق: قمم وقيعان، HH/HL أو LH/LL، كسر بنية وإعادة اختبار إن كانت ظاهرة."},
 {name:"ستيمينت بوت", role:"قيّم ما يمكن استنتاجه من السعر فقط عن الانحياز النفسي والزخم. لا تدّعِ أخباراً لم تُرسل لك."},
 {name:"ريسك جارد", role:"قيّم صلاحية السيناريو من ناحية المخاطرة. ارفض الصفقة إذا لم يوجد وقف منطقي خلف بنية واضحة."},
 {name:"نيوز فيلتر", role:"لا تبحث عن أخبار من نفسك. افحص فقط هل توجد معلومات إخبارية مرفقة؛ إن لم توجد قل إن فلتر الأخبار غير متاح."},
 {name:"فولتليتي AI", role:"قيّم التقلب الظاهر واتساع الحركة. لا تضع ATR رقماً من دون بيانات سعرية كافية."},
 {name:"باترن بوت", role:"ابحث عن نماذج سعرية واختراقات وإعادة اختبار ظاهرة فعلاً، ولا تعتبر أي شكل نموذجاً مؤكداً بلا دليل."},
 {name:"ديڤرجنس AI", role:"ابحث عن divergence فقط إذا كانت مؤشرات مثل RSI/MACD واضحة في الصورة. وإلا قل غير قابل للتحقق."},
 {name:"ليكويدتي بوت", role:"حدد تجمعات السيولة الظاهرة حول القمم والقيعان ومناطق أخذ السيولة، دون اختراع مستويات."},
 {name:"كومبلاينس AI", role:"افحص اكتمال البيانات وتعارض الفريمات. مهمتك منع القرار عندما تكون الأدلة غير كافية."}
];

function extractText(resp){
  if (typeof resp.output_text === "string") return resp.output_text;
  return JSON.stringify(resp.output ?? resp);
}

function stripJson(s){
  return s.replace(/^```json\s*/i,"").replace(/^```\s*/,"").replace(/\s*```$/,"").trim();
}

async function callAgent(agent, images){
  const prompt = `أنت وحدة تحليل مستقلة داخل TRADLI.
${agent.role}
حلل صور XAU/USD المرفقة للفريمات: 1D, 4H, 1H, 15M.
قواعد صارمة:
1) لا تخترع أي سعر أو مستوى غير مقروء من الصورة.
2) إذا كانت الصورة غير واضحة قل غير قابل للتحقق.
3) لا تضمن الربح ولا تستخدم لغة يقينية.
4) أعط نتيجة منظمة بالعربية.
أجب JSON فقط:
{"agent":"...","bias":"شراء|بيع|محايد|غير قابل للتحقق","confidence":0-100,"evidence":["..."],"levels":{"entry":"...","sl":"...","tp1":"...","tp2":"...","tp3":"..."},"invalid_if":"...","data_quality":"جيدة|متوسطة|ضعيفة"}`;

  const content = [{type:"input_text", text:prompt}];
  for (const im of images) {
    content.push({type:"input_text", text:`الفريم: ${im.frame}`});
    content.push({type:"input_image", image_url:im.data, detail:"high"});
  }
  const r = await client.responses.create({model:MODEL,input:[{role:"user",content}]});
  const raw = stripJson(extractText(r));
  try { return JSON.parse(raw); }
  catch { return {agent:agent.name,bias:"غير قابل للتحقق",confidence:0,evidence:[raw.slice(0,1200)],levels:{},invalid_if:"تعذر تفسير استجابة الوكيل",data_quality:"ضعيفة"}; }
}

async function consensus(agentResults, images){
  const summary = agentResults.map(x=>JSON.stringify(x)).join("\n");
  const content = [
    {type:"input_text",text:`أنت محرك الإجماع النهائي في TRADLI. لديك نتائج 12 وحدة تحليل وصور الفريمات الأربع.
لا تختلق مستويات. إذا لم توجد منطقة سعرية واضحة في الصور فاختر "التريث".
لا تعتمد على نسبة ثقة الوكلاء وحدها؛ افحص توافق الأدلة.
أخرج JSON فقط:
{"decision":"شراء|بيع|شراء معلق|بيع معلق|التريث","confidence":0-100,"entry_zone":"...","stop_loss":"...","tp1":"...","tp2":"...","tp3":"...","rr":"...","reason":["سبب 1","سبب 2","سبب 3"],"cancel_condition":"...","data_quality":"جيدة|متوسطة|ضعيفة"}
نتائج الوحدات:
${summary}`},
  ];
  for (const im of images) {
    content.push({type:"input_text",text:`الصورة المرجعية للفريم ${im.frame}`});
    content.push({type:"input_image",image_url:im.data,detail:"high"});
  }
  const r=await client.responses.create({model:MODEL,input:[{role:"user",content}]});
  const raw=stripJson(extractText(r));
  try{return JSON.parse(raw)}catch{return {decision:"التريث",confidence:0,entry_zone:"—",stop_loss:"—",tp1:"—",tp2:"—",tp3:"—",rr:"—",reason:["تعذر تفسير الإجماع النهائي."],cancel_condition:"انتظار تحليل صحيح",data_quality:"ضعيفة"}}
}

app.post("/api/analyze", async (req,res)=>{
  try{
    if(!client) return res.status(503).json({error:"OPENAI_API_KEY غير مضبوط على الخادم."});
    const images=req.body?.images;
    if(!Array.isArray(images)||images.length!==4) return res.status(400).json({error:"يجب إرسال صور 1D و4H و1H و15M."});
    const allowed=new Set(["1D","4H","1H","15M"]);
    if(!images.every(x=>allowed.has(x.frame)&&typeof x.data==="string"&&x.data.startsWith("data:image/")))
      return res.status(400).json({error:"بيانات الصور غير صالحة."});
    const results=await Promise.all(AGENTS.map(a=>callAgent(a,images)));
    const final=await consensus(results,images);
    res.json({model:MODEL,agents:results,consensus:final,generated_at:new Date().toISOString()});
  }catch(e){
    res.status(500).json({error:e?.message||"خطأ غير معروف"});
  }
});

app.get("/api/health",(req,res)=>res.json({ok:true,model:MODEL,aiConnected:!!client}));
app.use((req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`TRADLI V12 listening on ${PORT}`));
