# Quick Start: Conversational AI Database Assistant

## 🚀 Get Started in 3 Steps

### Step 1: Open the AI Assistant
Click the **"AI Insights"** button in the header (top right, visible on desktop).

### Step 2: Start Chatting
Type your question and press Enter. The AI will analyze your 50 databases and respond.

### Step 3: Continue the Conversation
Ask follow-up questions! The AI remembers your conversation context.

## 💬 Example Conversation

```
You: What's the current health of my databases?

AI: Over the past 24 hours, your database infrastructure shows:
• 42/50 databases operating normally
• 6 databases require attention
• 2 critical issues detected

Key Insights:
1. 3 databases experiencing high CPU usage (>80%)
2. 2 databases with connection pool near capacity
3. 1 database showing storage warnings

Recommendations:
1. Investigate production-api-db connection pool usage
2. Review slow queries on analytics-warehouse
3. Plan storage expansion for cache-primary

You: Tell me more about the production-api-db connection issue

AI: Analyzing production-api-db specifically:

Current State:
- Connection usage: 245/250 (98% of max)
- Average latency: 450ms (3x normal baseline)
- CPU: 92%

The high connection count is causing:
- Query queueing and increased latency
- CPU overhead from connection management
- Risk of connection exhaustion

Immediate Actions:
1. Increase max_connections from 250 to 500
2. Enable connection pooling with PgBouncer
3. Review application connection leak patterns

You: How do I implement PgBouncer?

AI: [Provides implementation steps...]
```

## 🎯 Use Cases

### Performance Troubleshooting
- "Which databases are slow?"
- "What's causing high CPU on production-api-db?"
- "Show me query performance trends"

### Cost Analysis
- "What are my most expensive databases?"
- "Are there any cost anomalies this month?"
- "How can I reduce my AWS database costs?"

### Health Monitoring
- "Summarize critical issues"
- "Which databases need immediate attention?"
- "What changed in the last 24 hours?"

### Capacity Planning
- "Which databases are approaching storage limits?"
- "Do I need to scale any connection pools?"
- "Show me growth trends over the last 30 days"

## ⚙️ Configuration Options

### Mock Mode (Default)
No setup required! Returns intelligent mock responses based on your actual data.

### Real LLM Integration

#### Option 1: OpenAI (GPT-4)
1. Get API key from https://platform.openai.com/api-keys
2. Create `.env` file:
   ```
   VITE_OPENAI_API_KEY=sk-your-key-here
   ```
3. Restart dev server
4. Select "OpenAI" in chat settings

#### Option 2: Anthropic (Claude)
1. Get API key from https://console.anthropic.com/settings/keys
2. Create `.env` file:
   ```
   VITE_ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```
3. Restart dev server
4. Select "Anthropic" in chat settings

## 🎨 Interface Features

### Time Window Selector
Switch between 1h, 6h, 24h, 7d, or 30d analysis periods in the header dropdown.

### Settings Panel
Click the ⚙️ icon to configure:
- LLM Provider (Mock, OpenAI, Anthropic)
- API Key
- Model selection
- Temperature (creativity vs. consistency)

### Clear Conversation
Click "Clear" to start a fresh conversation without context.

### Message Timestamps
Each message shows when it was sent, and AI responses show:
- Metrics analyzed
- Issues found
- Logs processed

## 🔍 What the AI Can Access

The AI analyzes:
- ✅ Real-time metrics (CPU, memory, storage, connections, latency)
- ✅ Health scores and status
- ✅ Active issues with severity levels
- ✅ Cost data and trends
- ✅ Database metadata (cloud provider, region, type)
- ✅ Historical trends within selected time window

The AI does NOT have access to:
- ❌ Actual database credentials
- ❌ Connection strings
- ❌ Query contents or data
- ❌ Personal information

## 💡 Tips for Best Results

1. **Be Specific**: "PostgreSQL databases with >80% CPU" beats "slow databases"
2. **Use Follow-ups**: Build on previous answers to dig deeper
3. **Adjust Time Windows**: Compare different periods to spot trends
4. **Ask "Why"**: The AI can explain root causes, not just symptoms
5. **Request Actions**: Ask "How do I fix this?" for step-by-step guidance

## 🐛 Troubleshooting

### Chat button not showing?
- Make your browser window wider (hidden on small screens)

### API key errors?
1. Check key format (OpenAI: `sk-...`, Anthropic: `sk-ant-...`)
2. Verify key is active in provider dashboard
3. Ensure `.env` is in project root
4. Restart dev server after adding `.env`

### Slow responses?
- GPT-4: 5-15 seconds is normal for complex analysis
- Claude: 3-10 seconds typical
- Try GPT-3.5 or Claude Sonnet for faster responses

## 📚 Learn More

- Full documentation: [LLM_INTEGRATION_GUIDE.md](./LLM_INTEGRATION_GUIDE.md)
- Feature overview: [AI_SUMMARIZATION_FEATURE.md](./AI_SUMMARIZATION_FEATURE.md)

## 🎉 Try It Now!

1. Click "AI Insights" in the header
2. Type: "Summarize the health of my databases"
3. Press Enter
4. Start exploring your infrastructure with AI!
