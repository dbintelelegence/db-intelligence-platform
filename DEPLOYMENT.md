# Deployment Guide

## Quick Deploy to Vercel

### Option 1: GitHub Integration (Recommended)

1. **Connect GitHub to Vercel**:
   - Go to https://vercel.com/login
   - Sign up/Login with GitHub
   - Authorize Vercel to access your repositories

2. **Import Project**:
   - Visit https://vercel.com/new
   - Import `dbintelelegence/db-intelligence-platform`
   - Vercel will auto-detect Vite configuration

3. **Deploy**:
   - Click "Deploy"
   - Your app will be live at: `https://your-project.vercel.app`

### Option 2: Vercel CLI

```bash
# Login to Vercel
vercel login

# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

## Environment Variables (Optional)

The app works in **Mock mode** by default without any API keys. To enable real LLM integration:

### OpenAI (GPT-4)

1. **Get API Key**:
   - Visit https://platform.openai.com/api-keys
   - Create account or login
   - Click "Create new secret key"
   - Copy the key (starts with `sk-...`)

2. **Add to Vercel**:
   - Go to Project Settings → Environment Variables
   - Add: `VITE_OPENAI_API_KEY` = `sk-your-key-here`
   - Select: Production, Preview, Development
   - Click "Save"

3. **Cost**: ~$0.01-0.03 per conversation turn with GPT-4 Turbo

### Anthropic (Claude)

1. **Get API Key**:
   - Visit https://console.anthropic.com/settings/keys
   - Create account or login
   - Click "Create Key"
   - Copy the key (starts with `sk-ant-...`)

2. **Add to Vercel**:
   - Go to Project Settings → Environment Variables
   - Add: `VITE_ANTHROPIC_API_KEY` = `sk-ant-your-key-here`
   - Select: Production, Preview, Development
   - Click "Save"

3. **Cost**: ~$0.015-0.045 per conversation turn with Claude 3.5 Sonnet

### Free Trial Credits

- **OpenAI**: New accounts get $5 free credit (expires after 3 months)
- **Anthropic**: New accounts get $5 free credit

## Post-Deployment

1. **Redeploy after adding environment variables**:
   ```bash
   vercel --prod
   ```
   Or trigger a new deployment from Vercel dashboard

2. **Test the deployment**:
   - Visit your deployed URL
   - Click "AI Insights" button
   - Try Mock mode first (no API key needed)
   - If you added API keys, select the provider in settings

## Deployment URLs

- **Production**: Your main branch deploys to `your-project.vercel.app`
- **Preview**: Feature branches get preview URLs like `your-project-git-feature.vercel.app`
- **Custom Domain**: Add custom domains in Project Settings → Domains

## Troubleshooting

### Build Errors

If build fails, check:
```bash
# Test build locally
npm run build

# Check TypeScript
npm run lint
```

### Environment Variables Not Working

- Ensure variable names start with `VITE_`
- Redeploy after adding variables
- Check browser console for "Provider error" messages

### GitHub Connection Issues

If you see "You need to add a Login Connection":
1. Go to https://vercel.com/account
2. Click "Connected Accounts"
3. Connect your GitHub account
4. Try importing the project again

## Mock Mode (No API Keys)

The app fully works without API keys:
- Uses intelligent mock responses
- Analyzes your actual database data
- Perfect for demos and testing
- No cost involved

## Monitoring

- **Vercel Analytics**: Automatically enabled
- **Build Logs**: Available in Vercel dashboard
- **Runtime Logs**: Check Vercel Functions logs

## Cost Optimization

1. **Start with Mock mode** - Free, works great for demos
2. **Use GPT-3.5 Turbo** - 10x cheaper than GPT-4 (~$0.001/turn)
3. **Use Claude 3 Sonnet** - More economical than Claude 3.5
4. **Set usage limits** in OpenAI/Anthropic dashboards
5. **Monitor usage** in provider dashboards

## Security

- Never commit API keys to git
- Use Vercel environment variables
- Rotate keys regularly
- Set spending limits in provider dashboards
- Monitor usage for unexpected spikes

## Support

- Vercel: https://vercel.com/support
- OpenAI: https://help.openai.com
- Anthropic: https://support.anthropic.com
