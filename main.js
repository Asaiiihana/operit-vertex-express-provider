"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMessage = sendMessage;
exports.listModels = listModels;
exports.testConnection = testConnection;
exports.calculateInputTokens = calculateInputTokens;
exports.registerToolPkg = registerToolPkg;

const DEFAULT_ENDPOINT = "https://aiplatform.googleapis.com";
const DEFAULT_MODEL = "gemini-3-flash-preview";
const thoughtSignatureCache = new Map();
function callKey(name,args){ let a="{}"; try{a=JSON.stringify(args||{});}catch(_){} return String(name||"")+"\n"+a; }

function nonEmpty(v, fallback = "") { return typeof v === "string" && v.trim() ? v.trim() : fallback; }
function xmlEscape(v) { return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&apos;"); }
function xmlUnescape(v) { return String(v ?? "").replace(/&quot;/g,'\"').replace(/&apos;/g,"'").replace(/&gt;/g,">").replace(/&lt;/g,"<").replace(/&amp;/g,"&"); }
function paramText(v) { if (v == null) return ""; return typeof v === "object" ? JSON.stringify(v) : String(v); }
function parseToolCalls(text) {
  const calls=[]; const re=/<tool(?:_[A-Za-z0-9]+)?\s+name="([^"]+)"([^>]*)>([\s\S]*?)<\/tool(?:_[A-Za-z0-9]+)?>/gi; let m;
  while((m=re.exec(text||""))!==null){ const input={}; const attrs=m[2]||""; const body=m[3]||""; const pr=/<param\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/param>/gi; let p;
    while((p=pr.exec(body))!==null){ const key=xmlUnescape(p[1]); const raw=xmlUnescape(p[2].trim()); try{input[key]=JSON.parse(raw);}catch(_){input[key]=raw;} }
    const sm=/\sdata-thought-signature="([^"]+)"/i.exec(attrs);
    calls.push({name:xmlUnescape(m[1]),input,thoughtSignature:sm?xmlUnescape(sm[1]):""}); }
  return calls;
}
function parseToolResults(text) {
  const results=[]; const re=/<tool_result(?:_[A-Za-z0-9]+)?\s+([^>]*)>([\s\S]*?)<\/tool_result(?:_[A-Za-z0-9]+)?>/gi; let m;
  while((m=re.exec(text||""))!==null){ const nm=/name="([^"]+)"/i.exec(m[1]||""); let body=m[2]||""; const cm=/<content>([\s\S]*?)<\/content>/i.exec(body); if(cm) body=cm[1]; results.push({name:nm?xmlUnescape(nm[1]):"",content:xmlUnescape(body.trim())}); }
  return results;
}
function stripToolMarkup(text) { return String(text||"").replace(/<tool(?:_[A-Za-z0-9]+)?\s+name="[^"]+"[^>]*>[\s\S]*?<\/tool(?:_[A-Za-z0-9]+)?>/gi,"").replace(/<tool_result(?:_[A-Za-z0-9]+)?\s+[^>]*>[\s\S]*?<\/tool_result(?:_[A-Za-z0-9]+)?>/gi,"").trim(); }
function normalizeSchema(tool) {
  const raw=tool?.parametersStructured ?? tool?.parameters ?? tool?.inputSchema ?? tool?.schema;
  if(raw && typeof raw==="object" && !Array.isArray(raw)){ if(raw.json && typeof raw.json==="object") return raw.json; if(raw.type||raw.properties) return raw; }
  if(typeof raw==="string"){ try{const p=JSON.parse(raw); if(p&&typeof p==="object") return p;}catch(_){} }
  return {type:"object",properties:{}};
}
function toGeminiTools(availableTools) {
  if(!Array.isArray(availableTools)) return [];
  const decls=availableTools.map(t=>{ const name=nonEmpty(t?.name ?? t?.toolName ?? t?.id); if(!name)return null; return {name,description:nonEmpty(t?.description,name),parameters:normalizeSchema(t)}; }).filter(Boolean);
  return decls.length ? [{functionDeclarations:decls}] : [];
}
function geminiFunctionCallToOperitXml(fc, thoughtSignature) {
  if(!fc?.name) return ""; const sig=nonEmpty(thoughtSignature); let out=`<tool name="${xmlEscape(fc.name)}"${sig?` data-thought-signature="${xmlEscape(sig)}"`:""}>`; const args=fc.args&&typeof fc.args==="object"?fc.args:{};
  for(const [k,v] of Object.entries(args)) out+=`\n<param name="${xmlEscape(k)}">${xmlEscape(paramText(v))}</param>`;
  return out+"\n</tool>";
}
function buildConversation(turns) {
  const system=[]; const contents=[]; let openCalls=[];
  const add=(role,parts)=>{ if(!parts.length)return; const prev=contents[contents.length-1]; if(prev?.role===role) prev.parts.push(...parts); else contents.push({role,parts}); };
  for(const turn of turns||[]){ const kind=String(turn.kind||"").toUpperCase(); const content=String(turn.content||"");
    if(kind==="SYSTEM"){ if(content.trim())system.push(content); continue; }
    if(kind==="USER"||kind==="SUMMARY"){ if(content.trim())add("user",[{text:content}]); continue; }
    if(kind==="ASSISTANT"||kind==="TOOL_CALL"){
      const parts=[]; const plain=stripToolMarkup(content); if(plain)parts.push({text:plain}); const calls=parseToolCalls(content); openCalls=[];
      for(const c of calls){ const part={functionCall:{name:c.name,args:c.input}}; const cached=thoughtSignatureCache.get(callKey(c.name,c.input)); const sig=c.thoughtSignature||cached||"skip_thought_signature_validator"; part.thoughtSignature=sig; parts.push(part); openCalls.push(c.name); }
      if(!calls.length && kind==="TOOL_CALL" && turn.toolName && content.trim()){ let args={}; try{args=JSON.parse(content);}catch(_){} const part={functionCall:{name:turn.toolName,args}}; part.thoughtSignature=thoughtSignatureCache.get(callKey(turn.toolName,args))||"skip_thought_signature_validator"; parts.push(part); openCalls.push(turn.toolName); }
      add("model",parts); continue;
    }
    if(kind==="TOOL_RESULT"){
      const parsed=parseToolResults(content); const normalized=parsed.length?parsed:[{name:turn.toolName||openCalls[0]||"tool",content}]; const parts=[];
      for(const r of normalized){ const name=r.name||openCalls[0]||"tool"; let response; try{response=JSON.parse(r.content||"{}");}catch(_){response={content:r.content||""};} if(response===null||typeof response!=="object"||Array.isArray(response))response={content:response}; parts.push({functionResponse:{name,response}}); }
      if(parts.length)add("user",parts); openCalls=[];
    }
  }
  return {system:system.join("\n\n"),contents};
}
function readNum(obj,keys,fallback){ for(const k of keys){const n=Number(obj?.[k]);if(Number.isFinite(n))return n;}return fallback; }
function mergedParams(event){ const out={}; for(const x of event.eventPayload.modelParameters||[])if(x&&typeof x==="object")Object.assign(out,x); for(const x of event.eventPayload.config.customParameters||[])if(x&&typeof x==="object")Object.assign(out,x); return out; }
function endpointModel(config){ let endpoint=nonEmpty(config.apiEndpoint,DEFAULT_ENDPOINT).replace(/\/+$/,""); endpoint=endpoint.replace(/\/v1\/publishers\/google\/models.*$/i,""); return {endpoint,model:nonEmpty(config.modelName,DEFAULT_MODEL)}; }
function isRetryable(status){ return [408,409,429,500,502,503,504].includes(status); }
function errorDetail(resp,data){ return data?.error?.message ?? data?.message ?? resp.content ?? resp.statusMessage ?? "Unknown Vertex Express error"; }
async function sendMessage(event){
  const config=event.eventPayload.config; const apiKey=nonEmpty(config.apiKey); if(!apiKey)throw new Error("Vertex Express API key is empty.");
  const {endpoint,model}=endpointModel(config); const conv=buildConversation(event.eventPayload.chatHistory||[]); const tools=config.enableToolCall===false?[]:toGeminiTools(event.eventPayload.availableTools); const params=mergedParams(event);
  const generationConfig={maxOutputTokens:Math.max(1,Math.floor(readNum(params,["maxOutputTokens","maxTokens","max_tokens"],8192))),temperature:readNum(params,["temperature"],0.7)};
  const topP=readNum(params,["topP","top_p"],NaN); if(Number.isFinite(topP))generationConfig.topP=topP;
  const topK=readNum(params,["topK","top_k"],NaN); if(Number.isFinite(topK))generationConfig.topK=Math.floor(topK);
  const body={contents:conv.contents,generationConfig}; if(conv.system)body.systemInstruction={parts:[{text:conv.system}]}; if(tools.length)body.tools=tools;
  const url=`${endpoint}/v1/publishers/google/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const headers={"Content-Type":"application/json",Accept:"application/json"}; for(const [k,v] of Object.entries(config.customHeaders||{}))if(typeof v==="string")headers[k]=v;
  const retryEnabled=event.eventPayload.enableRetry===true; const maxAttempts=retryEnabled?5:1; let resp=null,data={},attempt=1;
  for(;attempt<=maxAttempts;attempt++){
    try{ resp=await Tools.Net.http({url,method:"POST",headers,body:JSON.stringify(body),connect_timeout:30000,read_timeout:180000,responseType:"text",validateStatus:false}); }
    catch(e){ if(attempt>=maxAttempts)throw e; const delay=Math.min(8000,1000*Math.pow(2,attempt-1)); if(typeof sendIntermediateResult==="function")sendIntermediateResult({nonFatalError:`Vertex Express 網路請求失敗，${delay} ms 後重試。`}); await Tools.System.sleep(delay); continue; }
    try{data=JSON.parse(resp.content||"{}");}catch(_){data={};}
    if(resp.statusCode>=200&&resp.statusCode<300)break;
    const detail=errorDetail(resp,data); if(attempt>=maxAttempts||!isRetryable(resp.statusCode))throw new Error(`Vertex Express HTTP ${resp.statusCode}: ${detail}`);
    const delay=Math.min(8000,1000*Math.pow(2,attempt-1)); if(typeof sendIntermediateResult==="function")sendIntermediateResult({nonFatalError:`Vertex Express HTTP ${resp.statusCode}: ${detail}，${delay} ms 後重試。`}); await Tools.System.sleep(delay);
  }
  if(!resp||resp.statusCode<200||resp.statusCode>=300)throw new Error(`Vertex Express HTTP ${resp?.statusCode??"unknown"}: ${errorDetail(resp||{},data)}`);
  const candidate=data?.candidates?.[0]; const parts=candidate?.content?.parts||[]; const output=[];
  for(const part of parts){ if(typeof part?.text==="string"&&part.text)output.push(part.text); if(part?.functionCall){ const sig=part.thoughtSignature||part.thought_signature||""; if(sig)thoughtSignatureCache.set(callKey(part.functionCall.name,part.functionCall.args),sig); output.push(geminiFunctionCallToOperitXml(part.functionCall,sig)); } }
  return {text:output.join(output.length>1?"\n":""),attempt,usage:{input:Number(data?.usageMetadata?.promptTokenCount||0),cachedInput:Number(data?.usageMetadata?.cachedContentTokenCount||0),output:Number(data?.usageMetadata?.candidatesTokenCount||0),attempt}};
}
async function listModels(_event){ return {models:[
  {id:"gemini-3-flash-preview",name:"Gemini 3 Flash Preview"},
  {id:"gemini-3-pro-preview",name:"Gemini 3 Pro Preview"},
  {id:"gemini-3.1-pro-preview",name:"Gemini 3.1 Pro Preview"},
  {id:"gemini-2.5-flash",name:"Gemini 2.5 Flash"},
  {id:"gemini-2.5-pro",name:"Gemini 2.5 Pro"},
  {id:"gemini-2.5-flash-lite",name:"Gemini 2.5 Flash Lite"}
]}; }
async function testConnection(event){ try{ const fake={event:"toolpkg_ai_provider_send_message",eventName:"toolpkg_ai_provider_send_message",eventPayload:{providerId:event.eventPayload.providerId,config:event.eventPayload.config,chatHistory:[{kind:"USER",content:"Reply with OK only."}],availableTools:[],enableRetry:false}}; const result=await sendMessage(fake); return {success:true,message:result.text||"Connected."}; }catch(e){return {success:false,error:String(e?.message??e)};} }
async function calculateInputTokens(event){ const chars=JSON.stringify(event.eventPayload.chatHistory||[]).length+JSON.stringify(event.eventPayload.availableTools||[]).length; return {tokens:Math.max(1,Math.ceil(chars/4))}; }
const provider={id:"vertex_express_gemini",displayName:"Vertex Express (Gemini)",description:"Google Agent Platform / Vertex Express API-key provider with Operit tool-call bridging.",listModels:{function:listModels},sendMessage:{function:sendMessage},testConnection:{function:testConnection},calculateInputTokens:{function:calculateInputTokens}};
function registerToolPkg(){ ToolPkg.registerAiProvider(provider); return true; }
