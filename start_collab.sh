#!/bin/bash
# Start the OpenDraft Collaboration Server

cd "$(dirname "$0")/collab-server" || exit 1

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

echo "Starting OpenDraft Collaboration Server..."
npm run dev
