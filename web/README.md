# Stock Metadata Generator (Web)

Browser version of the Stock Metadata Generator. Select or drop image/video files, enter your API keys in Settings, generate metadata with AI, then download a CSV.

## Run locally

```bash
cd web
npm install
npm run dev
```

Open the URL shown (e.g. http://localhost:5173).

## Build

```bash
npm run build
npm run preview
```

## Setup

1. Open **Settings** and enter your **Groq API key** (required for "Metadata Üret"). Get one at [console.groq.com](https://console.groq.com).
2. Optionally add **Everypixels Client ID** and **Client Secret** for keyword suggestions (may require CORS proxy if the API blocks browser requests).
3. Select or drop image/video files, pick one, click **Metadata Üret**, then **Download CSV**.

## CORS

- **Groq**: Usually works from the browser. If you see CORS errors, use a small serverless proxy that forwards requests with your API key.
- **Everypixels**: Often CORS-restricted. If it fails, use a backend proxy or skip it and rely on Groq-only keywords.
