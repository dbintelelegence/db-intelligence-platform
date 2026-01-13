# AI Database Summarization Feature

## Overview
The AI Summarization feature provides intelligent analysis of your database infrastructure by combining metrics, logs, and issue data to generate actionable insights.

## How It Works

### 1. User Interface
- **Access Point**: Click the "AI Insights" button in the header (visible on large screens)
- **Modal Interface**: Opens a full-featured dialog with:
  - Time window selector (1h, 6h, 24h, 7d, 30d)
  - Natural language prompt input
  - Example prompts for quick access
  - Response display with multiple sections

### 2. Time Window Selection
Users can analyze data across different time periods:
- **Last Hour**: Recent, real-time issues
- **Last 6 Hours**: Short-term trends
- **Last 24 Hours**: Daily patterns (default)
- **Last 7 Days**: Weekly trends
- **Last 30 Days**: Monthly overview

### 3. AI Analysis Engine
The summarization service (`src/services/summarization-service.ts`) performs:

#### Data Collection
- Filters databases based on optional criteria
- Retrieves issues within the selected time window
- Aggregates metrics across all databases
- Simulates log processing (mock data)

#### Health Analysis
- Identifies databases in critical or warning states
- Detects high resource utilization (CPU, memory, storage)
- Calculates overall health percentage
- Tracks trending issues

#### Issue Analysis
- Groups issues by severity (critical, high, medium, low)
- Categorizes issues by type
- Identifies most common problems
- Tracks resolution status

#### Context-Aware Summarization
The AI tailors responses based on prompt keywords:
- **Performance queries**: Focuses on latency, throughput, slow databases
- **Cost queries**: Analyzes spending, trends, anomalies
- **Resource queries**: Examines CPU, memory, storage utilization
- **General queries**: Provides overall system health overview

### 4. Response Structure

The AI generates structured responses with:

#### Summary
Natural language overview of the current state based on:
- Selected time window
- User's specific question
- Overall database health
- Critical issues detected

#### Key Insights (Top 5)
- Database health statistics
- Resource utilization patterns
- Issue trends and patterns
- Notable anomalies

#### Recommendations (Top 5)
Actionable advice such as:
- Increasing connection pool limits
- Investigating query performance
- Planning storage expansion
- Addressing unresolved issues

#### Affected Databases
List of databases requiring attention, color-coded by severity:
- 🔴 **Critical**: Immediate action required
- 🟠 **Warning**: Should be monitored
- 🔵 **Info**: For awareness

#### Data Points
Transparency metrics showing:
- Number of metrics analyzed
- Issues found in timeframe
- Logs processed (mock count)

## Example Prompts

### Performance Analysis
```
What databases are experiencing performance problems?
```
Response focuses on latency, throughput, and slow query patterns.

### Critical Issues
```
Summarize critical issues affecting production databases
```
Response highlights urgent problems requiring immediate attention.

### Cost Optimization
```
Show me cost anomalies and resource inefficiencies
```
Response analyzes spending trends and optimization opportunities.

### General Health Check
```
Which databases need immediate attention?
```
Response provides comprehensive health assessment.

## Technical Implementation

### Files Created

1. **Types** (`src/types/summarization.ts`)
   - `TimeWindow`: Time range options
   - `SummarizationRequest`: Input parameters
   - `SummarizationResponse`: Structured output
   - `SummarizationContext`: Internal data aggregation

2. **Service** (`src/services/summarization-service.ts`)
   - `generateAISummary()`: Main analysis function
   - Time range calculation and filtering
   - Health, issue, and resource analysis
   - Context-aware summary generation

3. **Component** (`src/components/features/summarization/SummarizationPanel.tsx`)
   - Modal UI with full-screen overlay
   - Form with time window picker and prompt input
   - Loading states and error handling
   - Formatted response display

4. **Integration** (`src/components/layout/Header.tsx`)
   - "AI Insights" button with gradient styling
   - State management for modal visibility
   - Compact metrics view on extra-large screens

### Data Sources

The AI analyzes:
- **Database Metrics**: 50 databases with real-time stats
- **Issues**: Categorized by severity and type
- **Cost Data**: Monthly spending and trends
- **Health Scores**: 0-100 scale with status indicators

### Response Time
- Simulated 1.5 second delay for realistic UX
- Shows loading spinner during analysis
- Smooth fade-in animation for results

## Future Enhancements

Potential improvements:
1. **Real AI Integration**: Connect to actual LLM API (OpenAI, Anthropic, etc.)
2. **Database Filtering**: Analyze specific subsets of databases
3. **Historical Comparison**: Compare current state to past periods
4. **Export Results**: Download summaries as PDF or JSON
5. **Scheduled Reports**: Automatic periodic summaries via email
6. **Custom Metrics**: User-defined analysis parameters
7. **Interactive Charts**: Visual representation of insights
8. **Natural Language Queries**: More sophisticated prompt understanding

## Responsive Design

- **Mobile**: Summarization button hidden (space constraints)
- **Tablet (lg)**: AI Insights button visible
- **Desktop (xl)**: AI Insights button + compact metrics
- **Modal**: Responsive on all screen sizes with scrolling

## Accessibility

- Keyboard navigation support
- ARIA labels on interactive elements
- Clear focus indicators
- Screen reader friendly structure
- Color-blind safe severity indicators

## Performance Considerations

- Lazy loading of modal component
- Efficient data filtering before analysis
- Memoized calculations where applicable
- Optimistic UI updates
- Minimal re-renders with proper state management
