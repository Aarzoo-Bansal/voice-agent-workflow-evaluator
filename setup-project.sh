#!/bin/bash

# Create project root
# mkdir -p workflow-verifier
# cd workflow-verifier

# Initialize Node.js project
npm init -y

# Create directory structure
mkdir -p data
mkdir -p src/llm
mkdir -p src/prompts
mkdir -p src/engine
mkdir -p tests
mkdir -p visualization/src/components
mkdir -p output

# Create all source files
touch src/index.js
touch src/config.js
touch src/llm/client.js
touch src/prompts/segmentation.js
touch src/prompts/classification.js
touch src/prompts/summary.js
touch src/engine/graphUtils.js
touch src/engine/segmenter.js
touch src/engine/nodeMapper.js
touch src/engine/scorer.js
touch src/engine/summarizer.js

# Create test files
touch tests/graphUtils.test.js
touch tests/scorer.test.js
touch tests/mapping.test.js
touch tests/e2e.test.js

# Create visualization files
touch visualization/package.json
touch visualization/vite.config.js
touch visualization/src/main.jsx
touch visualization/src/App.jsx
touch visualization/src/components/WorkflowGraph.jsx
touch visualization/src/components/TranscriptView.jsx
touch visualization/src/components/ScoreDashboard.jsx

# Create data files
touch data/example-graph.json
touch data/example-transcript.json
touch data/ground-truth.json
touch data/good-conversation.json
touch data/bad-conversation.json

# Create output placeholder
touch output/example-result.json

# Create .env.example
cat > .env.example << 'EOF'
OPENAI_API_KEY=your-api-key-here
# Or if using Claude:
# ANTHROPIC_API_KEY=your-api-key-here
EOF

# Create .gitignore
cat > .gitignore << 'EOF'
node_modules/
.env
output/
visualization/node_modules/
visualization/dist/
EOF

# Create README placeholder
cat > README.md << 'EOF'
# Workflow Verification Engine

## Quick start
```
npm install
cp .env.example .env   # add your API key
npm run verify          # runs against example data
npm test                # runs eval suite
cd visualization && npm run dev   # launches UI
```
EOF

echo ""
echo "Project structure created! Next steps:"
echo "1. cd workflow-verifier"
echo "2. npm install openai dotenv"
echo "3. npm install --save-dev jest"
echo "4. Copy example graph and transcript into data/"
echo "5. Add your API key to .env"
echo "6. Start coding src/config.js"