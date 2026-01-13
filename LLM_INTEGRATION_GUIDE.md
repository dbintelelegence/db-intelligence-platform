# LLM Integration Guide - Interactive AI Database Assistant

## Overview

The DB Intelligence Platform now features an **interactive AI Database Assistant** that uses Large Language Models (LLMs) to provide conversational analysis of your database infrastructure. Have natural, multi-turn conversations about your metrics, issues, and logs.

## Features

### 🤖 Multi-Turn Conversations
- Ask follow-up questions that reference previous responses
- Build context over multiple messages
- Refine your queries based on AI insights
- Natural conversation flow with full history

### 🔌 Multiple LLM Providers
- **OpenAI (GPT-4)** - Advanced reasoning and analysis
- **Anthropic (Claude)** - Deep technical understanding
- **Mock Mode** - Test without API keys

### ⚙️ Flexible Configuration
- Choose your preferred LLM provider
- Adjust temperature for creativity vs. consistency
- Select specific models (GPT-4 Turbo, Claude 3.5 Sonnet, etc.)
- Set API keys via UI or environment variables

### 📊 Context-Aware Analysis
The AI has access to:
- Real-time database metrics (CPU, memory, storage, connections, latency)
- Health scores and status across all databases
- Active issues with severity levels
- Cost data and trends
- Database metadata (cloud provider, region, type)

## Quick Start

### 1. Enable LLM Integration

#### Option A: Environment Variables (Recommended)
Create a `.env` file in your project root:

```bash
# For OpenAI
VITE_OPENAI_API_KEY=sk-your-key-here

# For Anthropic/Claude
VITE_ANTHROPIC_API_KEY=sk-ant-your-key-here
```

#### Option B: UI Configuration
1. Click "AI Insights" in the header
2. Click the Settings icon (⚙️) in the chat interface
3. Select your provider and enter your API key

### 2. Start a Conversation

Click the **"AI Insights"** button in the header to open the assistant.

### 3. Ask Questions

Example conversation flow:

**You:** What databases are experiencing high CPU usage?

**AI:** Based on the last 24 hours, I've identified 3 databases with CPU usage above 80%:
- production-api-db (PostgreSQL on AWS): 92% CPU
- analytics-warehouse (MySQL on GCP): 87% CPU
- cache-primary (Redis on Azure): 84% CPU

**You:** What's causing the high CPU on production-api-db?

**AI:** Analyzing production-api-db specifically:
1. Connection count is at 245/250 (98% of max) - likely connection pool exhaustion
2. Query latency has increased to 450ms (3x normal)
3. Two critical slow query issues detected in the last 6 hours

Recommendations:
- Increase connection pool limit from 250 to 500
- Review and optimize the slow queries flagged...

**You:** How much would increasing the connection pool cost?

**AI:** Based on current pricing for AWS RDS PostgreSQL in us-east-1...

## Conversation Features

### Time Window Selection
Choose the analysis period:
- **1h** - Real-time issues
- **6h** - Recent trends
- **24h** - Daily patterns (default)
- **7d** - Weekly analysis
- **30d** - Monthly overview

The AI will automatically filter metrics and issues to your selected window.

### Context Continuity
Each message includes full conversation history, allowing the AI to:
- Reference previous questions and answers
- Provide progressive detail
- Remember what you've already discussed
- Build on earlier analysis

### Clear Conversation
Click "Clear" to start fresh without conversation context.

## Supported Providers

### OpenAI (GPT-4)

**Best for:** Complex reasoning, multi-step analysis, creative problem-solving

**Configuration:**
```env
VITE_OPENAI_API_KEY=sk-...
```

**Recommended Models:**
- `gpt-4-turbo-preview` (default) - Latest, fastest GPT-4
- `gpt-4` - Standard GPT-4
- `gpt-3.5-turbo` - Faster, more economical

**Get API Key:** https://platform.openai.com/api-keys

### Anthropic (Claude)

**Best for:** Technical accuracy, detailed explanations, code analysis

**Configuration:**
```env
VITE_ANTHROPIC_API_KEY=sk-ant-...
```

**Recommended Models:**
- `claude-3-5-sonnet-20241022` (default) - Best balance
- `claude-3-opus-20240229` - Maximum capability
- `claude-3-sonnet-20240229` - Fast and capable

**Get API Key:** https://console.anthropic.com/settings/keys

### Mock Mode

**Best for:** Testing, demos, development without API costs

No API key required. Returns realistic mock responses based on your actual data.

## Example Conversations

### Performance Troubleshooting

```
You: Show me databases with latency issues
AI: [Lists databases with >100ms latency]

You: Focus on the production tier
AI: [Filters to production environment]

You: What's changed in the last 24 hours?
AI: [Analyzes trends and recent changes]
```

### Cost Analysis

```
You: Which databases are most expensive?
AI: [Ranks by monthly cost]

You: Are there any cost anomalies?
AI: [Identifies unusual spending patterns]

You: How can I optimize costs?
AI: [Provides specific recommendations]
```

### Health Monitoring

```
You: Summarize the overall health of my infrastructure
AI: [Provides comprehensive overview]

You: What are the critical issues?
AI: [Lists critical severity items]

You: Walk me through resolving the connection pool issue
AI: [Provides step-by-step guidance]
```

## Advanced Configuration

### Temperature Settings

Adjust how creative vs. consistent the responses are:

- **0.0-0.3** - Precise, deterministic responses (best for troubleshooting)
- **0.4-0.7** - Balanced (default: 0.7)
- **0.8-1.0** - Creative, exploratory responses (best for brainstorming)

### Model Selection

Choose specific models in the settings panel:

**OpenAI Models:**
- GPT-4 Turbo Preview: `gpt-4-turbo-preview`
- GPT-4: `gpt-4`
- GPT-3.5 Turbo: `gpt-3.5-turbo`

**Anthropic Models:**
- Claude 3.5 Sonnet: `claude-3-5-sonnet-20241022`
- Claude 3 Opus: `claude-3-opus-20240229`
- Claude 3 Sonnet: `claude-3-sonnet-20240229`

## System Prompts

The AI receives rich context about your infrastructure:

```
- Total Databases: 50
- Healthy: 42, Warning: 6, Critical: 2
- Average CPU: 65%, Memory: 58%, Storage: 45%
- Critical Issues: 3
- Time Window: Last 24 Hours

[Detailed database information...]
[Critical issues with descriptions...]
```

This allows the AI to provide specific, actionable insights based on real data.

## Response Format

Responses include:

### Summary
Natural language overview answering your question

### Key Insights (when applicable)
- Numbered list of important findings
- Prioritized by severity/impact

### Recommendations (when applicable)
- Actionable next steps
- Specific to your question and context

### Affected Databases
- Databases requiring attention
- Color-coded by severity (🔴 Critical, 🟠 Warning)

### Data Points
- Metrics analyzed
- Issues found
- Logs processed

## Tips for Best Results

### Be Specific
❌ "What's wrong?"
✅ "Which PostgreSQL databases on AWS are experiencing high memory usage?"

### Ask Follow-ups
Take advantage of conversation history:
```
1. "Show me critical issues"
2. "Focus on production databases"
3. "What's causing the connection pool issue on api-db?"
```

### Change Time Windows
Adjust the time window between messages to compare different periods.

### Use Natural Language
The AI understands technical database terminology:
- "Slow queries"
- "Connection pool exhaustion"
- "Index bloat"
- "Query latency"
- "Storage IOPS"

## Troubleshooting

### API Key Not Working

1. Check key format starts with `sk-` (OpenAI) or `sk-ant-` (Anthropic)
2. Verify key is active in your provider's dashboard
3. Check billing is enabled and has credits
4. Ensure `.env` file is in project root (for environment variables)
5. Restart dev server after adding `.env` file

### "Provider error" Messages

**OpenAI:**
- Rate limit exceeded → Upgrade plan or wait
- Invalid model → Check model name spelling
- No credit → Add payment method

**Anthropic:**
- Invalid API key → Generate new key in console
- Model not available → Check spelling or use recommended model

### Conversation Not Flowing

- Ensure you're asking follow-up questions that relate to previous responses
- Check that conversation history hasn't been cleared
- Verify time window hasn't changed dramatically between messages

### Slow Responses

- **OpenAI GPT-4:** 5-15 seconds normal
- **Anthropic Claude:** 3-10 seconds normal
- **Mock Mode:** 1.5 seconds (simulated)

Longer for complex queries with lots of context.

## Security & Privacy

### API Keys
- Never commit API keys to version control
- Use `.env` file (already in `.gitignore`)
- Rotate keys regularly
- Restrict key permissions in provider dashboard

### Data Transmission
- Only summary statistics sent to LLM providers
- Individual database names and metadata included
- No sensitive credentials or connection strings transmitted
- Issue descriptions and recommendations shared for context

### Local-First
- All data processing happens in your browser
- Conversation history stored in component state (not persisted)
- No data stored on external servers besides LLM API calls

## Cost Estimates

### OpenAI Pricing (approximate)

**GPT-4 Turbo:**
- ~$0.01-0.03 per conversation turn
- ~$1-3 for 100 questions

**GPT-3.5 Turbo:**
- ~$0.001-0.003 per turn
- ~$0.10-0.30 for 100 questions

### Anthropic Pricing (approximate)

**Claude 3.5 Sonnet:**
- ~$0.015-0.045 per turn
- ~$1.50-4.50 for 100 questions

**Claude 3 Sonnet:**
- ~$0.003-0.015 per turn
- ~$0.30-1.50 for 100 questions

*Prices vary based on context size and response length*

## Development

### Adding New Providers

To add support for another LLM provider:

1. Update `LLMProvider` type in `src/types/summarization.ts`
2. Add provider handler in `src/services/llm-service.ts`
3. Update settings UI in `src/components/features/summarization/ChatInterface.tsx`

### Customizing System Prompts

Edit `buildSystemPrompt()` in `src/services/llm-service.ts` to adjust:
- AI personality and tone
- Response format preferences
- Domain-specific instructions
- Context structure

### Response Parsing

The `parseLLMResponse()` function attempts to extract structured data from free-form LLM responses. Customize in `src/services/llm-service.ts`.

## Roadmap

Future enhancements planned:
- [ ] Persistent conversation history
- [ ] Export conversations as markdown/PDF
- [ ] Voice input support
- [ ] Suggested follow-up questions
- [ ] Database-specific deep dives
- [ ] Automated scheduled summaries
- [ ] Integration with incident management systems
- [ ] Custom system prompts per user
- [ ] Multi-database comparison queries

## Support

For issues or questions:
1. Check console for error messages
2. Review API key configuration
3. Test with Mock mode first
4. Verify provider dashboard shows API calls
5. Check network tab for failed requests

## License

This integration follows the same license as the main project. API usage subject to provider terms of service.
