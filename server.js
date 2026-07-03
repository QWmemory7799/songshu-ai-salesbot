const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Server-side config file (optional, for production)
const CONFIG_PATH = path.join(__dirname, '.config.json');
let serverConfig = {};
try {
  if (fs.existsSync(CONFIG_PATH)) {
    serverConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  }
} catch(e) {}

function cleanResponse(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#{1,6}\s/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Knowledge base endpoint - save
app.post('/api/kb/save', (req, res) => {
  const { content } = req.body;
  if (!content && content !== '') return res.status(400).json({ error: '缺少内容' });
  serverConfig.knowledgeBase = content;
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(serverConfig, null, 2), 'utf-8');
  } catch(e) { /* ignore - will be in memory only */ }
  res.json({ ok: true });
});

// Knowledge base endpoint - load
app.get('/api/kb/load', (req, res) => {
  res.json({ content: serverConfig.knowledgeBase || '' });
});

// Chat proxy endpoint
app.post('/api/chat', async (req, res) => {
  const { endpoint, apiKey, model, messages, temperature, knowledgeBase } = req.body;

  // Use server-side key if no client key provided
  const key = apiKey || serverConfig.apiKey;
  if (!key) {
    return res.status(400).json({ error: '缺少API密钥，请先在设置中配置' });
  }

  const url = (endpoint || 'https://api.deepseek.com/v1').replace(/\/+$/, '') + '/chat/completions';

  try {
    // If knowledge base is provided, prepend it to system message
    let finalMessages = [...messages];
    if (knowledgeBase && knowledgeBase.trim()) {
      // Find system message and append knowledge base
      let sysIdx = finalMessages.findIndex(m => m.role === 'system');
      if (sysIdx >= 0) {
        finalMessages[sysIdx] = {
          ...finalMessages[sysIdx],
          content: finalMessages[sysIdx].content + '\n\n# 公司资料（优先参考）\n' + knowledgeBase
        };
      }
    }

    console.log(`[API] Calling DeepSeek, ${finalMessages.length} msgs, kb: ${(knowledgeBase||'').length} chars`);
    
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'deepseek-chat',
        messages: finalMessages,
        temperature: temperature ?? 0.7,
        max_tokens: 2000,
        top_p: 0.9,
        presence_penalty: 0.1,
        frequency_penalty: 0.1
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[API] Error ${resp.status}:`, errText.substring(0, 200));
      let userMsg = `API错误 ${resp.status}`;
      if (resp.status === 401) userMsg = 'API密钥无效，请检查密钥是否正确';
      else if (resp.status === 402) userMsg = 'API余额不足，请充值';
      else if (resp.status === 429) userMsg = 'API请求太频繁，请稍后再试';
      return res.status(502).json({ error: userMsg });
    }

    const data = await resp.json();
    let content = data.choices?.[0]?.message?.content || '';
    console.log(`[API] Response: ${content.length} chars`);
    content = cleanResponse(content);
    res.json({ content });
  } catch (e) {
    console.error('[API] Fetch error:', e.message);
    res.status(502).json({ error: `API连接失败：${e.message}` });
  }
});

// Server-side config save
app.post('/api/config/save', (req, res) => {
  if (req.body.apiKey) serverConfig.apiKey = req.body.apiKey;
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(serverConfig, null, 2), 'utf-8');
  } catch(e) {}
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3099;
app.listen(PORT, () => {
  console.log(`松鼠管家MVP后端: http://localhost:${PORT}`);
  if (serverConfig.apiKey) console.log('  已配置服务端API密钥');
});
